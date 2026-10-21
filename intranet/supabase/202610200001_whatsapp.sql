-- Importados only. Apply after 202610120002_intranet.sql; no operational seed data.
-- The service owns ingestion and mutations. Browser roles have scoped read access only.
begin;

create table if not exists public.whatsapp_config (
 id boolean primary key default true check(id),
 ingress_enabled boolean not null default false,
 ai_enabled boolean not null default false,
 outbound_enabled boolean not null default false,
 app_id text not null default '1378513457688529',
 phone_number_id text, waba_id text,
 privacy_url text, privacy_version text,
 public_since timestamptz,
 updated_at timestamptz not null default now(),
 check (privacy_url is null or privacy_url like 'https://%')
);
insert into public.whatsapp_config(id) values(true) on conflict do nothing;

create table if not exists public.whatsapp_conversations (
 id uuid primary key default gen_random_uuid(), identity_key text not null unique,
 customer_phone text, customer_bsuid text, customer_name text,
 branch_id text references public.branches(id),
 status text not null default 'open' check(status in ('open','closed')),
 manual_paused boolean not null default false,
 consent_status text not null default 'unknown' check(consent_status in ('unknown','granted','revoked')),
 consent_version text, consent_at timestamptz, privacy_notice_delivered_at timestamptz,
 last_customer_at timestamptz, last_message_at timestamptz, last_message_preview text,session_started_at timestamptz not null default now(),
 control_version integer not null default 0, context_version integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(customer_phone is not null or customer_bsuid is not null),
 check(customer_phone is null or customer_phone ~ '^[1-9][0-9]{7,14}$'),
 check(customer_bsuid is null or customer_bsuid ~ '^[A-Z]{2}\.[A-Za-z0-9._:-]{6,253}$')
);
create unique index if not exists whatsapp_phone_unique on public.whatsapp_conversations(customer_phone) where customer_phone is not null;
create unique index if not exists whatsapp_bsuid_unique on public.whatsapp_conversations(customer_bsuid) where customer_bsuid is not null;
create index if not exists whatsapp_branch_updated on public.whatsapp_conversations(branch_id,updated_at desc);

create table if not exists public.whatsapp_inbox (
 id uuid primary key default gen_random_uuid(),event_key text not null unique,
 kind text not null check(kind in ('message','status','human_resolution')), event jsonb not null,
 conversation_id uuid references public.whatsapp_conversations(id),
 state text not null default 'pending' check(state in ('pending','processing','processed','blocked','failed')),
 attempts integer not null default 0, lease_token uuid, claimed_at timestamptz,
 outcome text, received_at timestamptz not null default now(),processed_at timestamptz
);
create index if not exists whatsapp_inbox_pending on public.whatsapp_inbox(state,received_at);
create table if not exists public.whatsapp_messages (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.whatsapp_conversations(id),
 inbox_id uuid references public.whatsapp_inbox(id),meta_message_id text unique,
 direction text not null check(direction in ('inbound','outbound')),
 source text not null check(source in ('customer','assistant','operator')),
 kind text not null,body text not null default '' check(char_length(body)<=6000),
 attachment jsonb, status text not null default 'received',actor_id uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists whatsapp_messages_conversation on public.whatsapp_messages(conversation_id,created_at desc,id desc);
create table if not exists public.whatsapp_tasks (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.whatsapp_conversations(id),
 branch_id text references public.branches(id),kind text not null,
 question text not null check(char_length(question) between 1 and 4000),
 source_message_id uuid references public.whatsapp_messages(id),dedupe_key text not null,
 status text not null default 'pending' check(status in ('pending','resolved','cancelled')),
 answer text check(char_length(answer)<=4000),resolved_by uuid references auth.users(id),resolved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists whatsapp_tasks_pending_unique on public.whatsapp_tasks(conversation_id,dedupe_key) where status='pending';
create index if not exists whatsapp_tasks_branch on public.whatsapp_tasks(branch_id,status,created_at desc);
create table if not exists public.whatsapp_outbox (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.whatsapp_conversations(id),
 request_id uuid not null unique,message_id uuid references public.whatsapp_messages(id),
 kind text not null default 'text' check(kind='text'),body text not null check(char_length(trim(body)) between 1 and 4000),
 source text not null check(source in ('assistant','operator')),purpose text not null default 'reply',
 expected_control_version integer not null,expected_context_version integer not null,
 status text not null default 'queued' check(status in ('queued','sending','sent','delivered','read','failed','uncertain','cancelled')),
 meta_message_id text unique,attempts integer not null default 0 check(attempts between 0 and 1),
 claimed_at timestamptz,lease_token uuid,last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists whatsapp_outbox_pending on public.whatsapp_outbox(status,created_at);
create table if not exists public.whatsapp_actions (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 conversation_id uuid not null references public.whatsapp_conversations(id),request_id uuid not null,
 action text not null,payload jsonb not null,response jsonb not null,created_at timestamptz not null default now(),unique(actor_id,request_id)
);
create table if not exists public.whatsapp_qr_assets (
 id uuid primary key default gen_random_uuid(),branch_id text not null references public.branches(id),
 label text not null check(char_length(label) between 1 and 120),storage_path text not null,
 active boolean not null default true,created_at timestamptz not null default now()
);

-- One signed Meta event is committed, with its message or status, before HTTP acknowledgement.
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
  consent_status=case when normalized in ('NO AUTORIZO','RETIRAR AUTORIZACION','RETIRAR AUTORIZACIÓN','NO ME ESCRIBAN','BAJA') then 'revoked'
   when normalized in ('ACEPTO','YO ACEPTO','SI ACEPTO','SÍ ACEPTO') and privacy_notice_delivered_at is not null and consent_version=cfg.privacy_version then 'granted' else consent_status end,
  consent_at=case when normalized in ('ACEPTO','YO ACEPTO','SI ACEPTO','SÍ ACEPTO') and privacy_notice_delivered_at is not null and consent_version=cfg.privacy_version then now() else consent_at end,
  privacy_notice_delivered_at=case when normalized in ('NO AUTORIZO','RETIRAR AUTORIZACION','RETIRAR AUTORIZACIÓN','NO ME ESCRIBAN','BAJA') then null else privacy_notice_delivered_at end,
  context_version=context_version+1,updated_at=now()
 where id=c.id;
 update public.whatsapp_outbox set status='cancelled',last_error='new_customer_message',updated_at=now()
  where conversation_id=c.id and status='queued' and source='assistant';
 update public.whatsapp_inbox set conversation_id=c.id where id=incoming.id;
 return jsonb_build_object('accepted',true,'conversation_id',c.id,'message_id',msg.id,'inbox_id',incoming.id);
end;$$;

-- Claims do not include delivery retries. A lease that reaches Meta is always single attempt.
create or replace function public.whatsapp_claim_inbox()
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_inbox;token uuid:=gen_random_uuid();
begin
 select incoming.* into i from public.whatsapp_inbox incoming join public.whatsapp_conversations c on c.id=incoming.conversation_id
 where incoming.kind in ('message','human_resolution') and
 (incoming.state='pending' or (incoming.state='processing' and incoming.claimed_at<now()-interval '5 minutes' and incoming.attempts<2))
 and (incoming.kind='message' or (not c.manual_paused and c.status='open'))
 order by incoming.received_at for update of incoming skip locked limit 1;
 if i.id is null then return null;end if;
 update public.whatsapp_inbox set state='processing',lease_token=token,claimed_at=now(),attempts=attempts+1 where id=i.id;
 return jsonb_build_object('id',i.id,'conversation_id',i.conversation_id,'lease_token',token,'kind',i.kind,'event',i.event);
end;$$;
create or replace function public.whatsapp_complete_inbox(p_id uuid,p_lease uuid,p_outcome text)
returns boolean language sql security definer set search_path='' as $$
 with changed as (update public.whatsapp_inbox set state='processed',outcome=left(p_outcome,100),processed_at=now()
 where id=p_id and state='processing' and lease_token=p_lease returning id) select exists(select 1 from changed);
$$;

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

create or replace function public.whatsapp_record_issue(p_conversation uuid,p_message uuid,p_inbox uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;question text;
begin
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 select left('Revisar esta consulta: el asistente no pudo preparar una respuesta segura. '||coalesce(body,''),4000)
  into question from public.whatsapp_messages where id=p_message and conversation_id=c.id and direction='inbound';
 if c.id is null or question is null or not exists(select 1 from public.whatsapp_inbox where id=p_inbox and conversation_id=c.id) then raise exception 'Consulta no disponible';end if;
 insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key)
 values(c.id,c.branch_id,'missing_information',question,p_message,'assistant-review:'||p_message::text)
 on conflict(conversation_id,dedupe_key) where status='pending' do nothing;
end;$$;

-- A proposal can create a text reply and a human task only. Commerce never bypasses staff.
create or replace function public.whatsapp_commit_reply(p_conversation uuid,p_message uuid,p_control integer,p_context integer,p_request uuid,p_body text,p_purpose text,p_task jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;cfg public.whatsapp_config;out_id uuid;task_key text;task_question text;
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
 if p_task is not null then
  task_question:=trim(p_task->>'question');
  if p_task->>'kind' not in ('human_request','missing_information','stock_check','payment_review','pqrs') or coalesce(char_length(task_question),0) not between 1 and 4000 then raise exception 'Pendiente inválido';end if;
  task_key:=md5((p_task->>'kind')||':'||lower(task_question));
  insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key)
  values(c.id,c.branch_id,p_task->>'kind',task_question,p_message,task_key) on conflict(conversation_id,dedupe_key) where status='pending' do nothing;
 end if;
 insert into public.whatsapp_outbox(conversation_id,request_id,body,source,purpose,expected_control_version,expected_context_version)
  values(c.id,p_request,trim(p_body),'assistant',p_purpose,c.control_version,c.context_version) on conflict(request_id) do nothing returning id into out_id;
 if out_id is null then select id into out_id from public.whatsapp_outbox where request_id=p_request and conversation_id=c.id and body=trim(p_body);end if;
 if out_id is null then raise exception 'Solicitud reutilizada';end if;
 if p_purpose='privacy_notice' then update public.whatsapp_conversations set consent_version=cfg.privacy_version,privacy_notice_delivered_at=null where id=c.id;end if;
 return jsonb_build_object('outbox_id',out_id);
end;$$;

create or replace function public.whatsapp_select_branch(p_conversation uuid,p_message uuid,p_context integer,p_branch text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.branches where id=p_branch and active) then raise exception 'Sede inválida';end if;
 update public.whatsapp_conversations set branch_id=p_branch,context_version=context_version+1,updated_at=now()
 where id=p_conversation and context_version=p_context and not manual_paused and status='open' and consent_status='granted'
 and exists(select 1 from public.whatsapp_messages where id=p_message and conversation_id=p_conversation and direction='inbound');
 return found;
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
 return jsonb_build_object('id',o.id,'lease_token',token,'body',o.body,'recipient',c.identity_key,'conversation_id',c.id,'source',o.source);
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
  insert into public.whatsapp_messages(conversation_id,meta_message_id,direction,source,kind,body,status)
   values(o.conversation_id,p_meta_id,'outbound',o.source,'text',o.body,coalesce(strongest,'sent')) returning id into m;
  update public.whatsapp_conversations set last_message_at=now(),last_message_preview=left(o.body,180),updated_at=now(),
   privacy_notice_delivered_at=case when o.purpose='privacy_notice' and strongest in ('delivered','read') then now() else privacy_notice_delivered_at end
   where id=o.conversation_id;
 end if;
 update public.whatsapp_outbox set status=coalesce(strongest,p_status),meta_message_id=p_meta_id,message_id=m,last_error=left(p_error,100),updated_at=now() where id=o.id;
 return true;
end;$$;

-- Explicit grants protect against Supabase default privileges and default PUBLIC function execution.
do $$declare t text;begin
 foreach t in array array['whatsapp_config','whatsapp_conversations','whatsapp_inbox','whatsapp_messages','whatsapp_tasks','whatsapp_outbox','whatsapp_actions','whatsapp_qr_assets'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end;$$;
grant select on public.whatsapp_conversations,public.whatsapp_messages,public.whatsapp_tasks,public.whatsapp_outbox,public.whatsapp_qr_assets to authenticated;
drop policy if exists whatsapp_conversations_read on public.whatsapp_conversations;
create policy whatsapp_conversations_read on public.whatsapp_conversations for select to authenticated using(public.is_admin() or public.can_access_branch(branch_id));
drop policy if exists whatsapp_messages_read on public.whatsapp_messages;
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated using(exists(select 1 from public.whatsapp_conversations c where c.id=conversation_id and (public.is_admin() or public.can_access_branch(c.branch_id))));
drop policy if exists whatsapp_tasks_read on public.whatsapp_tasks;
create policy whatsapp_tasks_read on public.whatsapp_tasks for select to authenticated using(exists(select 1 from public.whatsapp_conversations c where c.id=conversation_id and (public.is_admin() or public.can_access_branch(c.branch_id))));
drop policy if exists whatsapp_outbox_read on public.whatsapp_outbox;
create policy whatsapp_outbox_read on public.whatsapp_outbox for select to authenticated using(exists(select 1 from public.whatsapp_conversations c where c.id=conversation_id and (public.is_admin() or public.can_access_branch(c.branch_id))));
drop policy if exists whatsapp_qr_read on public.whatsapp_qr_assets;
create policy whatsapp_qr_read on public.whatsapp_qr_assets for select to authenticated using(public.is_admin() or public.can_access_branch(branch_id));
revoke all on function public.whatsapp_receive_event(jsonb),public.whatsapp_claim_inbox(),public.whatsapp_complete_inbox(uuid,uuid,text),public.whatsapp_staff_action(uuid,uuid,text,uuid,integer,jsonb),public.whatsapp_commit_reply(uuid,uuid,integer,integer,uuid,text,text,jsonb),public.whatsapp_select_branch(uuid,uuid,integer,text),public.whatsapp_claim_outbox(),public.whatsapp_finish_outbox(uuid,uuid,text,text,text),public.whatsapp_record_issue(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_receive_event(jsonb),public.whatsapp_claim_inbox(),public.whatsapp_complete_inbox(uuid,uuid,text),public.whatsapp_staff_action(uuid,uuid,text,uuid,integer,jsonb),public.whatsapp_commit_reply(uuid,uuid,integer,integer,uuid,text,text,jsonb),public.whatsapp_select_branch(uuid,uuid,integer,text),public.whatsapp_claim_outbox(),public.whatsapp_finish_outbox(uuid,uuid,text,text,text),public.whatsapp_record_issue(uuid,uuid,uuid) to service_role;
do $$declare t text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['whatsapp_conversations','whatsapp_messages','whatsapp_tasks'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
  end loop;
 end if;
end;$$;
comment on table public.whatsapp_outbox is 'Single delivery attempt. Uncertain outcomes require operator review; never automatic retry.';
comment on table public.whatsapp_qr_assets is 'Owned private QR references only; AI never approves payments.';
commit;
