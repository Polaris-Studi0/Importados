-- Importados only: project opeytkcqblgjfyvfjkwe. No El Rey data or configuration.
-- Apply after recruitment/202610120001_recruitment.sql. No operational sample data.
begin;

create schema if not exists importados_private;
revoke all on schema importados_private from public, anon, authenticated;

create table if not exists public.branches (
  id text primary key check (id in ('santa-lucia','niquia')),
  name text not null unique,
  address text not null,
  hours text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.branches(id,name,address,hours) values
 ('santa-lucia','Santa Lucía · Medellín','Cr. 87 # 47 DD 50','9:00 a. m. a 8:00 p. m.'),
 ('niquia','Niquía · Bello','Dg. 55 AV 33',null)
on conflict(id) do nothing;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null check (char_length(trim(full_name)) between 2 and 120),
 email text unique check (char_length(email)<=254),
 role text not null check (role in ('admin','cashier')),
 branch_id text references public.branches(id),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (role='admin' or branch_id is not null)
);
alter table public.profiles add column if not exists email text unique check (char_length(email)<=254);
-- Intentionally no auth.users signup trigger: signup never grants staff access.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin');
$$;
create or replace function public.current_branch_id() returns text
language sql stable security definer set search_path='' as $$
 select branch_id from public.profiles where id=auth.uid() and active;
$$;
create or replace function public.can_access_branch(p_branch text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active
  and (role='admin' or (role='cashier' and branch_id=p_branch)));
$$;
revoke all on function public.is_admin(),public.current_branch_id(),public.can_access_branch(text) from public,anon;
grant execute on function public.is_admin(),public.current_branch_id(),public.can_access_branch(text) to authenticated;

create table if not exists public.staff_members (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check (char_length(trim(full_name)) between 2 and 120),
 branch_id text not null references public.branches(id),
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.couriers (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(trim(name)) between 2 and 120),
 plate text not null check (char_length(trim(plate)) between 2 and 20),
 phone text not null check (char_length(phone) between 5 and 30),
 provider text not null default 'Independiente' check (char_length(provider) between 1 and 120),
 active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(plate)
);
create sequence if not exists public.importados_order_number_seq start 1001;
create table if not exists public.orders (
 id uuid primary key default gen_random_uuid(),
 order_number text not null unique default ('IMP-'||nextval('public.importados_order_number_seq')::text),
 branch_id text not null references public.branches(id),
 fulfillment_type text not null default 'delivery' check (fulfillment_type in ('delivery','pickup')),
 status text not null default 'preparing' check (status in ('preparing','ready','dispatched','delivered','cancelled')),
 customer_name text not null check (char_length(trim(customer_name)) between 2 and 120),
 customer_phone text not null check (char_length(trim(customer_phone)) between 5 and 30),
 delivery_address text check (char_length(delivery_address)<=500), delivery_zone text check (char_length(delivery_zone)<=160),
 items jsonb not null,
 total bigint not null default 0 check (total>=0),
 delivery_fee bigint not null default 0 check (delivery_fee between 0 and 100000000),
 payment_method text not null check (payment_method in ('transfer','addi','sistecredito','cash_prepaid','cash')),
 payment_reference text check (char_length(payment_reference)<=200),
 source text check (char_length(source)<=120),
 customer_notes text check (char_length(customer_notes)<=4000), internal_notes text check (char_length(internal_notes)<=4000),
 courier_id uuid references public.couriers(id), courier_name text, courier_plate text, courier_phone text, courier_provider text,
 eta_minutes integer check (eta_minutes is null or eta_minutes between 1 and 1440), promised_at timestamptz,
 ready_at timestamptz,dispatched_at timestamptz,delivered_at timestamptz,cancelled_at timestamptz,
 handoff_staff_id uuid references public.staff_members(id),handoff_staff_name text,
 payment_receipt_bucket text not null default 'payment-receipts' check (payment_receipt_bucket='payment-receipts'),
 payment_receipt_path text,payment_receipt_name text,payment_receipt_mime_type text,payment_receipt_size bigint,
 payment_receipt_uploaded_at timestamptz,payment_receipt_uploaded_by uuid references auth.users(id),
 created_by uuid references auth.users(id),updated_by uuid references auth.users(id),
 version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check (fulfillment_type='pickup' or nullif(trim(delivery_address),'') is not null),
 check (fulfillment_type='delivery' or (courier_id is null and courier_name is null and delivery_fee=0)),
 check (status<>'dispatched' or (fulfillment_type='delivery' and nullif(trim(courier_name),'') is not null)),
 check (payment_receipt_size is null or payment_receipt_size between 1 and 5242880)
);
create index if not exists orders_branch_status_idx on public.orders(branch_id,status,created_at desc);
create table if not exists public.order_events (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
 action text not null,before_data jsonb,after_data jsonb,
 changed_by uuid references auth.users(id),actor_name text,actor_role text,
 staff_member_id uuid references public.staff_members(id),staff_name text,
 created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id,created_at);

-- The BEFORE trigger is an invoker: caller permissions and RPC ownership stay distinct.
-- State, version, timestamps and receipt metadata are excluded from client column grants.
create or replace function importados_private.validate_order() returns trigger
language plpgsql set search_path='' as $$
declare item jsonb; subtotal bigint:=0; qty numeric; price numeric; courier public.couriers; action text;
begin
 if jsonb_typeof(new.items)<>'array' or jsonb_array_length(new.items) not between 1 and 100 then
  raise exception 'Agrega entre 1 y 100 productos válidos';
 end if;
 for item in select value from jsonb_array_elements(new.items) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'qty') is distinct from 'number'
     or jsonb_typeof(item->'unit_price') is distinct from 'number' or jsonb_typeof(item->'name') is distinct from 'string'
     or coalesce(char_length(trim(item->>'name')),0) not between 1 and 180 then
   raise exception 'Cada producto requiere nombre, cantidad y precio';
  end if;
  qty:=(item->>'qty')::numeric; price:=(item->>'unit_price')::numeric;
  if qty<>trunc(qty) or qty not between 1 and 10000 or price<>trunc(price) or price not between 0 and 1000000000 then
   raise exception 'Cantidad y precio deben ser enteros válidos';
  end if;
  subtotal:=subtotal+(qty*price)::bigint;
 end loop;
 new.total:=subtotal;
 if new.fulfillment_type='pickup' then
  new.delivery_fee:=0; new.delivery_address:=null;new.delivery_zone:=null;
  new.courier_id:=null;new.courier_name:=null;new.courier_plate:=null;new.courier_phone:=null;new.courier_provider:=null;
  new.eta_minutes:=null;new.promised_at:=null;
 elsif new.courier_id is not null then
  select * into courier from public.couriers where id=new.courier_id;
  if courier.id is null or (not courier.active and (tg_op='INSERT' or new.courier_id is distinct from old.courier_id)) then
   raise exception 'El domiciliario seleccionado no está disponible';
  end if;
  -- Snapshot values remain stable if the courier directory changes later.
  if tg_op='INSERT' or new.courier_id is distinct from old.courier_id then
   new.courier_name:=courier.name;new.courier_plate:=courier.plate;new.courier_phone:=courier.phone;new.courier_provider:=courier.provider;
  end if;
 end if;
 if new.fulfillment_type='delivery' and new.courier_id is null and nullif(trim(new.courier_name),'') is not null
    and (nullif(trim(new.courier_plate),'') is null or nullif(trim(new.courier_provider),'') is null) then
  raise exception 'El domiciliario ocasional requiere nombre, placa y proveedor';
 end if;
 if tg_op='INSERT' then
  if new.status<>'preparing' then raise exception 'El pedido debe comenzar en preparación';end if;
  if not exists(select 1 from public.branches where id=new.branch_id and active) then raise exception 'Sede no disponible';end if;
  new.created_by:=auth.uid();new.updated_by:=auth.uid();new.version:=1;new.created_at:=now();new.updated_at:=now();
 else
  if new.id<>old.id or new.order_number<>old.order_number then raise exception 'La identidad del pedido es inmutable';end if;
  if old.status in ('delivered','cancelled') and (to_jsonb(new)-'internal_notes') is distinct from (to_jsonb(old)-'internal_notes') then
   raise exception 'El pedido ya finalizó';
  end if;
  if old.status in ('dispatched','ready') and (new.branch_id<>old.branch_id or new.fulfillment_type<>old.fulfillment_type) then
   raise exception 'No se puede cambiar la sede o modalidad después de preparar';
  end if;
  if old.status='dispatched' and (new.items<>old.items or new.delivery_fee<>old.delivery_fee
      or new.courier_id is distinct from old.courier_id or new.courier_name is distinct from old.courier_name
      or new.delivery_address is distinct from old.delivery_address) then raise exception 'El pedido ya fue despachado';end if;
  if new.status<>old.status then
   action:=current_setting('importados.order_action',true);
   if current_user in ('anon','authenticated') or action not in ('ready','dispatch','pickup','delivered','cancelled')
      or action is null then raise exception 'Cambia el estado mediante la acción autorizada';end if;
   if not ((old.status='preparing' and new.status='ready')
    or (old.status='ready' and new.status='dispatched' and new.fulfillment_type='delivery')
    or (old.status='ready' and new.status='delivered' and new.fulfillment_type='pickup')
    or (old.status='dispatched' and new.status='delivered' and new.fulfillment_type='delivery')
    or (old.status in ('preparing','ready','dispatched') and new.status='cancelled')) then raise exception 'Transición de estado inválida';end if;
  end if;
  new.created_at:=old.created_at;new.created_by:=old.created_by;
  new.version:=old.version+1;new.updated_at:=now();new.updated_by:=auth.uid();
 end if;
 return new;
end;$$;
drop trigger if exists validate_order on public.orders;
create trigger validate_order before insert or update on public.orders for each row execute function importados_private.validate_order();

create or replace function importados_private.audit_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; action text;
begin
 select * into actor from public.profiles where id=auth.uid();
 if tg_op='INSERT' then action:='created';
 elsif new.status<>old.status then action:=current_setting('importados.order_action',true);
 elsif new.payment_receipt_path is distinct from old.payment_receipt_path then action:='payment_receipt_uploaded';
 elsif new.courier_id is distinct from old.courier_id or new.courier_name is distinct from old.courier_name then action:='courier_assigned';
 else action:='updated';end if;
 insert into public.order_events(order_id,action,before_data,after_data,changed_by,actor_name,actor_role,staff_member_id,staff_name)
 values(new.id,action,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),auth.uid(),coalesce(actor.full_name,'Servicio'),coalesce(actor.role,'service'),new.handoff_staff_id,new.handoff_staff_name);
 return new;
end;$$;
drop trigger if exists audit_order on public.orders;
create trigger audit_order after insert or update on public.orders for each row execute function importados_private.audit_order();

create or replace function public.transition_order(p_order_id uuid,p_action text,p_staff_id uuid default null)
returns public.orders language plpgsql security definer set search_path='' as $$
declare target public.orders;actor public.profiles;member public.staff_members;next_status text;action text;
begin
 select * into actor from public.profiles where id=auth.uid() and active;
 if actor.id is null then raise exception 'Usuario sin acceso activo';end if;
 select * into target from public.orders where id=p_order_id for update;
 if target.id is null or not public.can_access_branch(target.branch_id) then raise exception 'Pedido no disponible para tu usuario';end if;
 action:=case when p_action='cancel' then 'cancelled' else p_action end;
 if action='ready' and target.status='preparing' then next_status:='ready';
 elsif action='dispatch' and target.status='ready' and target.fulfillment_type='delivery' then
  if nullif(trim(target.courier_name),'') is null then raise exception 'Asigna un domiciliario primero';end if;
  next_status:='dispatched';
 elsif action='pickup' and target.status='ready' and target.fulfillment_type='pickup' then next_status:='delivered';
 elsif action='delivered' and actor.role='admin' and target.status='dispatched' and target.fulfillment_type='delivery' then next_status:='delivered';
 elsif action='cancelled' and actor.role='admin' and target.status in ('preparing','ready','dispatched') then next_status:='cancelled';
 else raise exception 'Acción no permitida en el estado actual';end if;
 if action in ('dispatch','pickup') then
  select * into member from public.staff_members where id=p_staff_id and active and branch_id=target.branch_id;
  if member.id is null then raise exception 'Selecciona una persona activa de esta sede';end if;
 end if;
 perform set_config('importados.order_action',action,true);
 update public.orders set status=next_status,
  ready_at=case when action='ready' then now() else ready_at end,
  dispatched_at=case when action='dispatch' then now() else dispatched_at end,
  delivered_at=case when action in ('pickup','delivered') then now() else delivered_at end,
  cancelled_at=case when action='cancelled' then now() else cancelled_at end,
  handoff_staff_id=case when member.id is not null then member.id else handoff_staff_id end,
  handoff_staff_name=case when member.id is not null then member.full_name else handoff_staff_name end
 where id=target.id returning * into target;
 perform set_config('importados.order_action','',true);
 return target;
end;$$;

create or replace function public.attach_payment_receipt(p_order_id uuid,p_path text,p_name text,p_mime_type text,p_size bigint)
returns public.orders language plpgsql security definer set search_path='' as $$
declare target public.orders;file_metadata jsonb;file_owner text;
begin
 select * into target from public.orders where id=p_order_id for update;
 if target.id is null or not public.can_access_branch(target.branch_id) then raise exception 'Pedido no disponible para tu usuario';end if;
 if target.status in ('delivered','cancelled') then raise exception 'El pedido ya finalizó';end if;
 if p_size not between 1 and 5242880 or p_size is null
    or p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf')
    or coalesce(char_length(trim(p_name)),0) not between 1 and 255 then raise exception 'Comprobante inválido o mayor de 5 MB';end if;
 if p_path !~ ('^'||target.branch_id||'/'||target.id::text||'/[0-9a-fA-F-]{36}\.(pdf|jpe?g|png|webp)$') then raise exception 'Ruta de comprobante inválida';end if;
 select metadata,owner_id into file_metadata,file_owner from storage.objects where bucket_id='payment-receipts' and name=p_path;
 if file_metadata is null or file_owner is distinct from auth.uid()::text
    or coalesce(file_metadata->>'mimetype','')<>p_mime_type
    or coalesce(file_metadata->>'size','')<>p_size::text then raise exception 'Sube primero un archivo propio con metadatos válidos';end if;
 update public.orders set payment_receipt_path=p_path,payment_receipt_name=trim(p_name),payment_receipt_mime_type=p_mime_type,
  payment_receipt_size=p_size,payment_receipt_uploaded_at=now(),payment_receipt_uploaded_by=auth.uid()
 where id=p_order_id returning * into target;
 return target;
end;$$;
revoke all on function public.transition_order(uuid,text,uuid),public.attach_payment_receipt(uuid,text,text,text,bigint) from public,anon;
grant execute on function public.transition_order(uuid,text,uuid),public.attach_payment_receipt(uuid,text,text,text,bigint) to authenticated;

create table if not exists public.products (
 id uuid primary key default gen_random_uuid(),sku text unique check (char_length(sku)<=80),
 name text not null check (char_length(trim(name)) between 2 and 180),category text not null default 'General' check (char_length(category) between 1 and 120),
 description text not null default '' check (char_length(description)<=6000),
 price bigint not null check (price between 0 and 1000000000),active boolean not null default true,storage_path text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.branch_inventory (
 branch_id text not null references public.branches(id),product_id uuid not null references public.products(id),
 quantity integer not null default 0 check (quantity between 0 and 100000000),
 updated_at timestamptz not null default now(),primary key(branch_id,product_id)
);
create table if not exists public.inventory_events (
 id uuid primary key default gen_random_uuid(),branch_id text not null references public.branches(id),product_id uuid not null references public.products(id),
 before_quantity integer not null,after_quantity integer not null,actor_id uuid references auth.users(id),actor_name text,
 created_at timestamptz not null default now()
);
create or replace function public.set_branch_inventory(p_branch_id text,p_product_id uuid,p_quantity integer)
returns public.branch_inventory language plpgsql security definer set search_path='' as $$
declare result public.branch_inventory;previous integer;actor text;
begin
 if not public.is_admin() then raise exception 'Solo administración puede registrar inventario';end if;
 if p_quantity is null or p_quantity not between 0 and 100000000 then raise exception 'Cantidad inválida';end if;
 if not exists(select 1 from public.products where id=p_product_id and active)
    or not exists(select 1 from public.branches where id=p_branch_id and active) then raise exception 'Producto o sede no disponible';end if;
 -- Serializes initial inserts as well as subsequent counts for this pair.
 perform pg_advisory_xact_lock(hashtextextended(p_branch_id||':'||p_product_id::text,0));
 select quantity into previous from public.branch_inventory where branch_id=p_branch_id and product_id=p_product_id for update;
 insert into public.branch_inventory(branch_id,product_id,quantity) values(p_branch_id,p_product_id,p_quantity)
 on conflict(branch_id,product_id) do update set quantity=excluded.quantity,updated_at=now() returning * into result;
 select full_name into actor from public.profiles where id=auth.uid();
 if previous is distinct from p_quantity then insert into public.inventory_events(branch_id,product_id,before_quantity,after_quantity,actor_id,actor_name)
  values(p_branch_id,p_product_id,coalesce(previous,0),p_quantity,auth.uid(),actor);end if;
 return result;
end;$$;
revoke all on function public.set_branch_inventory(text,uuid,integer) from public,anon;
grant execute on function public.set_branch_inventory(text,uuid,integer) to authenticated;
create table if not exists public.branch_knowledge (
 id uuid primary key default gen_random_uuid(),branch_id text references public.branches(id),
 topic text not null check (char_length(trim(topic)) between 2 and 180),content text not null check (char_length(content) between 1 and 20000),
 active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table if not exists public.vacancies (
 id uuid primary key default gen_random_uuid(),title text not null check (char_length(trim(title)) between 3 and 160),
 branch_id text references public.branches(id),description text not null check (char_length(description) between 10 and 12000),
 requirements text not null default '' check (char_length(requirements)<=8000),
 status text not null default 'draft' check (status in ('draft','published','closed')),
 created_by uuid references auth.users(id),updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.vacancy_events (
 id uuid primary key default gen_random_uuid(),vacancy_id uuid not null references public.vacancies(id),
 actor_id uuid references auth.users(id),actor_name text,before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
alter table public.job_applications add column if not exists review_status text not null default 'new' check (review_status in ('new','reviewing','contacted','archived'));
alter table public.job_applications add column if not exists internal_notes text not null default '' check (char_length(internal_notes)<=12000);
alter table public.job_applications add column if not exists vacancy_id uuid references public.vacancies(id);
alter table public.job_applications add column if not exists updated_at timestamptz not null default now();
create table if not exists public.application_events (
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.job_applications(id),
 actor_id uuid references auth.users(id),actor_name text,status_before text,status_after text,internal_notes text,
 created_at timestamptz not null default now()
);
create or replace function public.review_application(p_id uuid,p_status text,p_notes text)
returns public.job_applications language plpgsql security definer set search_path='' as $$
declare target public.job_applications;before_status text;actor text;
begin
 if not public.is_admin() then raise exception 'Solo administración puede revisar postulaciones';end if;
 if p_status not in ('new','reviewing','contacted','archived') or p_status is null or coalesce(char_length(p_notes),0)>12000 then raise exception 'Revisión inválida';end if;
 select * into target from public.job_applications where id=p_id and status='received' for update;
 if target.id is null then raise exception 'Postulación no recibida';end if;
 before_status:=target.review_status;
 update public.job_applications set review_status=p_status,internal_notes=coalesce(p_notes,''),updated_at=now() where id=p_id returning * into target;
 select full_name into actor from public.profiles where id=auth.uid();
 insert into public.application_events(application_id,actor_id,actor_name,status_before,status_after,internal_notes)
 values(p_id,auth.uid(),actor,before_status,p_status,coalesce(p_notes,''));
 return target;
end;$$;
revoke all on function public.review_application(uuid,text,text) from public,anon;
grant execute on function public.review_application(uuid,text,text) to authenticated;

create table if not exists public.pqrs_cases (
 id uuid primary key default gen_random_uuid(),case_number text not null unique,
 type text not null check (type in ('peticion','queja','reclamo','sugerencia','felicitacion')),
 branch_id text references public.branches(id),
 customer_name text not null check (char_length(trim(customer_name)) between 2 and 120),
 customer_email text not null check (char_length(customer_email) between 3 and 254),customer_phone text check (char_length(customer_phone)<=30),
 subject text not null check (char_length(trim(subject)) between 3 and 180),description text not null check (char_length(trim(description)) between 10 and 12000),
 status text not null default 'received' check (status in ('received','in_review','awaiting_information','completed','closed')),
 internal_notes text not null default '' check (char_length(internal_notes)<=12000),response_message text not null default '' check (char_length(response_message)<=12000),
 lookup_hash text not null,request_id uuid not null unique,payload_hash text not null,
 consent_version text not null default 'pqrs-2026-10-12',consent_at timestamptz not null default now(),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.pqrs_case_events (
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.pqrs_cases(id),
 actor_id uuid references auth.users(id),actor_name text not null default 'Importados',message text not null,
 status_before text,status_after text,response_message text,created_at timestamptz not null default now()
);
create index if not exists pqrs_cases_status_created_idx on public.pqrs_cases(status,created_at desc);
create index if not exists pqrs_case_events_case_idx on public.pqrs_case_events(case_id,created_at);
create or replace function importados_private.receive_pqrs() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'received' or new.internal_notes<>'' or new.response_message<>'' then raise exception 'La PQRS debe comenzar como recibida';end if;
 insert into public.pqrs_case_events(case_id,actor_name,message,status_after)
 values(new.id,'Importados','Solicitud recibida','received');
 return new;
end;$$;
drop trigger if exists receive_pqrs on public.pqrs_cases;
create trigger receive_pqrs after insert on public.pqrs_cases for each row execute function importados_private.receive_pqrs();
create or replace function public.update_pqrs_case(p_id uuid,p_status text,p_notes text,p_response text default '')
returns public.pqrs_cases language plpgsql security definer set search_path='' as $$
declare target public.pqrs_cases;before_status text;actor text;
begin
 if not public.is_admin() then raise exception 'Solo administración puede gestionar PQRS';end if;
 if p_status not in ('received','in_review','awaiting_information','completed','closed') or p_status is null
    or coalesce(char_length(p_notes),0)>12000 or coalesce(char_length(p_response),0)>12000 then raise exception 'Actualización de PQRS inválida';end if;
 select * into target from public.pqrs_cases where id=p_id for update;
 if target.id is null then raise exception 'PQRS no disponible';end if;
 before_status:=target.status;
 update public.pqrs_cases set status=p_status,internal_notes=coalesce(p_notes,''),
  response_message=case when nullif(trim(p_response),'') is not null then trim(p_response) else response_message end,
  updated_at=now() where id=p_id returning * into target;
 select full_name into actor from public.profiles where id=auth.uid();
 insert into public.pqrs_case_events(case_id,actor_id,actor_name,message,status_before,status_after,response_message)
 values(p_id,auth.uid(),actor,case when nullif(trim(p_response),'') is not null then 'Respuesta registrada' else 'Gestión actualizada' end,
  before_status,p_status,nullif(trim(p_response),''));
 return target;
end;$$;
revoke all on function public.update_pqrs_case(uuid,text,text,text) from public,anon;
grant execute on function public.update_pqrs_case(uuid,text,text,text) to authenticated;

create table if not exists public.internal_chat_messages (
 id bigint generated always as identity primary key,branch_id text not null references public.branches(id),
 sender_id uuid not null references auth.users(id),sender_name text not null,sender_role text not null check (sender_role in ('admin','cashier')),
 body text not null check (char_length(trim(body)) between 1 and 4000),request_id uuid not null,
 created_at timestamptz not null default now(),unique(sender_id,request_id)
);
create index if not exists internal_chat_branch_id_idx on public.internal_chat_messages(branch_id,id desc);
create table if not exists public.internal_chat_reads (
 user_id uuid not null references auth.users(id) on delete cascade,branch_id text not null references public.branches(id),
 through_id bigint not null default 0 check (through_id>=0),updated_at timestamptz not null default now(),primary key(user_id,branch_id)
);
create or replace function public.send_internal_chat(p_branch text,p_body text,p_request uuid)
returns public.internal_chat_messages language plpgsql security definer set search_path='' as $$
declare actor public.profiles;target public.internal_chat_messages;
begin
 if not public.can_access_branch(p_branch) or not exists(select 1 from public.branches where id=p_branch and active) then raise exception 'Conversación no disponible';end if;
 if p_request is null or coalesce(char_length(trim(p_body)),0) not between 1 and 4000 then raise exception 'Mensaje inválido';end if;
 select * into actor from public.profiles where id=auth.uid() and active;
 insert into public.internal_chat_messages(branch_id,sender_id,sender_name,sender_role,body,request_id)
 values(p_branch,actor.id,actor.full_name,actor.role,trim(p_body),p_request)
 on conflict(sender_id,request_id) do nothing returning * into target;
 if target.id is null then
  select * into target from public.internal_chat_messages where sender_id=actor.id and request_id=p_request;
  if target.branch_id<>p_branch or target.body<>trim(p_body) then raise exception 'El identificador ya pertenece a otro mensaje';end if;
 end if;
 return target;
end;$$;
create or replace function public.mark_internal_chat_read(p_branch text,p_through bigint)
returns void language plpgsql security definer set search_path='' as $$
declare latest bigint;
begin
 if not public.can_access_branch(p_branch) then raise exception 'Conversación no disponible';end if;
 select coalesce(max(id),0) into latest from public.internal_chat_messages where branch_id=p_branch;
 if p_through is null or p_through<0 or p_through>latest then raise exception 'Marcador inválido';end if;
 insert into public.internal_chat_reads(user_id,branch_id,through_id) values(auth.uid(),p_branch,p_through)
 on conflict(user_id,branch_id) do update set through_id=greatest(public.internal_chat_reads.through_id,excluded.through_id),updated_at=now();
end;$$;
create or replace function public.internal_chat_overview()
returns table(branch_id text,name text,unread bigint,last_message jsonb)
language sql stable security definer set search_path='' as $$
 select b.id,b.name,
  (select count(*) from public.internal_chat_messages m where m.branch_id=b.id and m.sender_id<>auth.uid() and m.id>coalesce(r.through_id,0)),
  (select to_jsonb(m) from public.internal_chat_messages m where m.branch_id=b.id order by m.id desc limit 1)
 from public.branches b left join public.internal_chat_reads r on r.branch_id=b.id and r.user_id=auth.uid()
 where b.active and public.can_access_branch(b.id) order by b.id;
$$;
revoke all on function public.send_internal_chat(text,text,uuid),public.mark_internal_chat_read(text,bigint),public.internal_chat_overview() from public,anon;
grant execute on function public.send_internal_chat(text,text,uuid),public.mark_internal_chat_read(text,bigint),public.internal_chat_overview() to authenticated;

create or replace function importados_private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now();if tg_op='UPDATE' then new.created_at:=old.created_at;end if;return new;end;$$;
create or replace function importados_private.audit_vacancy() returns trigger language plpgsql security definer set search_path='' as $$
declare actor text;
begin
 select full_name into actor from public.profiles where id=auth.uid();
 insert into public.vacancy_events(vacancy_id,actor_id,actor_name,before_data,after_data)
 values(new.id,auth.uid(),coalesce(actor,'Servicio'),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end;$$;
create or replace function importados_private.vacancy_actor() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_by:=auth.uid();if tg_op='INSERT' then new.created_by:=auth.uid();else new.created_by:=old.created_by;end if;return new;
end;$$;
create or replace function importados_private.immutable_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'El historial es inmutable';end;$$;
do $$declare t text;begin
 foreach t in array array['profiles','staff_members','couriers','products','branch_knowledge','vacancies'] loop
  execute format('drop trigger if exists touch_updated_at on public.%I',t);
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function importados_private.touch_updated_at()',t);
 end loop;
 foreach t in array array['order_events','inventory_events','vacancy_events','application_events','pqrs_case_events','internal_chat_messages'] loop
  execute format('drop trigger if exists immutable_event on public.%I',t);
  execute format('create trigger immutable_event before update or delete on public.%I for each row execute function importados_private.immutable_event()',t);
 end loop;
end;$$;
drop trigger if exists audit_vacancy on public.vacancies;
create trigger audit_vacancy after insert or update on public.vacancies for each row execute function importados_private.audit_vacancy();
drop trigger if exists vacancy_actor on public.vacancies;
create trigger vacancy_actor before insert or update on public.vacancies for each row execute function importados_private.vacancy_actor();

-- Explicit privileges: Supabase's default grants cannot accidentally expose new tables.
do $$declare t text;begin
 foreach t in array array['branches','profiles','staff_members','couriers','orders','order_events','products','branch_inventory','inventory_events','branch_knowledge','vacancies','vacancy_events','job_applications','application_events','pqrs_cases','pqrs_case_events','internal_chat_messages','internal_chat_reads'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end;$$;
grant select on public.branches to anon,authenticated;
grant select on public.profiles,public.staff_members,public.couriers,public.orders,public.order_events,public.products,public.branch_inventory,public.inventory_events,public.branch_knowledge,public.vacancies,public.vacancy_events,public.job_applications,public.application_events,public.pqrs_cases,public.pqrs_case_events,public.internal_chat_messages,public.internal_chat_reads to authenticated;
grant select(id,title,branch_id,description,requirements,status,created_at,updated_at) on public.vacancies to anon;
grant insert(full_name,branch_id,active),update(full_name,branch_id,active) on public.staff_members to authenticated;
grant insert(name,plate,phone,provider,active),update(name,plate,phone,provider,active) on public.couriers to authenticated;
grant insert(sku,name,category,description,price,active,storage_path),update(sku,name,category,description,price,active,storage_path) on public.products to authenticated;
grant insert(branch_id,topic,content,active),update(branch_id,topic,content,active) on public.branch_knowledge to authenticated;
grant insert(title,branch_id,description,requirements,status),update(title,branch_id,description,requirements,status) on public.vacancies to authenticated;
grant insert(branch_id,fulfillment_type,customer_name,customer_phone,delivery_address,delivery_zone,items,total,delivery_fee,payment_method,payment_reference,source,customer_notes,internal_notes,courier_id,courier_name,courier_plate,courier_phone,courier_provider,eta_minutes,promised_at),
 update(branch_id,fulfillment_type,customer_name,customer_phone,delivery_address,delivery_zone,items,total,delivery_fee,payment_method,payment_reference,source,customer_notes,internal_notes,courier_id,courier_name,courier_plate,courier_phone,courier_provider,eta_minutes,promised_at)
 on public.orders to authenticated;
grant usage on sequence public.importados_order_number_seq to authenticated,service_role;
grant usage,select on sequence public.internal_chat_messages_id_seq to service_role;

drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches for select to anon,authenticated using(active);
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
drop policy if exists staff_read on public.staff_members;
create policy staff_read on public.staff_members for select to authenticated using(public.can_access_branch(branch_id));
drop policy if exists staff_admin_write on public.staff_members;
create policy staff_admin_write on public.staff_members for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists couriers_read on public.couriers;
create policy couriers_read on public.couriers for select to authenticated using(public.is_admin() or exists(select 1 from public.orders o where o.courier_id=couriers.id and public.can_access_branch(o.branch_id)));
drop policy if exists couriers_admin_write on public.couriers;
create policy couriers_admin_write on public.couriers for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using(public.can_access_branch(branch_id));
drop policy if exists orders_admin_insert on public.orders;
create policy orders_admin_insert on public.orders for insert to authenticated with check(public.is_admin());
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders for update to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists order_events_read on public.order_events;
create policy order_events_read on public.order_events for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and public.can_access_branch(o.branch_id)));
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using(public.is_admin() or (active and exists(select 1 from public.branch_inventory i where i.product_id=products.id and i.branch_id=public.current_branch_id())));
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists inventory_read on public.branch_inventory;
create policy inventory_read on public.branch_inventory for select to authenticated using(public.can_access_branch(branch_id));
drop policy if exists inventory_events_read on public.inventory_events;
create policy inventory_events_read on public.inventory_events for select to authenticated using(public.is_admin());
drop policy if exists knowledge_read on public.branch_knowledge;
create policy knowledge_read on public.branch_knowledge for select to authenticated using(public.is_admin() or (active and branch_id is null and public.current_branch_id() is not null) or (active and public.can_access_branch(branch_id)));
drop policy if exists knowledge_admin_write on public.branch_knowledge;
create policy knowledge_admin_write on public.branch_knowledge for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists vacancies_public_read on public.vacancies;
create policy vacancies_public_read on public.vacancies for select to anon using(status='published');
drop policy if exists vacancies_admin_read on public.vacancies;
create policy vacancies_admin_read on public.vacancies for select to authenticated using(public.is_admin());
drop policy if exists vacancies_admin_write on public.vacancies;
create policy vacancies_admin_write on public.vacancies for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists vacancies_events_read on public.vacancy_events;
create policy vacancies_events_read on public.vacancy_events for select to authenticated using(public.is_admin());
drop policy if exists applications_admin_read on public.job_applications;
create policy applications_admin_read on public.job_applications for select to authenticated using(public.is_admin() and status='received');
drop policy if exists application_events_admin_read on public.application_events;
create policy application_events_admin_read on public.application_events for select to authenticated using(public.is_admin());
drop policy if exists pqrs_admin_read on public.pqrs_cases;
create policy pqrs_admin_read on public.pqrs_cases for select to authenticated using(public.is_admin());
drop policy if exists pqrs_events_admin_read on public.pqrs_case_events;
create policy pqrs_events_admin_read on public.pqrs_case_events for select to authenticated using(public.is_admin());
drop policy if exists chat_read on public.internal_chat_messages;
create policy chat_read on public.internal_chat_messages for select to authenticated using(public.can_access_branch(branch_id));
drop policy if exists chat_reads_own on public.internal_chat_reads;
create policy chat_reads_own on public.internal_chat_reads for select to authenticated using(user_id=auth.uid() and public.can_access_branch(branch_id));

-- Private files. Read access is attached to a real permitted row, never only a prefix.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('payment-receipts','payment-receipts',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']),
 ('product-images','product-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
update storage.buckets set public=false where id='hojas-de-vida';
drop policy if exists importados_resume_admin_read on storage.objects;
create policy importados_resume_admin_read on storage.objects for select to authenticated using(
 bucket_id='hojas-de-vida' and public.is_admin() and exists(select 1 from public.job_applications a where a.object_path=storage.objects.name and a.status='received')
);
drop policy if exists importados_receipts_read on storage.objects;
create policy importados_receipts_read on storage.objects for select to authenticated using(
 bucket_id='payment-receipts' and exists(select 1 from public.orders o where o.payment_receipt_path=storage.objects.name and public.can_access_branch(o.branch_id))
);
drop policy if exists importados_receipts_insert on storage.objects;
create policy importados_receipts_insert on storage.objects for insert to authenticated with check(
 bucket_id='payment-receipts' and owner_id=auth.uid()::text and exists(select 1 from public.orders o
  where storage.objects.name ~ ('^'||o.branch_id||'/'||o.id::text||'/[0-9a-fA-F-]{36}\.(pdf|jpe?g|png|webp)$')
   and o.status not in ('delivered','cancelled') and public.can_access_branch(o.branch_id))
);
drop policy if exists importados_product_images_read on storage.objects;
create policy importados_product_images_read on storage.objects for select to authenticated using(
 bucket_id='product-images' and public.is_admin()
);
drop policy if exists importados_product_images_insert on storage.objects;
create policy importados_product_images_insert on storage.objects for insert to authenticated with check(
 bucket_id='product-images' and public.is_admin() and owner_id=auth.uid()::text
 and name ~ '^([0-9a-fA-F-]{36}/)?[0-9a-fA-F-]{36}\.(jpe?g|png|webp)$'
);
-- No file upsert/delete policies: replacing a reference does not erase prior audit evidence.
revoke all on all functions in schema importados_private from public,anon,authenticated;

-- Publication contains only owned operational tables; RLS filters every subscriber.
do $$declare t text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['orders','order_events','staff_members','couriers','branch_inventory','products','vacancies','job_applications','pqrs_cases','pqrs_case_events','internal_chat_messages','internal_chat_reads'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end;$$;
comment on table public.profiles is 'Service-managed access only. Auth signup never creates an operational profile.';
comment on table public.branch_inventory is 'Manual counts via audited administrator RPC; orders do not automatically reserve or deduct stock.';
comment on table public.pqrs_cases is 'Private records; public submission and lookup are server-mediated. Recording a response does not send email.';
commit;
