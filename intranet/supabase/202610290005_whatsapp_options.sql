begin;
create or replace function public.whatsapp_commit_options(p_conversation uuid,p_message uuid,p_control integer,p_context integer,p_resource bigint,p_request uuid,p_body text,p_ids jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;r jsonb;pid text;begin
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>10 or not exists(select 1 from public.whatsapp_config where id and resource_version=p_resource) then raise exception 'Opciones fuera del contexto';end if;
 for pid in select jsonb_array_elements_text(p_ids) loop
  if not exists(select 1 from public.products p join public.branch_inventory i on i.product_id=p.id and i.branch_id=c.branch_id where p.id=pid::uuid and p.active and i.valid_until>now() and i.quantity>coalesce((select sum(h.quantity) from public.whatsapp_stock_holds h where h.product_id=p.id and h.branch_id=c.branch_id and h.expires_at>now() and h.checkout_id is distinct from (select id from public.whatsapp_checkouts where conversation_id=c.id)),0) and (p.offer_starts_at is null or p.offer_starts_at<=now()) and (p.offer_ends_at is null or p.offer_ends_at>now())) then raise exception 'Opciones sin existencias confirmadas';end if;
 end loop;
 r:=public.whatsapp_commit_reply(c.id,p_message,p_control,p_context,p_request,p_body,'reply',null);
 insert into public.whatsapp_checkouts(conversation_id,branch_id,session_started_at,state) values(c.id,c.branch_id,c.session_started_at,jsonb_build_object('offered_ids',p_ids,'options_outbox_id',r->>'outbox_id'))
 on conflict(conversation_id) do update set state=case when whatsapp_checkouts.branch_id=excluded.branch_id and whatsapp_checkouts.session_started_at=excluded.session_started_at then whatsapp_checkouts.state else '{}'::jsonb end||excluded.state,branch_id=excluded.branch_id,session_started_at=excluded.session_started_at,version=whatsapp_checkouts.version+1,updated_at=now();return r;
end;$$;
revoke all on function public.whatsapp_commit_options(uuid,uuid,integer,integer,bigint,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_commit_options(uuid,uuid,integer,integer,bigint,uuid,text,jsonb) to service_role;
commit;
