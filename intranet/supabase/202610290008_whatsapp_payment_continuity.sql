-- Existing accepted purchases keep payment review after the delivery cutoff.
-- Expired reservations require an explicit audited admin revalidation, never a second payment.
begin;
create or replace function importados_private.whatsapp_delivery_open() returns boolean language sql stable set search_path='' as $$
 select not service_hours_enabled or ((now() at time zone 'America/Bogota')::time>=time '09:00' and (now() at time zone 'America/Bogota')::time<time '19:00') from public.whatsapp_config where id;
$$;
revoke all on function importados_private.whatsapp_delivery_open() from public,anon,authenticated;

create or replace function importados_private.whatsapp_commerce_task(p_checkout public.whatsapp_checkouts,p_message uuid,p_type text,p_question text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid;key text;begin
 key:='commerce:'||p_checkout.id::text||':'||p_type||':'||md5(case when p_type='payment' then jsonb_build_object('quote_id',p_payload->>'quote_id','method',p_payload->>'method','receipt_id',p_payload->>'receipt_id','missing_qr',p_payload->>'missing_qr')::text else p_payload::text end);
 select id into t from public.whatsapp_tasks where conversation_id=p_checkout.conversation_id and dedupe_key=key and status='pending';
 if p_type='payment' and p_payload->>'receipt_id' is not null then
 update public.whatsapp_tasks set status='cancelled',updated_at=now() where conversation_id=p_checkout.conversation_id and status='pending' and review_type='payment' and review_payload->>'checkout_id'=p_checkout.id::text and id is distinct from t;end if;
 if t is not null and p_type='payment' then
 update public.whatsapp_tasks set review_payload=p_payload||jsonb_build_object('checkout_id',p_checkout.id,'purchase_id',p_checkout.state->>'purchase_id'),revision=revision+1,updated_at=now() where id=t and (review_payload-'checkout_id'-'purchase_id') is distinct from p_payload;end if;
 if t is null then
 insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key,priority,review_type,review_payload)
 values(p_checkout.conversation_id,p_checkout.branch_id,case when p_type='payment' then 'payment_review' else 'stock_check' end,p_question,p_message,key,'high',case when p_payload->>'missing_qr'='true' then null else p_type end,p_payload||jsonb_build_object('checkout_id',p_checkout.id,'purchase_id',p_checkout.state->>'purchase_id')) returning id into t;
 end if;return t;
end;$$;

create or replace function public.whatsapp_commerce_turn(p_conversation uuid,p_message uuid,p_control integer,p_context integer,p_resource bigint,p_request uuid,p_decision jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;cfg public.whatsapp_config;ch public.whatsapp_checkouts;s jsonb;old_s jsonb;prior public.whatsapp_commerce_actions;
 i jsonb;prod public.products;inv public.branch_inventory;task public.whatsapp_tasks;items jsonb:='[]';patch jsonb;v text;k text;qty integer;subtotal bigint:=0;
 body text;out_id uuid;task_id uuid;summary_text text;accepted boolean;need text;held integer;until_at timestamptz;changed boolean:=false;asset public.whatsapp_payment_assets;receipt uuid;
begin
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 select * into cfg from public.whatsapp_config where id;
 select * into prior from public.whatsapp_commerce_actions where request_id=p_request;
 if prior.request_id is not null then
  if prior.conversation_id<>p_conversation or prior.payload<>p_decision then raise exception 'Identificador reutilizado';end if;return prior.result;
 end if;
 if c.id is null or not cfg.ai_enabled or not cfg.outbound_enabled or c.manual_paused or c.status<>'open' or c.consent_status<>'granted' or c.consent_version is distinct from cfg.privacy_version
 or c.control_version<>p_control or c.context_version<>p_context or cfg.resource_version<>p_resource or c.last_customer_at<=now()-interval '24 hours'
 or not importados_private.whatsapp_attention_open() or not exists(select 1 from public.whatsapp_messages where id=p_message and conversation_id=c.id and direction='inbound')
 or p_message is distinct from (select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1)
 then raise exception 'Propuesta fuera del contexto vigente';end if;
 select * into ch from public.whatsapp_checkouts where conversation_id=c.id for update;
 if ch.id is null then
  insert into public.whatsapp_checkouts(conversation_id,branch_id,session_started_at) values(c.id,c.branch_id,c.session_started_at) returning * into ch;
 elsif ch.branch_id is distinct from c.branch_id or ch.session_started_at<>c.session_started_at then
  delete from public.whatsapp_stock_holds where checkout_id=ch.id;
  update public.whatsapp_checkouts set branch_id=c.branch_id,session_started_at=c.session_started_at,state='{}',version=version+1 where id=ch.id returning * into ch;
 end if;
 s:=ch.state;old_s:=s;
 if s->>'stage' in ('ordered','cancelled') and (p_decision->'quote'<>'null'::jsonb or p_decision->'confirmed_item'<>'null'::jsonb) then s:='{}';end if;
 if not(s?'purchase_id') then s:=s||jsonb_build_object('purchase_id',gen_random_uuid());end if;
 if s->>'stage'='ordered' then body:='Tu pedido '||(s->>'order_number')||' ya quedó registrado. Puedes consultar su estado por aquí.';else
 if p_decision->>'cancel_cart'='true' then
  delete from public.whatsapp_stock_holds where checkout_id=ch.id;s:=jsonb_build_object('stage','cancelled');body:='Listo, cancelamos esta selección. No se creó un pedido.';
 else
 if p_decision->'quote' is not null and p_decision->'quote'<>'null'::jsonb then
  if jsonb_typeof(p_decision->'quote'->'items') is distinct from 'array' or jsonb_array_length(p_decision->'quote'->'items') not between 1 and 10 then raise exception 'Selección inválida';end if;
  for i in select value from jsonb_array_elements(p_decision->'quote'->'items') order by value->>'product_id' loop
   qty:=(i->>'quantity')::integer;
   select * into prod from public.products where id=(i->>'product_id')::uuid and active for share;
   select * into inv from public.branch_inventory where branch_id=c.branch_id and product_id=prod.id for update;
   select coalesce(sum(quantity),0) into held from public.whatsapp_stock_holds where product_id=prod.id and branch_id=c.branch_id and expires_at>now() and checkout_id<>ch.id;
   if prod.id is null or qty not between 1 and 99 or inv.valid_until<=now() or inv.valid_until is null or inv.quantity-held<qty
    or prod.offer_starts_at>now() or prod.offer_ends_at<=now() or (i->>'unit_price_cop')::bigint<>prod.price then raise exception 'Stock o precio requieren confirmación';end if;
   items:=items||jsonb_build_array(jsonb_build_object('product_id',prod.id,'name',prod.name,'quantity',qty,'unit_price_cop',prod.price));
   subtotal:=subtotal+qty*prod.price;
  end loop;
  if (select count(distinct x->>'product_id') from jsonb_array_elements(items)x)<>jsonb_array_length(items) then raise exception 'Producto repetido';end if;
  if items is distinct from s->'items' then s:=s||jsonb_build_object('items',items,'cart',items,'pending_selection',null,'subtotal_cop',subtotal,'stock_valid_until',importados_private.whatsapp_day_close());changed:=true;end if;
 elsif p_decision->'confirmed_item' is not null and p_decision->'confirmed_item'<>'null'::jsonb then
  i:=p_decision->'confirmed_item';
  select * into task from public.whatsapp_tasks where id=(i->>'source_task_id')::uuid and conversation_id=c.id and branch_id=c.branch_id and status='resolved' and created_at>=c.session_started_at;
  if task.id is null or coalesce(char_length(i->>'source_excerpt'),0)<1 or position(lower(i->>'source_excerpt') in lower(task.answer))=0
   or coalesce(char_length(i->>'name'),0) not between 1 and 160 or (i->>'unit_price_cop')::bigint not between 1 and 999999999 or (i->>'quantity')::integer not between 1 and 99 then raise exception 'Selección sin confirmación';end if;
  if i is distinct from s->'pending_selection' then
   s:=s||jsonb_build_object('pending_selection',i,'items',jsonb_build_array(i),'cart','[]'::jsonb,'subtotal_cop',(i->>'unit_price_cop')::bigint*(i->>'quantity')::integer,'stock_valid_until',null);changed:=true;
  end if;
 end if;
 patch:=coalesce(p_decision->'checkout','{}');
 if jsonb_typeof(patch) is distinct from 'object' then raise exception 'Datos inválidos';end if;
 for k,v in select key,value#>>'{}' from jsonb_each(patch) loop
  if k not in ('customer_name','recipient_name','recipient_phone','fulfillment_type','delivery_address','delivery_zone','payment_method') or char_length(v)>300 then raise exception 'Dato no permitido';end if;
  v:=trim(v);if v='' or v is null then continue;end if;
  if k='fulfillment_type' and v not in ('pickup','delivery') or k='payment_method' and v not in ('transfer','addi','sistecredito','cash_prepaid') then raise exception 'Opción inválida';end if;
  if k='recipient_phone' then v:=regexp_replace(v,'[^0-9]','','g');if v !~ '^[0-9]{10,15}$' then raise exception 'Teléfono inválido';end if;end if;
  if k in ('customer_name','recipient_name') and (char_length(v)<2 or v ~ '[0-9]' or v ~ '[<>]') then raise exception 'Nombre inválido';end if;
  if s->>k is distinct from v and k<>'payment_method' then changed:=true;end if;
  s:=s||jsonb_build_object(k,v);
 end loop;
 if s->>'fulfillment_type'='pickup' then s:=s||jsonb_build_object('delivery_fee_cop',0);end if;
 if changed then
  s:=s||jsonb_build_object('stage','collecting');
  s:=s-'accepted_quote_id'-'summary_outbox_id'-'quote_id'-'reservation_until'-'payment_approved'-'payment_receipt_id';
  if old_s->>'delivery_address' is distinct from s->>'delivery_address' or old_s->>'delivery_zone' is distinct from s->>'delivery_zone' or old_s->>'fulfillment_type' is distinct from s->>'fulfillment_type' then s:=s-'delivery_fee_cop'-'eta_minutes';end if;
  delete from public.whatsapp_stock_holds where checkout_id=ch.id;
  update public.whatsapp_tasks set status='cancelled',updated_at=now() where conversation_id=c.id and status='pending' and review_payload->>'checkout_id'=ch.id::text and (review_type='payment' or review_type='stock' and old_s->'items' is distinct from s->'items' or review_type='delivery' and (old_s->>'delivery_address' is distinct from s->>'delivery_address' or old_s->>'delivery_zone' is distinct from s->>'delivery_zone' or old_s->>'fulfillment_type' is distinct from s->>'fulfillment_type'));
 end if;
 if s->>'review_declined'='stock' and old_s->'items' is distinct from s->'items' or s->>'review_declined'='delivery' and (old_s->>'delivery_address' is distinct from s->>'delivery_address' or old_s->>'delivery_zone' is distinct from s->>'delivery_zone') or s->>'review_declined'='payment' and old_s->>'payment_method' is distinct from s->>'payment_method' then s:=s-'review_declined'-'review_answer';end if;
 receipt:=nullif(s->>'payment_receipt_id','')::uuid;
 if s->>'accepted_quote_id'=s->>'quote_id' and s->>'payment_method'='transfer' and exists(select 1 from public.whatsapp_messages where id=p_message and conversation_id=c.id and attachment->>'persisted'='true' and kind in ('image','document')) then
  receipt:=p_message;
  if receipt is distinct from nullif(old_s->>'payment_receipt_id','')::uuid and s->>'review_declined'='payment' then s:=s-'review_declined'-'review_answer';end if;
  s:=s||jsonb_build_object('payment_receipt_id',receipt);
 end if;
 if receipt is not null and coalesce(s->>'review_declined','')<>'payment' and s->>'accepted_quote_id'=s->>'quote_id' and ((s->>'reservation_until')::timestamptz<=now() or (s->>'stock_valid_until')::timestamptz<=now()) then
  ch.state:=s;
  task_id:=importados_private.whatsapp_commerce_task(ch,p_message,'payment','Validar el comprobante recibido y revalidar existencias, precio y entrega antes de confirmar este pedido. No pedir otro pago.',jsonb_build_object('quote_id',s->>'quote_id','method',s->>'payment_method','total_cop',(s->>'subtotal_cop')::bigint+coalesce((s->>'delivery_fee_cop')::bigint,0),'receipt_id',receipt,'items',s->'items','address',s->>'delivery_address','zone',s->>'delivery_zone','needs_revalidation',true));
  s:=s||jsonb_build_object('stage','payment_review');body:='Recibí el comprobante. El equipo debe validar el pago y confirmar cómo continuar tu pedido. No necesitas pagar de nuevo mientras lo revisamos.';
 elsif s?'review_declined' then body:=s->>'review_answer';
 elsif jsonb_array_length(coalesce(s->'items','[]'))=0 then body:='¿Qué producto te gustaría comprar?';
 elsif cfg.service_hours_enabled and s->>'fulfillment_type'='delivery' and not importados_private.whatsapp_delivery_open() and coalesce(s->>'accepted_quote_id','')='' then
  body:='Hoy recibimos domicilios hasta las 7:00 p. m. Puedes recoger en la sede hasta las 8:00 p. m. o retomar el domicilio mañana desde las 9:00 a. m. ¿Qué prefieres?';
 else
  ch.state:=s;
  if nullif(s->>'stock_valid_until','')::timestamptz is null or (s->>'stock_valid_until')::timestamptz<=now() then
   task_id:=importados_private.whatsapp_commerce_task(ch,p_message,'stock','Confirmar existencias y precio de los artículos elegidos para esta compra.',jsonb_build_object('items',s->'items'));
   s:=s||jsonb_build_object('stage','stock_review');
  end if;
  need:=importados_private.whatsapp_checkout_prompt(s);
  if need<>'' then body:=need;
  elsif task_id is not null then body:='Ya tengo los datos de tu compra. Dame un momento y te confirmo la disponibilidad.';
  elsif s->>'fulfillment_type'='delivery' and not(s?'delivery_fee_cop') then
   task_id:=importados_private.whatsapp_commerce_task(ch,p_message,'delivery','Confirmar cobertura, valor del domicilio y tiempo estimado para esta dirección.',jsonb_build_object('address',s->>'delivery_address','zone',s->>'delivery_zone'));
   s:=s||jsonb_build_object('stage','fee_review');body:='Ya tengo tus datos. Dame un momento y te confirmo el valor del domicilio antes de que pagues.';
  else
   accepted:=nullif(s->>'accepted_quote_id','') is not null and s->>'accepted_quote_id'=s->>'quote_id' and nullif(s->>'reservation_until','')::timestamptz>now();
   if p_decision->>'accept_summary'='true' and not accepted then
    if not exists(select 1 from public.whatsapp_outbox where id=nullif(s->>'summary_outbox_id','')::uuid and conversation_id=c.id and purpose='commerce_summary' and status in ('delivered','read')) then raise exception 'Resumen sin entregar';end if;
    until_at:=least(now()+interval '15 minutes',importados_private.whatsapp_day_close(),(s->>'stock_valid_until')::timestamptz);
    if until_at<=now() then raise exception 'Cotización vencida';end if;
    for i in select value from jsonb_array_elements(s->'items') order by value->>'product_id' loop
     if i->>'product_id' is null then continue;end if;
     select * into prod from public.products where id=(i->>'product_id')::uuid and active for share;
     select * into inv from public.branch_inventory where product_id=prod.id and branch_id=c.branch_id for update;
     select coalesce(sum(quantity),0) into held from public.whatsapp_stock_holds where product_id=prod.id and branch_id=c.branch_id and checkout_id<>ch.id and expires_at>now();
     if prod.id is null or prod.price<>(i->>'unit_price_cop')::bigint or inv.valid_until<=now() or inv.quantity-held<(i->>'quantity')::integer or prod.offer_ends_at<=now() then raise exception 'Stock o precio cambiaron';end if;
     insert into public.whatsapp_stock_holds values(ch.id,prod.id,c.branch_id,(i->>'quantity')::integer,until_at) on conflict(checkout_id,product_id) do update set quantity=excluded.quantity,expires_at=excluded.expires_at;
    end loop;
    s:=s||jsonb_build_object('accepted_quote_id',s->>'quote_id','reservation_until',until_at,'stage','awaiting_payment');accepted:=true;
   end if;
   if not accepted then
    s:=s||jsonb_build_object('quote_id',gen_random_uuid(),'stage','summary');
    select string_agg((x->>'quantity')||' × '||(x->>'name')||case when coalesce(x->>'variant','')<>'' then ' · '||(x->>'variant') else '' end||': '||importados_private.whatsapp_money((x->>'quantity')::integer*(x->>'unit_price_cop')::bigint),E'\n') into summary_text from jsonb_array_elements(s->'items') x;
    body:='Revisa tu compra:'||E'\n'||summary_text||E'\nA nombre de: '||(s->>'customer_name')||E'\nContacto: '||(s->>'recipient_phone')||
     case when s->>'fulfillment_type'='delivery' then E'\nRecibe: '||(s->>'recipient_name')||E'\nDirección: '||(s->>'delivery_address')||' · '||(s->>'delivery_zone')||E'\nDomicilio: '||importados_private.whatsapp_money((s->>'delivery_fee_cop')::bigint) else E'\nRecogida en la sede' end||
     E'\nTotal: '||importados_private.whatsapp_money((s->>'subtotal_cop')::bigint+coalesce((s->>'delivery_fee_cop')::bigint,0))||E'\n¿Confirmas este resumen?';
   elsif s->>'payment_approved'='true' then
    body:='El pago está validado. Estamos terminando de registrar tu pedido.';
   elsif s->>'payment_method'='cash_prepaid' and s->>'fulfillment_type'<>'pickup' then body:='El pago en efectivo es para recoger en sede. Para domicilio puedes elegir transferencia, Addi o Sistecrédito, con validación del equipo.';
   elsif coalesce(s->>'payment_method','')='' then body:='¿Cómo prefieres pagar: transferencia, Addi o Sistecrédito?'||case when s->>'fulfillment_type'='pickup' then ' También puedes pagar en efectivo al recoger.' else '' end;
   elsif s->>'payment_method'='transfer' and receipt is null then
    select * into asset from public.whatsapp_payment_assets where branch_id=c.branch_id and active;
    if asset.id is null then
     body:='Dame un momento y te confirmo los datos para pagar en esta sede.';
     task_id:=importados_private.whatsapp_commerce_task(ch,p_message,'payment','Cargar el QR vigente de esta sede o indicar un medio de pago verificado; aún no hay comprobante.',jsonb_build_object('quote_id',s->>'quote_id','missing_qr',true));
    else body:='Te comparto el QR de esta sede. El total es '||importados_private.whatsapp_money((s->>'subtotal_cop')::bigint+coalesce((s->>'delivery_fee_cop')::bigint,0))||'. Cuando pagues, envía el comprobante por aquí. El equipo lo revisará antes de confirmar el pedido.';
    end if;
   else
    task_id:=importados_private.whatsapp_commerce_task(ch,p_message,'payment','Validar el pago o autorizar el pago en sede de esta compra. No se confirma el pedido sin aprobación.',jsonb_build_object('quote_id',s->>'quote_id','method',s->>'payment_method','total_cop',(s->>'subtotal_cop')::bigint+coalesce((s->>'delivery_fee_cop')::bigint,0),'receipt_id',receipt,'items',s->'items','address',s->>'delivery_address','zone',s->>'delivery_zone'));
    s:=s||jsonb_build_object('stage','payment_review','payment_receipt_id',receipt);body:=case when s->>'payment_method'='cash_prepaid' then 'Dame un momento y confirmo la recogida con pago en sede.' else 'El equipo debe validar el pago antes de confirmar tu pedido. Te respondo por aquí cuando tengamos la confirmación.' end;
   end if;
  end if;
 end if;
 end if;end if;
 insert into public.whatsapp_outbox(conversation_id,request_id,body,source,purpose,expected_control_version,expected_context_version)
 values(c.id,p_request,body,'assistant',case when s->>'stage'='summary' and body like 'Revisa tu compra:%' then 'commerce_summary' else 'reply' end,c.control_version,c.context_version) returning id into out_id;
 if s->>'stage'='summary' and body like 'Revisa tu compra:%' then s:=s||jsonb_build_object('summary_outbox_id',out_id);end if;
 if asset.id is not null then
 insert into public.whatsapp_outbox(conversation_id,request_id,kind,body,source,purpose,bot_media,expected_control_version,expected_context_version)
 values(c.id,gen_random_uuid(),'image',asset.label,'assistant','payment_qr',jsonb_build_object('type','qr','asset_id',asset.id,'storage_path',asset.storage_path,'bucket','whatsapp-payment-qr','mime_type',asset.mime_type,'checkout_id',ch.id,'quote_id',s->>'quote_id','resource_version',cfg.resource_version),c.control_version,c.context_version);
 end if;
 update public.whatsapp_checkouts set state=s,version=version+1,updated_at=now() where id=ch.id;
 insert into public.whatsapp_commerce_actions values(p_request,c.id,p_decision,jsonb_build_object('ok',true,'outbox_id',out_id,'task_id',task_id),now());
 return jsonb_build_object('ok',true,'outbox_id',out_id,'task_id',task_id);
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
  if p_result->>'revalidate_expired'='true' and s->>'accepted_quote_id'=s->>'quote_id' and t.review_payload->>'quote_id'=s->>'quote_id' and ((s->>'reservation_until')::timestamptz<=now() or (s->>'stock_valid_until')::timestamptz<=now() or t.review_payload->>'needs_revalidation'='true') then
   if not importados_private.whatsapp_attention_open() or importados_private.whatsapp_day_close()<=now() then raise exception 'La revalidación requiere horario de atención';end if;
   for i in select value from jsonb_array_elements(s->'items') order by value->>'product_id' loop
    if i->>'product_id' is null then continue;end if;
    select * into inv from public.branch_inventory where branch_id=c.branch_id and product_id=(i->>'product_id')::uuid for update;
    select coalesce(sum(quantity),0) into held from public.whatsapp_stock_holds where branch_id=c.branch_id and product_id=inv.product_id and checkout_id<>ch.id and expires_at>now();
    if inv.product_id is null or inv.valid_until<=now() or inv.quantity-held<(i->>'quantity')::integer or not exists(select 1 from public.products p where p.id=inv.product_id and active and price=(i->>'unit_price_cop')::bigint and (offer_starts_at is null or offer_starts_at<=now()) and (offer_ends_at is null or offer_ends_at>now())) then raise exception 'Existencias o precio cambiaron. Revisa el pago y las alternativas con el cliente';end if;
    insert into public.whatsapp_stock_holds values(ch.id,inv.product_id,c.branch_id,(i->>'quantity')::integer,least(now()+interval '15 minutes',importados_private.whatsapp_day_close())) on conflict(checkout_id,product_id) do update set quantity=excluded.quantity,expires_at=excluded.expires_at;
   end loop;
   s:=s||jsonb_build_object('reservation_until',least(now()+interval '15 minutes',importados_private.whatsapp_day_close()),'stock_valid_until',importados_private.whatsapp_day_close());
  end if;
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
commit;
