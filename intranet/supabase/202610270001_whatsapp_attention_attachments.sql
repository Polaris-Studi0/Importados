-- Importados only. Incremental, compatible with decisions without task_id/priority.
begin;

create table if not exists public.whatsapp_incoming_media (
 message_id uuid primary key references public.whatsapp_messages(id),
 conversation_id uuid not null references public.whatsapp_conversations(id),
 meta_media_id text not null check(meta_media_id ~ '^[0-9]{5,30}$'),
 phone_number_id text not null, kind text not null, filename text,
 status text not null default 'pending' check(status in ('pending','fetching','stored','failed','unavailable','unsupported')),
 auto_download boolean not null default true, attempts integer not null default 0,
 lease_token uuid,claimed_at timestamptz,next_attempt_at timestamptz not null default now(),
 storage_path text,mime_type text,size_bytes integer,sha256 text,last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.whatsapp_incoming_media enable row level security;
revoke all on public.whatsapp_incoming_media from public,anon,authenticated;
grant all on public.whatsapp_incoming_media to service_role;
insert into storage.buckets(id,name,public,file_size_limit)
 values('whatsapp-incoming-media','whatsapp-incoming-media',false,16777216) on conflict(id) do nothing;

create or replace function importados_private.whatsapp_queue_incoming_media()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.direction='inbound' and new.kind in ('image','audio','document','video','sticker') and new.attachment->>'id' ~ '^[0-9]{5,30}$' then
  insert into public.whatsapp_incoming_media(message_id,conversation_id,meta_media_id,phone_number_id,kind,filename)
   select new.id,new.conversation_id,new.attachment->>'id',i.event->>'phone_number_id',new.kind,left(new.attachment->>'filename',180)
   from public.whatsapp_inbox i where i.id=new.inbox_id on conflict(message_id) do nothing;
 end if;return new;
end;$$;
drop trigger if exists whatsapp_queue_incoming_media on public.whatsapp_messages;
create trigger whatsapp_queue_incoming_media after insert on public.whatsapp_messages for each row execute function importados_private.whatsapp_queue_incoming_media();
-- Old references are recovered only when an authorized member opens that file.
insert into public.whatsapp_incoming_media(message_id,conversation_id,meta_media_id,phone_number_id,kind,filename,auto_download)
 select m.id,m.conversation_id,m.attachment->>'id',i.event->>'phone_number_id',m.kind,left(m.attachment->>'filename',180),false
 from public.whatsapp_messages m join public.whatsapp_inbox i on i.id=m.inbox_id
 where m.direction='inbound' and m.kind in ('image','audio','document','video','sticker') and m.attachment->>'id' ~ '^[0-9]{5,30}$'
 on conflict(message_id) do nothing;
update public.whatsapp_messages m set attachment=jsonb_set(m.attachment,'{persisted}','false')
 where m.direction='inbound' and m.attachment->>'id' is not null and not exists(select 1 from public.whatsapp_incoming_media f where f.message_id=m.id and f.status='stored');

create or replace function public.whatsapp_claim_incoming_media(p_message uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.whatsapp_incoming_media;token uuid:=gen_random_uuid();
begin
 update public.whatsapp_incoming_media set status='failed',next_attempt_at=now(),last_error='interrupted_download'
  where status='fetching' and claimed_at<now()-interval '2 minutes';
 select a.* into f from public.whatsapp_incoming_media a join public.whatsapp_conversations c on c.id=a.conversation_id
  join public.whatsapp_config cfg on cfg.id
  where c.consent_status='granted' and c.consent_version=cfg.privacy_version
   and (p_message is null and a.auto_download and a.attempts<3 or p_message=a.message_id and a.attempts<6)
   and a.status in ('pending','failed') and (p_message is not null or a.next_attempt_at<=now())
  order by a.created_at for update of a skip locked limit 1;
 if f.message_id is null then return null;end if;
 update public.whatsapp_incoming_media set status='fetching',lease_token=token,claimed_at=now(),attempts=attempts+1,updated_at=now()
  where message_id=f.message_id;
 return to_jsonb(f)||jsonb_build_object('lease_token',token);
end;$$;
create or replace function public.whatsapp_finish_incoming_media(p_message uuid,p_lease uuid,p_status text,p_data jsonb default '{}')
returns boolean language plpgsql security definer set search_path='' as $$
declare f public.whatsapp_incoming_media;
begin
 select * into f from public.whatsapp_incoming_media where message_id=p_message for update;
 if f.status<>'fetching' or f.lease_token is distinct from p_lease then return false;end if;
 if p_status not in ('stored','failed','unavailable','unsupported') then raise exception 'Estado inválido';end if;
 if p_status='stored' and (coalesce((p_data->>'size_bytes')::integer,0) not between 1 and 16777216
  or coalesce(p_data->>'sha256','') !~ '^[a-f0-9]{64}$' or p_data->>'storage_path' is distinct from f.conversation_id::text||'/'||f.message_id::text
  or coalesce(p_data->>'mime_type','')='') then raise exception 'Archivo inválido';end if;
 update public.whatsapp_incoming_media set status=p_status,storage_path=p_data->>'storage_path',mime_type=p_data->>'mime_type',
  size_bytes=(p_data->>'size_bytes')::integer,sha256=p_data->>'sha256',last_error=left(p_data->>'error',80),next_attempt_at=now()+interval '2 minutes',updated_at=now()
  where message_id=p_message;
 update public.whatsapp_messages set attachment=coalesce(attachment,'{}')||jsonb_build_object('persisted',p_status='stored','media_status',p_status)
  where id=p_message and conversation_id=f.conversation_id;
 return true;
end;$$;

alter table public.whatsapp_tasks add column if not exists priority text not null default 'normal' check(priority in ('normal','high'));
alter table public.whatsapp_tasks add column if not exists revision integer not null default 0;
alter table public.whatsapp_tasks add column if not exists latest_question text;
create table if not exists public.whatsapp_task_updates (
 id uuid primary key default gen_random_uuid(),task_id uuid not null references public.whatsapp_tasks(id),
 message_id uuid not null references public.whatsapp_messages(id),question text not null check(char_length(question) between 1 and 4000),
 priority text not null check(priority in ('normal','high')),created_at timestamptz not null default now(),unique(task_id,message_id)
);
create table if not exists public.whatsapp_task_attachments (
 task_id uuid not null references public.whatsapp_tasks(id),message_id uuid primary key references public.whatsapp_incoming_media(message_id),created_at timestamptz not null default now()
);
alter table public.whatsapp_task_updates enable row level security;
alter table public.whatsapp_task_attachments enable row level security;
revoke all on public.whatsapp_task_updates,public.whatsapp_task_attachments from public,anon,authenticated;
grant all on public.whatsapp_task_updates,public.whatsapp_task_attachments to service_role;

-- Link a captionless reference only to one recent general consultation in this session.
create or replace function public.whatsapp_link_incoming_reference(p_message uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.whatsapp_messages;c public.whatsapp_conversations;tasks uuid[];existing uuid;
begin
 select task_id into existing from public.whatsapp_task_attachments where message_id=p_message;if existing is not null then return existing;end if;
 select * into m from public.whatsapp_messages where id=p_message;
 select * into c from public.whatsapp_conversations where id=m.conversation_id for update;
 if c.manual_paused or c.status<>'open' or c.consent_status<>'granted' or m.kind<>'image' or trim(m.body)<>''
  or not exists(select 1 from public.whatsapp_config where id and privacy_version=c.consent_version)
  or not exists(select 1 from public.whatsapp_incoming_media where message_id=m.id and status='stored') then return null;end if;
 select array_agg(id) into tasks from public.whatsapp_tasks where conversation_id=c.id and branch_id=c.branch_id and status='pending'
  and kind in ('human_request','missing_information','pqrs','stock_check') and created_at>=c.session_started_at
  and updated_at between m.created_at-interval '2 minutes' and m.created_at;
 if coalesce(cardinality(tasks),0)<>1 then return null;end if;
 -- An intervening text can change the product or need: leave the choice to the operator.
 if exists(select 1 from public.whatsapp_messages x where x.conversation_id=c.id and x.direction='inbound' and x.kind='text'
  and x.created_at>(select created_at from public.whatsapp_messages where id=(select source_message_id from public.whatsapp_tasks where id=tasks[1]))
  and x.created_at<m.created_at) then return null;end if;
 insert into public.whatsapp_task_attachments(task_id,message_id) values(tasks[1],m.id) on conflict(message_id) do nothing;
 return tasks[1];
end;$$;

alter table public.whatsapp_operator_alerts add column if not exists revision integer not null default 0;
alter table public.whatsapp_operator_alerts add column if not exists reason text not null default 'new';
alter table public.whatsapp_operator_alerts drop constraint if exists whatsapp_operator_alerts_task_id_key;
create unique index if not exists whatsapp_operator_alerts_revision_unique on public.whatsapp_operator_alerts(task_id,revision);
create or replace function importados_private.whatsapp_queue_operator_alert()
returns trigger language plpgsql security definer set search_path='' as $$
declare last_at timestamptz;
begin
 if new.status<>'pending' then return new;end if;
 if tg_op='INSERT' then
  insert into public.whatsapp_operator_alerts(task_id,revision) values(new.id,new.revision) on conflict(task_id,revision) do nothing;
 elsif new.revision>old.revision then
  -- Coalesce changes while an unsent notice is queued, without another delivery.
  if exists(select 1 from public.whatsapp_operator_alerts where task_id=new.id and status='queued' and attempts=0) then return new;end if;
  select max(created_at) into last_at from public.whatsapp_operator_alerts where task_id=new.id;
  if (new.priority='high' and old.priority<>'high') or last_at is null or last_at<now()-interval '10 minutes' then
   insert into public.whatsapp_operator_alerts(task_id,revision,reason) values(new.id,new.revision,case when new.priority='high' and old.priority<>'high' then 'priority' else 'update' end)
    on conflict(task_id,revision) do nothing;
  end if;
 end if;return new;
end;$$;
drop trigger if exists whatsapp_queue_operator_alert on public.whatsapp_tasks;
create trigger whatsapp_queue_operator_alert after insert or update on public.whatsapp_tasks for each row execute function importados_private.whatsapp_queue_operator_alert();

create or replace function public.whatsapp_commit_reply(p_conversation uuid,p_message uuid,p_control integer,p_context integer,p_request uuid,p_body text,p_purpose text,p_task jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;cfg public.whatsapp_config;out_id uuid;task_key text;task_question text;t public.whatsapp_tasks;target_task_id uuid;task_priority text;prior public.whatsapp_outbox;
begin
 select * into cfg from public.whatsapp_config where id;
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 if c.id is null or not cfg.ai_enabled or not cfg.outbound_enabled or c.manual_paused or c.status='closed'
 or c.control_version<>p_control or c.context_version<>p_context or c.last_customer_at<now()-interval '24 hours'
 or not exists(select 1 from public.whatsapp_messages where id=p_message and conversation_id=c.id and direction='inbound') then raise exception 'Propuesta fuera del contexto vigente';end if;
 if exists(select 1 from public.whatsapp_messages where conversation_id=c.id and direction='inbound' and created_at>(select created_at from public.whatsapp_messages where id=p_message)) then raise exception 'Existe un mensaje posterior';end if;
 if p_purpose not in ('privacy_notice','branch_selection','reply') or coalesce(char_length(trim(p_body)),0) not between 1 and 4000 then raise exception 'Respuesta inválida';end if;
 if c.consent_status='revoked' then raise exception 'Autorización retirada';end if;
 if p_purpose<>'privacy_notice' and (c.consent_status<>'granted' or c.consent_version is distinct from cfg.privacy_version) then raise exception 'Falta autorización vigente';end if;
 if p_purpose='privacy_notice' and (cfg.privacy_url is null or cfg.privacy_version is null or position(cfg.privacy_url in p_body)=0) then raise exception 'Falta aviso de privacidad';end if;
 select * into prior from public.whatsapp_outbox where request_id=p_request;
 if prior.id is not null then
  if prior.conversation_id<>c.id or prior.body<>trim(p_body) then raise exception 'Solicitud reutilizada';end if;
  return jsonb_build_object('outbox_id',prior.id);
 end if;
 if p_task is not null then
  task_question:=trim(p_task->>'question');task_priority:=coalesce(nullif(p_task->>'priority',''),'normal');
  if p_task->>'kind' not in ('human_request','missing_information','stock_check','payment_review','pqrs') or coalesce(char_length(task_question),0) not between 1 and 4000 or task_priority not in ('normal','high') then raise exception 'Pendiente inválido';end if;
  if coalesce(p_task->>'task_id','')<>'' then
   target_task_id:=(p_task->>'task_id')::uuid;
   select * into t from public.whatsapp_tasks where id=target_task_id for update;
   if t.id is null or t.conversation_id<>c.id or t.branch_id is distinct from c.branch_id or t.status<>'pending'
    or t.kind not in ('human_request','missing_information','pqrs','stock_check') or p_task->>'kind' not in ('human_request','missing_information','pqrs','stock_check')
    or t.created_at<c.session_started_at then raise exception 'Pendiente fuera del contexto vigente';end if;
   if t.source_message_id is distinct from p_message and not exists(select 1 from public.whatsapp_task_updates where task_id=t.id and message_id=p_message) then
    insert into public.whatsapp_task_updates(task_id,message_id,question,priority) values(t.id,p_message,task_question,task_priority);
    update public.whatsapp_tasks set latest_question=task_question,priority=case when t.priority='high' or task_priority='high' then 'high' else 'normal' end,
     revision=revision+1,updated_at=now() where id=t.id;
   end if;
  else
   task_key:=md5((p_task->>'kind')||':'||lower(task_question)||':'||c.session_started_at::text);
   insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key,priority)
   values(c.id,c.branch_id,p_task->>'kind',task_question,p_message,task_key,task_priority) on conflict(conversation_id,dedupe_key) where status='pending' do nothing;
  end if;
 end if;
 insert into public.whatsapp_outbox(conversation_id,request_id,body,source,purpose,expected_control_version,expected_context_version)
  values(c.id,p_request,trim(p_body),'assistant',p_purpose,c.control_version,c.context_version) returning id into out_id;
 if p_purpose='privacy_notice' then update public.whatsapp_conversations set consent_version=cfg.privacy_version,privacy_notice_delivered_at=null where id=c.id;end if;
 return jsonb_build_object('outbox_id',out_id);
end;$$;

revoke all on function importados_private.whatsapp_queue_incoming_media(),public.whatsapp_claim_incoming_media(uuid),public.whatsapp_finish_incoming_media(uuid,uuid,text,jsonb),public.whatsapp_link_incoming_reference(uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_claim_incoming_media(uuid),public.whatsapp_finish_incoming_media(uuid,uuid,text,jsonb),public.whatsapp_link_incoming_reference(uuid) to service_role;
create or replace function public.whatsapp_receive_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_config; incoming public.whatsapp_inbox; c public.whatsapp_conversations;
 msg public.whatsapp_messages; key text; occurred timestamptz; normalized text; existing_id uuid; s text;
begin
 select * into cfg from public.whatsapp_config where id;
 if not cfg.ingress_enabled or cfg.public_since is null then raise exception 'WhatsApp no está habilitado';end if;
 if p_event->>'phone_number_id' is distinct from cfg.phone_number_id or p_event->>'waba_id' is distinct from cfg.waba_id then raise exception 'Activo de WhatsApp no autorizado';end if;
 key:=p_event->>'event_key';
 if coalesce(char_length(key),0)<>64 or p_event->>'event_type' not in ('message','status') then raise exception 'Evento inválido';end if;
 insert into public.whatsapp_inbox(event_key,kind,event) values(key,p_event->>'event_type',p_event)
 on conflict(event_key) do nothing returning * into incoming;
 if incoming.id is null then return jsonb_build_object('duplicate',true);end if;
 if incoming.kind='status' then
  s:=p_event->>'status';
  if s not in ('sent','delivered','read','failed') then raise exception 'Estado inválido';end if;
  update public.whatsapp_outbox o set status=s,updated_at=now()
   where o.meta_message_id=p_event->>'meta_message_id' and
    ((s='failed' and o.status in ('sending','sent','uncertain')) or
     (s='sent' and o.status in ('sending','uncertain')) or
     (s='delivered' and o.status in ('sending','uncertain','sent')) or
     (s='read' and o.status in ('sending','uncertain','sent','delivered')));
  update public.whatsapp_messages m set status=o.status from public.whatsapp_outbox o
   where o.meta_message_id=p_event->>'meta_message_id' and m.id=o.message_id;
  update public.whatsapp_conversations target_conversation set privacy_notice_delivered_at=now()
   where exists(select 1 from public.whatsapp_outbox o where o.conversation_id=target_conversation.id and o.meta_message_id=p_event->>'meta_message_id'
    and o.purpose='privacy_notice' and o.status in ('delivered','read'));
  update public.whatsapp_inbox set state='processed',outcome='status_recorded',processed_at=now() where id=incoming.id;
  return jsonb_build_object('accepted',true,'kind','status');
 end if;
 occurred:=(p_event->>'occurred_at')::timestamptz;
 if occurred<cfg.public_since or occurred>now()+interval '5 minutes' then
  update public.whatsapp_inbox set state='blocked',outcome='outside_activation_window',processed_at=now() where id=incoming.id;
  return jsonb_build_object('accepted',true,'blocked',true);
 end if;
 if coalesce(char_length(p_event->>'meta_message_id'),0) not between 1 and 256
 or coalesce(char_length(p_event->>'identity_key'),0) not between 8 and 260
 or char_length(coalesce(p_event->>'body',''))>6000 then raise exception 'Mensaje inválido';end if;
 -- A message bearing both identifiers may link a phone-only contact. Conflicts never merge histories.
 perform pg_advisory_xact_lock(hashtextextended(p_event->>'identity_key',0));
 select * into c from public.whatsapp_conversations where identity_key=p_event->>'identity_key' for update;
 if c.id is null and nullif(p_event->>'customer_phone','') is not null then
  select * into c from public.whatsapp_conversations where customer_phone=p_event->>'customer_phone' for update;
  if c.id is not null and c.customer_bsuid is not null and c.customer_bsuid is distinct from p_event->>'customer_bsuid' then raise exception 'Identidad ambigua';end if;
 end if;
 if c.id is null then
  insert into public.whatsapp_conversations(identity_key,customer_phone,customer_bsuid,customer_name)
  values(p_event->>'identity_key',nullif(p_event->>'customer_phone',''),nullif(p_event->>'customer_bsuid',''),left(p_event->>'customer_name',120)) returning * into c;
 else
  update public.whatsapp_conversations set identity_key=p_event->>'identity_key',
   customer_phone=coalesce(customer_phone,nullif(p_event->>'customer_phone','')),
   customer_bsuid=coalesce(customer_bsuid,nullif(p_event->>'customer_bsuid','')) where id=c.id returning * into c;
 end if;
 select id into existing_id from public.whatsapp_messages where meta_message_id=p_event->>'meta_message_id';
 if existing_id is not null then
  update public.whatsapp_inbox set state='processed',outcome='duplicate_message',processed_at=now(),conversation_id=c.id where id=incoming.id;
  return jsonb_build_object('duplicate',true,'conversation_id',c.id);
 end if;
 insert into public.whatsapp_messages(conversation_id,inbox_id,meta_message_id,direction,source,kind,body,attachment,created_at)
 values(c.id,incoming.id,p_event->>'meta_message_id','inbound','customer',p_event->>'kind',coalesce(p_event->>'body',''),p_event->'attachment',occurred) returning * into msg;
 normalized:=upper(trim(coalesce(p_event->>'body','')));
 update public.whatsapp_conversations set
  session_started_at=case when last_customer_at is null or occurred>last_customer_at+interval '24 hours' then occurred else session_started_at end,
  branch_id=case when last_customer_at is not null and occurred>last_customer_at+interval '24 hours' then null else branch_id end,
  last_customer_at=greatest(last_customer_at,occurred),last_message_at=greatest(last_message_at,occurred),
  last_message_preview=case when last_message_at is null or occurred>=last_message_at then left(coalesce(p_event->>'body','['||(p_event->>'kind')||']'),180) else last_message_preview end,
  consent_status=case when normalized in ('NO ACEPTO','NO AUTORIZO','RETIRAR AUTORIZACION','RETIRAR AUTORIZACIÓN','NO ME ESCRIBAN','BAJA') then 'revoked'
   when normalized in ('ACEPTO','YO ACEPTO','SI ACEPTO','SÍ ACEPTO','SI','SÍ') and privacy_notice_delivered_at is not null and consent_version=cfg.privacy_version then 'granted' else consent_status end,
  consent_at=case when normalized in ('ACEPTO','YO ACEPTO','SI ACEPTO','SÍ ACEPTO','SI','SÍ') and privacy_notice_delivered_at is not null and consent_version=cfg.privacy_version then now() else consent_at end,
  privacy_notice_delivered_at=case when normalized in ('NO ACEPTO','NO AUTORIZO','RETIRAR AUTORIZACION','RETIRAR AUTORIZACIÓN','NO ME ESCRIBAN','BAJA') then null else privacy_notice_delivered_at end,
  context_version=context_version+1,updated_at=now()
 where id=c.id;
 update public.whatsapp_outbox set status='cancelled',last_error='new_customer_message',updated_at=now()
  where conversation_id=c.id and status='queued' and source='assistant';
 update public.whatsapp_inbox set conversation_id=c.id where id=incoming.id;
 return jsonb_build_object('accepted',true,'conversation_id',c.id,'message_id',msg.id,'inbox_id',incoming.id);
end;$$;

-- Claims do not include delivery retries. A lease that reaches Meta is always single attempt.

create or replace function public.whatsapp_claim_operator_alert(p_window boolean,p_template boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.whatsapp_operator_alerts;t public.whatsapp_tasks;c public.whatsapp_conversations;token uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.whatsapp_config where id and outbound_enabled) then return null;end if;
 update public.whatsapp_operator_alerts set status='uncertain',last_error='delivery_outcome_unknown',updated_at=now()
  where status='sending' and claimed_at<now()-interval '2 minutes';
 update public.whatsapp_operator_alerts alerts_row set status='cancelled',updated_at=now() from public.whatsapp_tasks task_row
  where alerts_row.task_id=task_row.id and alerts_row.status='queued' and task_row.status<>'pending';
 select alerts.* into a from public.whatsapp_operator_alerts alerts join public.whatsapp_tasks t_priority on t_priority.id=alerts.task_id where alerts.status='queued' and alerts.attempts=0 order by case when t_priority.priority='high' then 0 else 1 end,alerts.created_at for update of alerts skip locked limit 1;
 if a.id is null then return null;end if;
 select * into t from public.whatsapp_tasks where id=a.task_id;
 select * into c from public.whatsapp_conversations where id=t.conversation_id;
 if t.status<>'pending' or c.status='closed' or c.consent_status='revoked' then
  update public.whatsapp_operator_alerts set status='cancelled',updated_at=now() where id=a.id;return null;end if;
 if not coalesce(p_window,false) and not coalesce(p_template,false) then
  update public.whatsapp_operator_alerts set last_error='approved_template_required',updated_at=now() where id=a.id;return null;end if;
 update public.whatsapp_operator_alerts set status='sending',attempts=1,lease_token=token,claimed_at=now(),last_error=null,updated_at=now() where id=a.id;
 return jsonb_build_object('id',a.id,'lease_token',token,'conversation_id',c.id,'branch_id',c.branch_id,'use_template',not coalesce(p_window,false));
end;$$;

commit;
