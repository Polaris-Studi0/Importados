-- Private operator photographs and durable internal task alerts. No operational seeds.
begin;
create table if not exists public.whatsapp_operator_media (
 id uuid primary key,conversation_id uuid not null references public.whatsapp_conversations(id),
 actor_id uuid not null references public.profiles(id),storage_path text not null unique,
 mime_type text not null check(mime_type in ('image/jpeg','image/png')),size_bytes integer not null check(size_bytes between 1 and 5242880),
 sha256 text not null check(char_length(sha256)=64),filename text not null,created_at timestamptz not null default now()
);
alter table public.whatsapp_operator_media enable row level security;
revoke all on public.whatsapp_operator_media from public,anon,authenticated;
grant all on public.whatsapp_operator_media to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('whatsapp-operator-media','whatsapp-operator-media',false,5242880,array['image/jpeg','image/png'])
 on conflict(id) do nothing;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_kind_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_kind_check check(kind in ('text','image'));
alter table public.whatsapp_outbox add column if not exists media_asset_id uuid references public.whatsapp_operator_media(id);
create or replace function public.whatsapp_staff_action(p_actor uuid,p_conversation uuid,p_action text,p_request uuid,p_expected integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles;c public.whatsapp_conversations;prior public.whatsapp_actions;cfg public.whatsapp_config;
 out_id uuid;result jsonb;v_task uuid;v_answer text;body text;
begin
 select * into actor from public.profiles where id=p_actor and active;
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 if actor.id is null or c.id is null or not(actor.role='admin' or actor.branch_id=c.branch_id) then raise exception 'Conversación no disponible';end if;
 if p_request is null or p_payload is null then raise exception 'Solicitud inválida';end if;
 select * into prior from public.whatsapp_actions where actor_id=p_actor and request_id=p_request;
 if prior.id is not null then
  if prior.conversation_id<>p_conversation or prior.action<>p_action or prior.payload<>p_payload then raise exception 'Identificador reutilizado con otros datos';end if;
  return prior.response;
 end if;
 if p_expected is null or c.control_version<>p_expected then raise exception 'La conversación cambió. Actualiza antes de continuar';end if;
 if p_action='pause' then update public.whatsapp_conversations set manual_paused=true where id=c.id;
 elsif p_action='resume' then update public.whatsapp_conversations set manual_paused=false,status='open' where id=c.id;
 elsif p_action='close' then update public.whatsapp_conversations set status='closed',manual_paused=true where id=c.id;
 elsif p_action='assign_branch' then
  if actor.role<>'admin' or not exists(select 1 from public.branches where id=p_payload->>'branch_id' and active) then raise exception 'Sede no disponible';end if;
  update public.whatsapp_conversations set branch_id=p_payload->>'branch_id' where id=c.id;
  update public.whatsapp_tasks set branch_id=p_payload->>'branch_id',updated_at=now() where conversation_id=c.id and status='pending';
 elsif p_action='resolve_task' then
  v_task:=(p_payload->>'task_id')::uuid;v_answer:=trim(p_payload->>'answer');
  if coalesce(char_length(v_answer),0) not between 1 and 4000 then raise exception 'Agrega una respuesta válida';end if;
  update public.whatsapp_tasks set status='resolved',answer=v_answer,resolved_by=p_actor,resolved_at=now(),updated_at=now()
   where id=v_task and conversation_id=c.id and status='pending';
  if not found then raise exception 'Pendiente no disponible';end if;
  insert into public.whatsapp_inbox(event_key,kind,event,conversation_id)
   values(md5('resolution:'||v_task::text||':'||p_request::text)||md5(p_request::text),'human_resolution',jsonb_build_object('task_id',v_task),c.id);
 elsif p_action='send_image' then
  select * into cfg from public.whatsapp_config where id;body:=coalesce(nullif(trim(p_payload->>'text'),''),'Foto de producto');
  if not cfg.outbound_enabled or not c.manual_paused or c.status='closed' or c.consent_status<>'granted'
   or c.consent_version is distinct from cfg.privacy_version or c.last_customer_at is null or c.last_customer_at<now()-interval '24 hours'
   then raise exception 'El envío requiere control manual, autorización y ventana vigente';end if;
  if char_length(body)>1024 or not exists(select 1 from public.whatsapp_operator_media m
   where m.id=(p_payload->>'media_id')::uuid and m.conversation_id=c.id and m.actor_id=p_actor)
   then raise exception 'Foto no disponible en esta conversación';end if;
  insert into public.whatsapp_outbox(conversation_id,request_id,kind,media_asset_id,body,source,expected_control_version,expected_context_version)
   values(c.id,p_request,'image',(p_payload->>'media_id')::uuid,body,'operator',c.control_version+1,c.context_version+1) returning id into out_id;
 elsif p_action='send' then
  select * into cfg from public.whatsapp_config where id;body:=trim(p_payload->>'text');
  if not cfg.outbound_enabled or cfg.phone_number_id is null or cfg.waba_id is null then raise exception 'El canal de envío está desactivado';end if;
  if not c.manual_paused or c.status='closed' or c.consent_status<>'granted' or c.consent_version is distinct from cfg.privacy_version
   or c.last_customer_at is null or c.last_customer_at<now()-interval '24 hours' then raise exception 'El envío requiere control manual, autorización y ventana vigente';end if;
  if coalesce(char_length(body),0) not between 1 and 4000 then raise exception 'Mensaje inválido';end if;
  insert into public.whatsapp_outbox(conversation_id,request_id,body,source,expected_control_version,expected_context_version)
   values(c.id,p_request,body,'operator',c.control_version+1,c.context_version+1) returning id into out_id;
 else raise exception 'Acción no disponible';end if;
 update public.whatsapp_conversations set control_version=control_version+1,context_version=context_version+1,updated_at=now() where id=c.id returning * into c;
 update public.whatsapp_outbox set status='cancelled',last_error='staff_control_changed',updated_at=now()
  where conversation_id=c.id and status='queued' and id is distinct from out_id;
 result:=jsonb_build_object('ok',true,'conversation',to_jsonb(c),'outbox',case when out_id is not null then jsonb_build_object('id',out_id,'status','queued') else null end);
 insert into public.whatsapp_actions(actor_id,conversation_id,request_id,action,payload,response) values(p_actor,c.id,p_request,p_action,p_payload,result);
 return result;
end;$$;
create or replace function public.whatsapp_claim_outbox()
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.whatsapp_outbox;c public.whatsapp_conversations;cfg public.whatsapp_config;token uuid:=gen_random_uuid();
begin
 select * into cfg from public.whatsapp_config where id;
 if not cfg.outbound_enabled then return null;end if;
 -- A stale sending lease is uncertain, and is never queued again.
 update public.whatsapp_outbox set status='uncertain',last_error='delivery_outcome_unknown',updated_at=now() where status='sending' and claimed_at<now()-interval '2 minutes';
 select * into o from public.whatsapp_outbox where status='queued' and attempts=0 order by created_at for update skip locked limit 1;
 if o.id is null then return null;end if;
 select * into c from public.whatsapp_conversations where id=o.conversation_id for update;
 if c.control_version<>o.expected_control_version or c.context_version<>o.expected_context_version or c.status='closed'
 or c.last_customer_at is null or c.last_customer_at<now()-interval '24 hours' or c.consent_status='revoked'
 or (o.source='assistant' and (c.manual_paused or not cfg.ai_enabled)) or (o.source='operator' and not c.manual_paused)
 or (o.purpose<>'privacy_notice' and (c.consent_status<>'granted' or c.consent_version is distinct from cfg.privacy_version)) then
  update public.whatsapp_outbox set status='cancelled',last_error='guards_changed',updated_at=now() where id=o.id;
  return null;
 end if;
 update public.whatsapp_outbox set status='sending',attempts=1,claimed_at=now(),lease_token=token,updated_at=now() where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',token,'body',o.body,'kind',o.kind,'media_asset_id',o.media_asset_id,'recipient',c.identity_key,'conversation_id',c.id,'source',o.source);
end;$$;
create or replace function public.whatsapp_finish_outbox(p_id uuid,p_lease uuid,p_status text,p_meta_id text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.whatsapp_outbox;m uuid;strongest text;
begin
 if p_status not in ('sent','failed','uncertain') or (p_status='sent' and nullif(p_meta_id,'') is null) then raise exception 'Resultado inválido';end if;
 select * into o from public.whatsapp_outbox where id=p_id and lease_token=p_lease and status in ('sending','uncertain') for update;
 if o.id is null then return false;end if;
 if p_status='sent' then
  select event->>'status' into strongest from public.whatsapp_inbox where kind='status' and event->>'meta_message_id'=p_meta_id
  order by case event->>'status' when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end desc limit 1;
  insert into public.whatsapp_messages(conversation_id,meta_message_id,direction,source,kind,body,status,attachment)
   values(o.conversation_id,p_meta_id,'outbound',o.source,o.kind,o.body,coalesce(strongest,'sent'),case when o.kind='image' then jsonb_build_object('asset_id',o.media_asset_id,'kind','image') else null end) returning id into m;
  update public.whatsapp_conversations set last_message_at=now(),last_message_preview=left(o.body,180),updated_at=now(),
   privacy_notice_delivered_at=case when o.purpose='privacy_notice' and strongest in ('delivered','read') then now() else privacy_notice_delivered_at end
   where id=o.conversation_id;
 end if;
 update public.whatsapp_outbox set status=coalesce(strongest,p_status),meta_message_id=p_meta_id,message_id=m,last_error=left(p_error,100),updated_at=now() where id=o.id;
 return true;
end;$$;

create table if not exists public.whatsapp_operator_alerts (
 id uuid primary key default gen_random_uuid(),task_id uuid not null unique references public.whatsapp_tasks(id),
 status text not null default 'queued' check(status in ('queued','sending','sent','delivered','read','failed','uncertain','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 1),lease_token uuid,claimed_at timestamptz,
 meta_message_id text,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.whatsapp_operator_alerts enable row level security;
revoke all on public.whatsapp_operator_alerts from public,anon,authenticated;
grant all on public.whatsapp_operator_alerts to service_role;
create or replace function importados_private.whatsapp_queue_operator_alert()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='pending' then insert into public.whatsapp_operator_alerts(task_id) values(new.id) on conflict(task_id) do nothing;end if;
 return new;
end;$$;
drop trigger if exists whatsapp_queue_operator_alert on public.whatsapp_tasks;
create trigger whatsapp_queue_operator_alert after insert on public.whatsapp_tasks for each row execute function importados_private.whatsapp_queue_operator_alert();
create or replace function public.whatsapp_claim_operator_alert(p_window boolean,p_template boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.whatsapp_operator_alerts;t public.whatsapp_tasks;c public.whatsapp_conversations;token uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.whatsapp_config where id and outbound_enabled) then return null;end if;
 update public.whatsapp_operator_alerts set status='uncertain',last_error='delivery_outcome_unknown',updated_at=now()
  where status='sending' and claimed_at<now()-interval '2 minutes';
 update public.whatsapp_operator_alerts alerts_row set status='cancelled',updated_at=now() from public.whatsapp_tasks task_row
  where alerts_row.task_id=task_row.id and alerts_row.status='queued' and task_row.status<>'pending';
 select * into a from public.whatsapp_operator_alerts where status='queued' and attempts=0 order by created_at for update skip locked limit 1;
 if a.id is null then return null;end if;
 select * into t from public.whatsapp_tasks where id=a.task_id;
 select * into c from public.whatsapp_conversations where id=t.conversation_id;
 if t.status<>'pending' or c.status='closed' then
  update public.whatsapp_operator_alerts set status='cancelled',updated_at=now() where id=a.id;return null;end if;
 if not coalesce(p_window,false) and not coalesce(p_template,false) then
  update public.whatsapp_operator_alerts set last_error='approved_template_required',updated_at=now() where id=a.id;return null;end if;
 update public.whatsapp_operator_alerts set status='sending',attempts=1,lease_token=token,claimed_at=now(),last_error=null,updated_at=now() where id=a.id;
 return jsonb_build_object('id',a.id,'lease_token',token,'conversation_id',c.id,'branch_id',c.branch_id,'use_template',not coalesce(p_window,false));
end;$$;
create or replace function public.whatsapp_finish_operator_alert(p_id uuid,p_lease uuid,p_status text,p_meta_id text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare strongest text;
begin
 if p_status not in ('sent','failed','uncertain') then raise exception 'Estado inválido';end if;
 if p_status='sent' then select event->>'status' into strongest from public.whatsapp_inbox
  where kind='status' and event->>'meta_message_id'=p_meta_id and event->>'status' in ('sent','delivered','read')
  order by case event->>'status' when 'read' then 3 when 'delivered' then 2 else 1 end desc limit 1;end if;
 update public.whatsapp_operator_alerts set status=coalesce(strongest,p_status),meta_message_id=p_meta_id,last_error=left(p_error,100),updated_at=now()
 where id=p_id and lease_token=p_lease and status in ('sending','uncertain');return found;
end;$$;
create or replace function importados_private.whatsapp_operator_alert_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='status' then
  update public.whatsapp_operator_alerts set status=new.event->>'status',updated_at=now()
   where meta_message_id=new.event->>'meta_message_id'
   and ((new.event->>'status'='read' and status in ('sending','sent','delivered','uncertain'))
    or (new.event->>'status'='delivered' and status in ('sending','sent','uncertain'))
    or (new.event->>'status'='failed' and status in ('sending','sent','uncertain')));
 end if;return new;
end;$$;
drop trigger if exists whatsapp_operator_alert_receipt on public.whatsapp_inbox;
create trigger whatsapp_operator_alert_receipt after insert on public.whatsapp_inbox for each row execute function importados_private.whatsapp_operator_alert_receipt();
revoke all on function importados_private.whatsapp_operator_alert_receipt() from public,anon,authenticated;

revoke all on function importados_private.whatsapp_queue_operator_alert(),public.whatsapp_claim_operator_alert(boolean,boolean),public.whatsapp_finish_operator_alert(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.whatsapp_claim_operator_alert(boolean,boolean),public.whatsapp_finish_operator_alert(uuid,uuid,text,text,text) to service_role;
commit;
