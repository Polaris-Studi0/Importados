-- Preserve existing intake and extend accepted wording, service hours and safe fallback.
begin;

CREATE OR REPLACE FUNCTION public.whatsapp_receive_event(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 normalized:=upper(trim(regexp_replace(translate(coalesce(p_event->>'body',''),'áéíóúÁÉÍÓÚ','aeiouAEIOU'),'[^a-zA-Z0-9]+',' ','g')));
 update public.whatsapp_conversations set
  session_started_at=case when last_customer_at is null or occurred>last_customer_at+interval '24 hours' then occurred else session_started_at end,
  branch_id=case when last_customer_at is not null and occurred>last_customer_at+interval '24 hours' then null else branch_id end,
  last_customer_at=greatest(last_customer_at,occurred),last_message_at=greatest(last_message_at,occurred),
  last_message_preview=case when last_message_at is null or occurred>=last_message_at then left(coalesce(p_event->>'body','['||(p_event->>'kind')||']'),180) else last_message_preview end,
  consent_status=case when normalized in ('NO ACEPTO','NO AUTORIZO','RETIRAR AUTORIZACION','RETIRAR AUTORIZACIÓN','NO ME ESCRIBAN','BAJA') then 'revoked'
   when normalized in ('ACEPTO','YO ACEPTO','SI ACEPTO','SÍ ACEPTO','SI','SÍ','SI ACEPTO GRACIAS','ACEPTO GRACIAS','SI GRACIAS') and privacy_notice_delivered_at is not null and consent_version=cfg.privacy_version then 'granted' else consent_status end,
  consent_at=case when normalized in ('ACEPTO','YO ACEPTO','SI ACEPTO','SÍ ACEPTO','SI','SÍ','SI ACEPTO GRACIAS','ACEPTO GRACIAS','SI GRACIAS') and privacy_notice_delivered_at is not null and consent_version=cfg.privacy_version then now() else consent_at end,
  privacy_notice_delivered_at=case when normalized in ('NO ACEPTO','NO AUTORIZO','RETIRAR AUTORIZACION','RETIRAR AUTORIZACIÓN','NO ME ESCRIBAN','BAJA') then null else privacy_notice_delivered_at end,
  context_version=context_version+1,updated_at=now()
 where id=c.id;
 update public.whatsapp_outbox set status='cancelled',last_error='new_customer_message',updated_at=now()
  where conversation_id=c.id and status='queued' and source='assistant';
 update public.whatsapp_inbox set conversation_id=c.id where id=incoming.id;
 return jsonb_build_object('accepted',true,'conversation_id',c.id,'message_id',msg.id,'inbox_id',incoming.id);
end;$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_commit_reply(p_conversation uuid, p_message uuid, p_control integer, p_context integer, p_request uuid, p_body text, p_purpose text, p_task jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.whatsapp_conversations;cfg public.whatsapp_config;out_id uuid;task_key text;task_question text;t public.whatsapp_tasks;target_task_id uuid;task_priority text;prior public.whatsapp_outbox;
begin
 select * into cfg from public.whatsapp_config where id;
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 if c.id is null or not cfg.ai_enabled or not cfg.outbound_enabled or c.manual_paused or c.status='closed'
 or c.control_version<>p_control or c.context_version<>p_context or c.last_customer_at<now()-interval '24 hours'
 or not exists(select 1 from public.whatsapp_messages where id=p_message and conversation_id=c.id and direction='inbound') then raise exception 'Propuesta fuera del contexto vigente';end if;
 if p_message is distinct from (select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1) then raise exception 'Existe un mensaje posterior';end if;
 if p_purpose not in ('privacy_notice','privacy_reminder','branch_selection','reply') or coalesce(char_length(trim(p_body)),0) not between 1 and 4000 then raise exception 'Respuesta inválida';end if;
 if c.consent_status='revoked' then raise exception 'Autorización retirada';end if;
 if p_purpose not in ('privacy_notice','privacy_reminder') and (c.consent_status<>'granted' or c.consent_version is distinct from cfg.privacy_version) then raise exception 'Falta autorización vigente';end if;
 if p_purpose='privacy_reminder' and c.privacy_notice_delivered_at is null then raise exception 'Falta aviso entregado';end if;
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
    or (t.created_at<c.session_started_at and not importados_private.whatsapp_case_resume_allowed(c,t)) then raise exception 'Pendiente fuera del contexto vigente';end if;
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
end;$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_claim_inbox()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.whatsapp_inbox;token uuid:=gen_random_uuid();
begin
 select incoming.* into i from public.whatsapp_inbox incoming join public.whatsapp_conversations c on c.id=incoming.conversation_id
 where incoming.kind in ('message','human_resolution','service_reopen') and
 (incoming.state='pending' or (incoming.state='processing' and incoming.claimed_at<now()-interval '5 minutes' and incoming.attempts<2))
 and (incoming.kind='message' or (not c.manual_paused and c.status='open' and importados_private.whatsapp_attention_open()))
 order by incoming.received_at for update of incoming skip locked limit 1;
 if i.id is null then return null;end if;
 update public.whatsapp_inbox set state='processing',lease_token=token,claimed_at=now(),attempts=attempts+1 where id=i.id;
 return jsonb_build_object('id',i.id,'conversation_id',i.conversation_id,'lease_token',token,'kind',i.kind,'event',i.event);
end;$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_claim_outbox()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 or (o.purpose not in ('privacy_notice','privacy_reminder') and (c.consent_status<>'granted' or c.consent_version is distinct from cfg.privacy_version)) then
  update public.whatsapp_outbox set status='cancelled',last_error='guards_changed',updated_at=now() where id=o.id;
  return null;
 end if;
 if o.source='assistant' and o.purpose not in ('privacy_notice','privacy_reminder','outside_hours') and not importados_private.whatsapp_attention_open() then
  perform public.whatsapp_defer_service(c.id,(select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1),c.control_version,c.context_version);
  update public.whatsapp_outbox set status='cancelled',last_error='outside_attention_hours' where id=o.id;return null;end if;
 if o.bot_media is not null and (o.bot_media->>'resource_version' is distinct from cfg.resource_version::text or (o.bot_media->>'type'='qr' and not exists(select 1 from public.whatsapp_checkouts ch where ch.id=(o.bot_media->>'checkout_id')::uuid and ch.conversation_id=c.id and ch.state->>'accepted_quote_id'=o.bot_media->>'quote_id' and nullif(ch.state->>'reservation_until','')::timestamptz>now()))) then
 update public.whatsapp_outbox set status='cancelled',last_error='media_context_changed' where id=o.id;return null;end if;
 update public.whatsapp_outbox set status='sending',attempts=1,claimed_at=now(),lease_token=token,updated_at=now() where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',token,'body',o.body,'kind',o.kind,'media_asset_id',o.media_asset_id,'recipient',c.identity_key,'conversation_id',c.id,'source',o.source,'bot_media',o.bot_media);
end;$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_staff_action(p_actor uuid, p_conversation uuid, p_action text, p_request uuid, p_expected integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.whatsapp_tasks set branch_id=p_payload->>'branch_id',updated_at=now() where conversation_id=c.id and status='pending' and review_type is null;
 elsif p_action='resolve_task' then
  v_task:=(p_payload->>'task_id')::uuid;v_answer:=trim(p_payload->>'answer');
  if coalesce(char_length(v_answer),0) not between 1 and 4000 then raise exception 'Agrega una respuesta válida';end if;
  update public.whatsapp_tasks set status='resolved',answer=v_answer,resolved_by=p_actor,resolved_at=now(),updated_at=now()
   where id=v_task and conversation_id=c.id and status='pending' and review_type is null;
  if not found then raise exception 'Pendiente no disponible';end if;
  if not exists(select 1 from public.whatsapp_tasks where id=v_task and kind='new_order') then
  insert into public.whatsapp_inbox(event_key,kind,event,conversation_id)
   values(md5('resolution:'||v_task::text||':'||p_request::text)||md5(p_request::text),'human_resolution',jsonb_build_object('task_id',v_task),c.id);end if;
 elsif p_action in ('send_image','send_document') then
  select * into cfg from public.whatsapp_config where id;body:=coalesce(nullif(trim(p_payload->>'text'),''),'Foto de producto');
  if not cfg.outbound_enabled or not c.manual_paused or c.status='closed' or c.consent_status<>'granted'
   or c.consent_version is distinct from cfg.privacy_version or c.last_customer_at is null or c.last_customer_at<now()-interval '24 hours'
   then raise exception 'El envío requiere control manual, autorización y ventana vigente';end if;
  if char_length(body)>1024 or not exists(select 1 from public.whatsapp_operator_media m
   where m.id=(p_payload->>'media_id')::uuid and m.conversation_id=c.id and m.actor_id=p_actor and (m.mime_type='application/pdf')=(p_action='send_document'))
   then raise exception 'Foto no disponible en esta conversación';end if;
  insert into public.whatsapp_outbox(conversation_id,request_id,kind,media_asset_id,body,source,expected_control_version,expected_context_version)
   values(c.id,p_request,case when p_action='send_document' then 'document' else 'image' end,(p_payload->>'media_id')::uuid,body,'operator',c.control_version+1,c.context_version+1) returning id into out_id;
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
end;$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_record_issue(p_conversation uuid, p_message uuid, p_inbox uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.whatsapp_conversations;question text;
begin
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 select left('Revisar esta consulta: el asistente no pudo preparar una respuesta segura. '||coalesce(body,''),4000)
  into question from public.whatsapp_messages where id=p_message and conversation_id=c.id and direction='inbound';
 if c.id is null or question is null or not exists(select 1 from public.whatsapp_inbox where id=p_inbox and conversation_id=c.id) then raise exception 'Consulta no disponible';end if;
 if c.manual_paused or c.status='closed' or c.consent_status<>'granted' or p_message is distinct from (select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1) then return;end if;
 insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key)
 values(c.id,c.branch_id,'missing_information',question,p_message,'assistant-review:'||md5(question)||':'||c.session_started_at::text)
 on conflict(conversation_id,dedupe_key) where status='pending' do nothing;
 if importados_private.whatsapp_attention_open() then
 insert into public.whatsapp_outbox(conversation_id,request_id,body,source,purpose,expected_control_version,expected_context_version) values(c.id,p_inbox,'Dame un momento y te confirmo.','assistant','reply',c.control_version,c.context_version) on conflict(request_id) do nothing;end if;
end;$function$;

commit;
