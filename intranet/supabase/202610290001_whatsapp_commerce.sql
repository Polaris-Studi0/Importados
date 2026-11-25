-- Importados only. Additive migration; preserves customers, tasks and manual control.
begin;
alter table public.whatsapp_messages add column if not exists sequence_id bigint generated always as identity;
create index if not exists whatsapp_messages_sequence on public.whatsapp_messages(conversation_id,created_at desc,sequence_id desc);
alter table public.whatsapp_config add column if not exists resource_version bigint not null default 0;
alter table public.whatsapp_config add column if not exists service_hours_enabled boolean not null default false;
alter table public.branch_inventory add column if not exists valid_until timestamptz;
alter table public.products add column if not exists regular_price bigint;
alter table public.products add column if not exists offer_starts_at timestamptz;
alter table public.products add column if not exists offer_ends_at timestamptz;
alter table public.orders add column if not exists whatsapp_conversation_id uuid references public.whatsapp_conversations(id);
alter table public.orders add column if not exists whatsapp_checkout_id uuid unique;
alter table public.whatsapp_tasks add column if not exists review_type text check(review_type in ('stock','delivery','payment'));
alter table public.whatsapp_tasks add column if not exists review_payload jsonb;
alter table public.whatsapp_tasks add column if not exists review_result jsonb;
alter table public.whatsapp_outbox add column if not exists bot_media jsonb;

create table if not exists public.whatsapp_checkouts(
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null unique references public.whatsapp_conversations(id),
 branch_id text not null references public.branches(id), session_started_at timestamptz not null,
 state jsonb not null default '{}', version integer not null default 0, updated_at timestamptz not null default now()
);
create table if not exists public.whatsapp_commerce_actions(
 request_id uuid primary key,conversation_id uuid not null references public.whatsapp_conversations(id),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.whatsapp_stock_holds(
 checkout_id uuid not null references public.whatsapp_checkouts(id),product_id uuid not null references public.products(id),
 branch_id text not null references public.branches(id),quantity integer not null check(quantity>0),expires_at timestamptz not null,
 primary key(checkout_id,product_id)
);
create table if not exists public.whatsapp_payment_assets(
 id uuid primary key default gen_random_uuid(),branch_id text not null unique references public.branches(id),
 storage_path text not null unique,mime_type text not null check(mime_type in ('image/jpeg','image/png')),
 label text not null check(char_length(label) between 1 and 160),active boolean not null default true,
 updated_at timestamptz not null default now()
);
create or replace function importados_private.whatsapp_resource_changed() returns trigger
language plpgsql security definer set search_path='' as $$begin
 update public.whatsapp_config set resource_version=resource_version+1 where id;return null;
end;$$;
do $$declare t text;begin
 foreach t in array array['products','branch_inventory','branch_knowledge','branches','whatsapp_payment_assets'] loop
 execute format('drop trigger if exists whatsapp_resource_changed on public.%I',t);
 execute format('create trigger whatsapp_resource_changed after insert or update or delete on public.%I for each statement execute function importados_private.whatsapp_resource_changed()',t);
 end loop;
 foreach t in array array['whatsapp_checkouts','whatsapp_commerce_actions','whatsapp_stock_holds','whatsapp_payment_assets'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end;$$;

create or replace function importados_private.whatsapp_attention_open() returns boolean
language sql stable set search_path='' as $$
 select not service_hours_enabled or
 ((now() at time zone 'America/Bogota')::time >= time '09:00' and (now() at time zone 'America/Bogota')::time < time '20:00')
 from public.whatsapp_config where id;
$$;
create or replace function importados_private.whatsapp_day_close() returns timestamptz
language sql stable set search_path='' as $$select (date_trunc('day',now() at time zone 'America/Bogota')+interval '20 hours') at time zone 'America/Bogota'$$;
create or replace function public.set_branch_inventory(p_branch_id text,p_product_id uuid,p_quantity integer)
returns public.branch_inventory language plpgsql security definer set search_path='' as $$
declare result public.branch_inventory;previous integer;actor text;
begin
 if not public.is_admin() then raise exception 'Solo administración puede registrar inventario';end if;
 if p_quantity is null or p_quantity not between 0 and 100000000 then raise exception 'Cantidad inválida';end if;
 if not exists(select 1 from public.products where id=p_product_id and active) or not exists(select 1 from public.branches where id=p_branch_id and active) then raise exception 'Producto o sede no disponible';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_branch_id||':'||p_product_id::text,0));
 select quantity into previous from public.branch_inventory where branch_id=p_branch_id and product_id=p_product_id for update;
 insert into public.branch_inventory(branch_id,product_id,quantity,valid_until) values(p_branch_id,p_product_id,p_quantity,importados_private.whatsapp_day_close())
 on conflict(branch_id,product_id) do update set quantity=excluded.quantity,valid_until=excluded.valid_until,updated_at=now() returning * into result;
 select full_name into actor from public.profiles where id=auth.uid();
 insert into public.inventory_events(branch_id,product_id,before_quantity,after_quantity,actor_id,actor_name)
 values(p_branch_id,p_product_id,coalesce(previous,0),p_quantity,auth.uid(),actor);
 return result;
end;$$;

create or replace function importados_private.whatsapp_case_resume_allowed(c public.whatsapp_conversations,t public.whatsapp_tasks) returns boolean
language sql stable security definer set search_path='' as $$
 select c.branch_id is not null and t.conversation_id=c.id and t.branch_id=c.branch_id and t.review_type is null
 and t.kind in ('human_request','missing_information','stock_check','pqrs') and t.created_at>=now()-interval '30 days'
 and (t.status='pending' or t.resolved_at>=c.session_started_at)
 and (select count(*) from public.whatsapp_tasks x where x.conversation_id=c.id and x.branch_id=c.branch_id and x.review_type is null and x.kind in ('human_request','missing_information','stock_check','pqrs') and x.created_at<c.session_started_at and x.created_at>=now()-interval '30 days' and (x.status='pending' or x.resolved_at>=c.session_started_at))=1
 and exists(select 1 from public.whatsapp_messages m where m.conversation_id=c.id and m.direction='inbound' and m.created_at>=c.session_started_at and translate(lower(m.body),'áéíóú','aeiou') ~ 'sigo esperando|aun espero|respuesta pendiente|mi (consulta|caso)|retom|lo mio')
 and not exists(select 1 from public.whatsapp_checkouts ch where ch.conversation_id=c.id and ch.session_started_at=c.session_started_at and ch.state->>'stage' not in ('ordered','cancelled') and (ch.state->'pending_selection'<>'null'::jsonb or jsonb_array_length(coalesce(ch.state->'cart','[]'))>0));
$$;
revoke all on function importados_private.whatsapp_case_resume_allowed(public.whatsapp_conversations,public.whatsapp_tasks) from public,anon,authenticated;

create or replace function public.whatsapp_turn_snapshot(p_conversation uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('conversation',to_jsonb(c),
 'messages',coalesce((select jsonb_agg(m order by m.created_at desc,m.sequence_id desc) from (select id,direction,source,kind,body,attachment,created_at,status,sequence_id,inbox_id from public.whatsapp_messages where conversation_id=c.id and created_at>=c.session_started_at order by created_at desc,sequence_id desc limit 60)m),'[]'),
 'tasks',coalesce((select jsonb_agg(t order by t.updated_at desc) from (select * from public.whatsapp_tasks where conversation_id=c.id and (created_at>=c.session_started_at or importados_private.whatsapp_case_resume_allowed(c,whatsapp_tasks)) and branch_id is not distinct from c.branch_id order by updated_at desc,id limit 100)t),'[]'),
 'branches',(select jsonb_agg(b order by id) from public.branches b where active),
 'knowledge',coalesce((select jsonb_agg(k) from (select * from public.branch_knowledge where active and (branch_id is null or branch_id=c.branch_id) order by updated_at desc,id limit 35)k),'[]'),
 'products',coalesce((select jsonb_agg(p) from (select * from public.products where active and c.branch_id is not null order by id limit 100)p),'[]'),
 'inventory',coalesce((select jsonb_agg(i) from public.branch_inventory i where branch_id=c.branch_id),'[]'),
 'holds',coalesce((select jsonb_agg(h) from public.whatsapp_stock_holds h where branch_id=c.branch_id and expires_at>now() and checkout_id is distinct from (select id from public.whatsapp_checkouts where conversation_id=c.id)),'[]'),
 'checkout',(select to_jsonb(s) from public.whatsapp_checkouts s where conversation_id=c.id and branch_id=c.branch_id and session_started_at=c.session_started_at),
 'offered_delivered',exists(select 1 from public.whatsapp_outbox o join public.whatsapp_checkouts s on s.conversation_id=c.id where o.id=nullif(s.state->>'options_outbox_id','')::uuid and o.status in ('delivered','read')),
 'summary_delivered',exists(select 1 from public.whatsapp_outbox o join public.whatsapp_checkouts s on s.conversation_id=c.id where o.id=nullif(s.state->>'summary_outbox_id','')::uuid and o.status in ('delivered','read')),
 'qrs',coalesce((select jsonb_agg(q) from public.whatsapp_payment_assets q where active and branch_id=c.branch_id),'[]'),
 'order',(select to_jsonb(o) from public.orders o where (o.whatsapp_conversation_id=c.id or (c.customer_phone is not null and regexp_replace(o.customer_phone,'[^0-9]','','g') in (c.customer_phone,regexp_replace(c.customer_phone,'^57','','')))) and (not exists(select 1 from public.whatsapp_messages m where m.id=(select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1) and m.body ~* 'IMP[- ]?[0-9]+') or upper(o.order_number)=upper(replace((select substring(body from '(?i)(IMP[- ]?[0-9]+)') from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1),' ','-'))) order by o.created_at desc limit 1),
 'resource_version',(select resource_version from public.whatsapp_config where id))
 from public.whatsapp_conversations c where id=p_conversation;
$$;

create or replace function importados_private.whatsapp_money(p_value bigint) returns text
language sql immutable set search_path='' as $$select '$'||replace(to_char(p_value,'FM999,999,999,999,990'),',','.')$$;
create or replace function importados_private.whatsapp_checkout_prompt(s jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare missing text[]:='{}';begin
 if coalesce(s->>'fulfillment_type','')='' then return '¿Lo prefieres a domicilio o lo recoges en la sede?';end if;
 if coalesce(s->>'customer_name','')='' then missing:=array_append(missing,case when s->>'fulfillment_type'='delivery' and coalesce(s->>'recipient_name','')='' then '• Nombre para la compra y de quien recibe (si es la misma persona, basta un nombre)' else '• Nombre para la compra' end);end if;
 if s->>'fulfillment_type'='delivery' and coalesce(s->>'recipient_name','')='' and coalesce(s->>'customer_name','')<>'' then missing:=array_append(missing,'• Nombre de quien recibe (si eres tú, escribe «recibo yo»)');end if;
 if coalesce(s->>'recipient_phone','')='' then missing:=array_append(missing,'• Teléfono de contacto');end if;
 if s->>'fulfillment_type'='delivery' then
  if coalesce(s->>'delivery_address','')='' then missing:=array_append(missing,'• Dirección completa, con apartamento o indicaciones si aplica');end if;
  if coalesce(s->>'delivery_zone','')='' then missing:=array_append(missing,'• Barrio o sector y municipio');end if;
 end if;
 if cardinality(missing)=0 then return '';end if;
 return 'Para continuar, envíame estos datos en un solo mensaje. Si prefieres, puedes enviarlos por partes:'||E'\n'||array_to_string(missing,E'\n');
end;$$;
create or replace function importados_private.whatsapp_commerce_task(p_checkout public.whatsapp_checkouts,p_message uuid,p_type text,p_question text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid;key text;begin
 key:='commerce:'||p_checkout.id::text||':'||p_type||':'||md5(p_payload::text);
 select id into t from public.whatsapp_tasks where conversation_id=p_checkout.conversation_id and dedupe_key=key and status='pending';
 if t is null then
 insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key,priority,review_type,review_payload)
 values(p_checkout.conversation_id,p_checkout.branch_id,case when p_type='payment' then 'payment_review' else 'stock_check' end,p_question,p_message,key,'high',case when p_payload->>'missing_qr'='true' then null else p_type end,p_payload||jsonb_build_object('checkout_id',p_checkout.id,'purchase_id',p_checkout.state->>'purchase_id')) returning id into t;
 end if;return t;
end;$$;

-- The model proposes; this transaction owns prices, stock, quote acceptance and orders.
create or replace function public.whatsapp_commerce_turn(p_conversation uuid,p_message uuid,p_control integer,p_context integer,p_resource bigint,p_request uuid,p_decision jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;cfg public.whatsapp_config;ch public.whatsapp_checkouts;s jsonb;old_s jsonb;prior public.whatsapp_commerce_actions;
 i jsonb;prod public.products;inv public.branch_inventory;task public.whatsapp_tasks;items jsonb:='[]';patch jsonb;v text;k text;qty integer;subtotal bigint:=0;
 body text;out_id uuid;task_id uuid;summary_text text;accepted boolean;need text;held integer;until_at timestamptz;changed boolean:=false;asset public.whatsapp_payment_assets;
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
 if s?'review_declined' then body:=s->>'review_answer';
 elsif jsonb_array_length(coalesce(s->'items','[]'))=0 then body:='¿Qué producto te gustaría comprar?';
 elsif cfg.service_hours_enabled and s->>'fulfillment_type'='delivery' and (now() at time zone 'America/Bogota')::time>=time '19:00' then
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
   elsif s->>'payment_method'='transfer' and not exists(select 1 from public.whatsapp_messages where id=p_message and attachment->>'persisted'='true' and kind in ('image','document')) then
    select * into asset from public.whatsapp_payment_assets where branch_id=c.branch_id and active;
    if asset.id is null then
     body:='Dame un momento y te confirmo los datos para pagar en esta sede.';
     task_id:=importados_private.whatsapp_commerce_task(ch,p_message,'payment','Cargar el QR vigente de esta sede o indicar un medio de pago verificado; aún no hay comprobante.',jsonb_build_object('quote_id',s->>'quote_id','missing_qr',true));
    else body:='Te comparto el QR de esta sede. El total es '||importados_private.whatsapp_money((s->>'subtotal_cop')::bigint+coalesce((s->>'delivery_fee_cop')::bigint,0))||'. Cuando pagues, envía el comprobante por aquí. El equipo lo revisará antes de confirmar el pedido.';
    end if;
   else
    task_id:=importados_private.whatsapp_commerce_task(ch,p_message,'payment','Validar el pago o autorizar el pago en sede de esta compra. No se confirma el pedido sin aprobación.',jsonb_build_object('quote_id',s->>'quote_id','method',s->>'payment_method','total_cop',(s->>'subtotal_cop')::bigint+coalesce((s->>'delivery_fee_cop')::bigint,0),'receipt_id',case when exists(select 1 from public.whatsapp_messages where id=p_message and attachment->>'persisted'='true' and kind in ('image','document')) then p_message else null end));
    s:=s||jsonb_build_object('stage','payment_review','payment_receipt_id',case when exists(select 1 from public.whatsapp_messages where id=p_message and attachment->>'persisted'='true' and kind in ('image','document')) then p_message else null end);body:=case when s->>'payment_method'='cash_prepaid' then 'Dame un momento y confirmo la recogida con pago en sede.' else 'El equipo debe validar el pago antes de confirmar tu pedido. Te respondo por aquí cuando tengamos la confirmación.' end;
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

revoke all on function public.whatsapp_turn_snapshot(uuid),public.whatsapp_commerce_turn(uuid,uuid,integer,integer,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_turn_snapshot(uuid),public.whatsapp_commerce_turn(uuid,uuid,integer,integer,bigint,uuid,jsonb) to service_role;
revoke all on function importados_private.whatsapp_resource_changed(),importados_private.whatsapp_attention_open(),importados_private.whatsapp_day_close(),importados_private.whatsapp_money(bigint),importados_private.whatsapp_checkout_prompt(jsonb),importados_private.whatsapp_commerce_task(public.whatsapp_checkouts,uuid,text,text,jsonb) from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('whatsapp-payment-qr','whatsapp-payment-qr',false,5242880,array['image/jpeg','image/png']) on conflict(id) do nothing;
commit;
