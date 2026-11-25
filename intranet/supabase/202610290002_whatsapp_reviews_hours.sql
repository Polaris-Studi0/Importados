begin;
create table if not exists public.whatsapp_service_waits(
 conversation_id uuid primary key references public.whatsapp_conversations(id),message_id uuid not null references public.whatsapp_messages(id),
 control_version integer not null,context_version integer not null,due_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','prepared','cancelled')),updated_at timestamptz not null default now()
);
alter table public.whatsapp_service_waits enable row level security;
revoke all on public.whatsapp_service_waits from anon,authenticated;
grant all on public.whatsapp_service_waits to service_role;
alter table public.whatsapp_inbox drop constraint if exists whatsapp_inbox_kind_check;
alter table public.whatsapp_inbox add constraint whatsapp_inbox_kind_check check(kind in ('message','status','human_resolution','service_reopen'));
create or replace function public.whatsapp_defer_service(p_conversation uuid,p_message uuid,p_control integer,p_context integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;due timestamptz;oid uuid;req uuid;body text;
begin
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 if c.id is null or c.manual_paused or c.status<>'open' or c.consent_status<>'granted' or c.control_version<>p_control or c.context_version<>p_context
 or p_message is distinct from (select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1)
 or importados_private.whatsapp_attention_open() then return null;end if;
 due:=(date_trunc('day',now() at time zone 'America/Bogota')+interval '9 hours'+case when (now() at time zone 'America/Bogota')::time>=time '09:00' then interval '1 day' else interval '0 day' end) at time zone 'America/Bogota';
 insert into public.whatsapp_service_waits(conversation_id,message_id,control_version,context_version,due_at) values(c.id,p_message,c.control_version,c.context_version,due)
 on conflict(conversation_id) do update set message_id=excluded.message_id,control_version=excluded.control_version,context_version=excluded.context_version,due_at=excluded.due_at,status='pending',updated_at=now();
 req:=md5('closed:'||c.id::text||':'||due::text)::uuid;
 body:='Gracias por escribirnos. Atendemos de 9:00 a. m. a 8:00 p. m., hora de Colombia. Ahora estamos fuera de horario. '||case when (now() at time zone 'America/Bogota')::time<time '09:00' then 'Hoy' else 'Mañana' end||' desde las 9:00 a. m. retomaremos tu consulta por aquí. Los domicilios se gestionan hasta las 7:00 p. m.';
 insert into public.whatsapp_outbox(conversation_id,request_id,body,source,purpose,expected_control_version,expected_context_version) values(c.id,req,body,'assistant','outside_hours',c.control_version,c.context_version) on conflict(request_id) do update set status='queued',last_error=null,expected_control_version=excluded.expected_control_version,expected_context_version=excluded.expected_context_version where whatsapp_outbox.status='cancelled' and whatsapp_outbox.attempts=0 returning id into oid;
 return jsonb_build_object('outbox_id',oid,'due_at',due);
end;$$;
create or replace function public.whatsapp_prepare_reopening() returns boolean
language plpgsql security definer set search_path='' as $$
declare w public.whatsapp_service_waits;c public.whatsapp_conversations;begin
 if not importados_private.whatsapp_attention_open() then return false;end if;
 select * into w from public.whatsapp_service_waits where status='pending' and due_at<=now() order by due_at for update skip locked limit 1;
 if w.conversation_id is null then return false;end if;
 select * into c from public.whatsapp_conversations where id=w.conversation_id;
 if c.manual_paused or c.status<>'open' or c.consent_status<>'granted' or c.control_version<>w.control_version or c.context_version<>w.context_version or c.last_customer_at<=now()-interval '24 hours' then
 update public.whatsapp_service_waits set status='cancelled',updated_at=now() where conversation_id=c.id;return true;end if;
 insert into public.whatsapp_inbox(event_key,kind,event,conversation_id)
 values(md5('open:'||c.id::text||':'||w.message_id::text)||md5(w.due_at::text),'service_reopen',jsonb_build_object('message_id',w.message_id),c.id) on conflict(event_key) do nothing;
 update public.whatsapp_service_waits set status='prepared',updated_at=now() where conversation_id=c.id;return true;
end;$$;

create or replace function public.whatsapp_review_checkout(p_actor uuid,p_conversation uuid,p_task uuid,p_expected integer,p_request uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles;c public.whatsapp_conversations;t public.whatsapp_tasks;ch public.whatsapp_checkouts;s jsonb;prior public.whatsapp_actions;
 amount bigint;eta integer;i jsonb;o public.orders;inv public.branch_inventory;v_answer text;items jsonb;body text;oid uuid;id_value uuid;held integer;
begin
 select * into actor from public.profiles where id=p_actor and active;
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 if actor.id is null or c.id is null or not(actor.role='admin' or actor.role='cashier' and actor.branch_id=c.branch_id) then raise exception 'Conversación no disponible';end if;
 select * into prior from public.whatsapp_actions where actor_id=p_actor and request_id=p_request;
 if prior.id is not null then if prior.action<>'review_checkout' or prior.conversation_id<>c.id or prior.payload<>jsonb_build_object('task_id',p_task,'result',p_result) then raise exception 'Identificador reutilizado';end if;return prior.response;end if;
 if c.control_version<>p_expected then raise exception 'La conversación cambió. Actualiza antes de continuar';end if;
 select * into t from public.whatsapp_tasks where id=p_task and conversation_id=c.id and branch_id=c.branch_id and status='pending' and review_type is not null for update;
 select * into ch from public.whatsapp_checkouts where id=nullif(t.review_payload->>'checkout_id','')::uuid and conversation_id=c.id and branch_id=c.branch_id and session_started_at=c.session_started_at for update;
 if t.id is null or ch.id is null or t.created_at<c.session_started_at or t.review_payload->>'purchase_id' is distinct from ch.state->>'purchase_id' or c.status<>'open' or c.consent_status<>'granted' then raise exception 'Revisión fuera del contexto vigente';end if;
 if t.review_type='payment' and actor.role<>'admin' then raise exception 'Solo administración puede aprobar pagos y autorizar pedidos';end if;
 if jsonb_typeof(p_result->'approved') is distinct from 'boolean' then raise exception 'Confirma si apruebas la revisión';end if;
 s:=ch.state;
 if p_result->>'approved'='false' then
  v_answer:=trim(p_result->>'answer');if coalesce(char_length(v_answer),0) not between 2 and 1800 then raise exception 'Explica qué debemos comunicar al cliente';end if;
  s:=s||jsonb_build_object('stage','collecting','review_declined',t.review_type,'review_answer',v_answer);
 else
 if t.review_type='stock' then
  if t.review_payload->'items' is distinct from s->'items' or importados_private.whatsapp_day_close()<=now() then raise exception 'Selección vencida o modificada';end if;
  s:=s||jsonb_build_object('stock_valid_until',importados_private.whatsapp_day_close(),'stage','collecting');v_answer:='Tenemos disponibilidad de los artículos elegidos al precio indicado.';
 elsif t.review_type='delivery' then
  if t.review_payload->>'address' is distinct from s->>'delivery_address' or t.review_payload->>'zone' is distinct from s->>'delivery_zone' then raise exception 'La dirección cambió';end if;
  amount:=(p_result->>'delivery_fee_cop')::bigint;eta:=nullif(p_result->>'eta_minutes','')::integer;
  if amount is null or amount not between 0 and 100000000 or eta is not null and eta not between 1 and 1440 then raise exception 'Revisa la tarifa y el tiempo';end if;
  s:=s||jsonb_build_object('delivery_fee_cop',amount,'eta_minutes',eta,'stage','collecting');v_answer:='El domicilio cuesta '||importados_private.whatsapp_money(amount)||'.';
 elsif t.review_type='payment' then
  if t.review_payload->>'method' is distinct from s->>'payment_method' or t.review_payload->>'receipt_id' is distinct from s->>'payment_receipt_id' or t.review_payload->>'missing_qr'='true' or t.review_payload->>'quote_id' is distinct from s->>'quote_id' or s->>'accepted_quote_id' is distinct from s->>'quote_id'
   or nullif(s->>'reservation_until','')::timestamptz is null or (s->>'reservation_until')::timestamptz<=now() then raise exception 'Revalida la cotización y existencias antes de aprobar';end if;
  if s->>'payment_method'='transfer' and not exists(select 1 from public.whatsapp_messages where id=nullif(t.review_payload->>'receipt_id','')::uuid and conversation_id=c.id and attachment->>'persisted'='true' and kind in ('image','document')) then raise exception 'Falta comprobante recibido para validar la transferencia';end if;
  if (t.review_payload->>'total_cop')::bigint<> (s->>'subtotal_cop')::bigint+coalesce((s->>'delivery_fee_cop')::bigint,0) then raise exception 'El total cambió';end if;
  if s->>'payment_method'='cash_prepaid' and s->>'fulfillment_type'<>'pickup' then raise exception 'El efectivo solo aplica a recogida';end if;
  for i in select value from jsonb_array_elements(s->'items') order by value->>'product_id' loop
   if i->>'product_id' is not null then
    select * into inv from public.branch_inventory where branch_id=c.branch_id and product_id=(i->>'product_id')::uuid for update;
    if inv.valid_until<=now() or inv.quantity<(i->>'quantity')::integer or not exists(select 1 from public.whatsapp_stock_holds where checkout_id=ch.id and product_id=inv.product_id and quantity=(i->>'quantity')::integer and expires_at>now()) then raise exception 'Stock o reserva vencieron';end if;
   elsif nullif(s->>'stock_valid_until','')::timestamptz<=now() then raise exception 'Existencias vencidas';end if;
  end loop;
  select jsonb_agg(jsonb_build_object('name',(x->>'name')||case when coalesce(x->>'variant','')<>'' then ' · '||(x->>'variant') else '' end,'qty',(x->>'quantity')::integer,'unit_price',(x->>'unit_price_cop')::bigint)) into items from jsonb_array_elements(s->'items')x;
  insert into public.orders(branch_id,fulfillment_type,customer_name,customer_phone,delivery_address,delivery_zone,items,delivery_fee,payment_method,payment_reference,source,customer_notes,eta_minutes,promised_at,whatsapp_conversation_id,whatsapp_checkout_id)
  values(c.branch_id,s->>'fulfillment_type',s->>'customer_name',s->>'recipient_phone',s->>'delivery_address',s->>'delivery_zone',items,coalesce((s->>'delivery_fee_cop')::bigint,0),s->>'payment_method','Aprobación del equipo: '||t.id::text,'WhatsApp',case when s->>'fulfillment_type'='delivery' then 'Recibe: '||(s->>'recipient_name') else null end,nullif(s->>'eta_minutes','')::integer,case when nullif(s->>'eta_minutes','') is not null then now()+((s->>'eta_minutes')::integer*interval '1 minute') end,c.id,(s->>'purchase_id')::uuid) returning * into o;
  for i in select value from jsonb_array_elements(s->'items') loop
   if i->>'product_id' is not null then update public.branch_inventory set quantity=quantity-(i->>'quantity')::integer,updated_at=now() where branch_id=c.branch_id and product_id=(i->>'product_id')::uuid;end if;
  end loop;
  delete from public.whatsapp_stock_holds where checkout_id=ch.id;
  s:=s||jsonb_build_object('stage','ordered','order_id',o.id,'order_number',o.order_number,'payment_approved',true);
  v_answer:='Tu pedido '||o.order_number||' quedó registrado. Total: '||importados_private.whatsapp_money(o.total+o.delivery_fee)||'. '||case when o.payment_method='cash_prepaid' then 'Pagarás al recoger en la sede.' else 'El pago está validado.' end||case when o.promised_at is not null then ' La llegada está estimada para las '||to_char(o.promised_at at time zone 'America/Bogota','HH24:MI')||' de hoy. Es una hora aproximada.' else '' end||' Puedes consultar el estado por este chat.';
  insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key,priority) values(c.id,c.branch_id,'new_order','Nueva compra por WhatsApp: '||o.order_number||'. Gestionar en Pedidos.',t.source_message_id,'new-order:'||o.id,'high') returning id into id_value;
 end if;
 end if;
 update public.whatsapp_tasks set status='resolved',answer=v_answer,review_result=p_result,resolved_by=actor.id,resolved_at=now(),updated_at=now() where id=t.id;
 update public.whatsapp_checkouts set state=s,version=version+1,updated_at=now() where id=ch.id;
 -- No manual takeover is released. The durable continuation waits until resume.
 insert into public.whatsapp_inbox(event_key,kind,event,conversation_id) values(md5('review:'||t.id::text)||md5(p_request::text),'human_resolution',jsonb_build_object('task_id',t.id,'checkout_review',true),c.id);
 select jsonb_build_object('ok',true,'conversation',to_jsonb(c)) into body;
 insert into public.whatsapp_actions(actor_id,conversation_id,request_id,action,payload,response) values(actor.id,c.id,p_request,'review_checkout',jsonb_build_object('task_id',p_task,'result',p_result),body::jsonb);
 return body::jsonb;
end;$$;
revoke all on function public.whatsapp_defer_service(uuid,uuid,integer,integer),public.whatsapp_prepare_reopening(),public.whatsapp_review_checkout(uuid,uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_defer_service(uuid,uuid,integer,integer),public.whatsapp_prepare_reopening(),public.whatsapp_review_checkout(uuid,uuid,uuid,integer,uuid,jsonb) to service_role;
grant insert(regular_price,offer_starts_at,offer_ends_at),update(regular_price,offer_starts_at,offer_ends_at) on public.products to authenticated;
commit;
