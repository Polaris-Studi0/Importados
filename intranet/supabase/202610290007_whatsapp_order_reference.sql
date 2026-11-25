-- Accept IMP-1234, IMP 1234 and IMP1234 while preserving verified ownership.
begin;
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
 'order',(select to_jsonb(o) from public.orders o where (o.whatsapp_conversation_id=c.id or (c.customer_phone is not null and regexp_replace(o.customer_phone,'[^0-9]','','g') in (c.customer_phone,regexp_replace(c.customer_phone,'^57','','')))) and (not exists(select 1 from public.whatsapp_messages m where m.id=(select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1) and m.body ~* 'IMP[- ]?[0-9]+') or regexp_replace(upper(o.order_number),'[^A-Z0-9]','','g')=regexp_replace(upper((select substring(body from '(?i)(IMP[- ]?[0-9]+)') from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1)),'[^A-Z0-9]','','g')) order by o.created_at desc limit 1),
 'resource_version',(select resource_version from public.whatsapp_config where id))
 from public.whatsapp_conversations c where id=p_conversation;
$$;
commit;
