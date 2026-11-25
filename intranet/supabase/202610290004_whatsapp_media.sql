begin;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_kind_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_kind_check check(kind in ('text','image','document'));
alter table public.whatsapp_operator_media drop constraint if exists whatsapp_operator_media_mime_type_check;
alter table public.whatsapp_operator_media drop constraint if exists whatsapp_operator_media_size_bytes_check;
alter table public.whatsapp_operator_media add constraint whatsapp_operator_media_mime_type_check check(mime_type in ('image/jpeg','image/png','application/pdf'));
alter table public.whatsapp_operator_media add constraint whatsapp_operator_media_size_bytes_check check(size_bytes between 1 and case when mime_type='application/pdf' then 10485760 else 5242880 end);
update storage.buckets set file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','application/pdf'] where id='whatsapp-operator-media';

create or replace function public.whatsapp_queue_product_image(p_conversation uuid,p_message uuid,p_control integer,p_context integer,p_resource bigint,p_product uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;p public.products;oid uuid;begin
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 select * into p from public.products where id=p_product and active;
 if c.id is null or c.branch_id is null or p.id is null or p.storage_path is null or c.manual_paused or c.status<>'open' or c.consent_status<>'granted' or c.control_version<>p_control or c.context_version<>p_context or c.last_customer_at<=now()-interval '24 hours'
 or not exists(select 1 from public.whatsapp_config where id and outbound_enabled and ai_enabled and resource_version=p_resource and privacy_version=c.consent_version)
 or p_message is distinct from (select id from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1) then raise exception 'Imagen fuera del contexto vigente';end if;
 insert into public.whatsapp_outbox(conversation_id,request_id,kind,body,source,purpose,bot_media,expected_control_version,expected_context_version)
 values(c.id,md5('product-photo:'||p_message::text||':'||p.id::text)::uuid,'image',p.name,'assistant','product_image',jsonb_build_object('type','product','product_id',p.id,'storage_path',p.storage_path,'bucket','product-images','resource_version',p_resource,'mime_type',case when p.storage_path like '%.png' then 'image/png' when p.storage_path like '%.webp' then 'image/webp' else 'image/jpeg' end),c.control_version,c.context_version)
 on conflict(request_id) do nothing returning id into oid;return oid;
end;$$;
revoke all on function public.whatsapp_queue_product_image(uuid,uuid,integer,integer,bigint,uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_queue_product_image(uuid,uuid,integer,integer,bigint,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.whatsapp_finish_outbox(p_id uuid, p_lease uuid, p_status text, p_meta_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.whatsapp_outbox;m uuid;strongest text;
begin
 if p_status not in ('sent','failed','uncertain') or (p_status='sent' and nullif(p_meta_id,'') is null) then raise exception 'Resultado inválido';end if;
 select * into o from public.whatsapp_outbox where id=p_id and lease_token=p_lease and status in ('sending','uncertain') for update;
 if o.id is null then return false;end if;
 if p_status='sent' then
  select event->>'status' into strongest from public.whatsapp_inbox where kind='status' and event->>'meta_message_id'=p_meta_id
  order by case event->>'status' when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end desc limit 1;
  insert into public.whatsapp_messages(conversation_id,meta_message_id,direction,source,kind,body,status,attachment)
   values(o.conversation_id,p_meta_id,'outbound',o.source,o.kind,o.body,coalesce(strongest,'sent'),case when o.bot_media is not null then jsonb_build_object('bot_image',true,'kind','image') when o.kind in ('image','document') then jsonb_build_object('asset_id',o.media_asset_id,'kind',o.kind) else null end) returning id into m;
  update public.whatsapp_conversations set last_message_at=now(),last_message_preview=left(o.body,180),updated_at=now(),
   privacy_notice_delivered_at=case when o.purpose='privacy_notice' and strongest in ('delivered','read') then now() else privacy_notice_delivered_at end
   where id=o.conversation_id;
 end if;
 update public.whatsapp_outbox set status=coalesce(strongest,p_status),meta_message_id=p_meta_id,message_id=m,last_error=left(p_error,100),updated_at=now() where id=o.id;
 return true;
end;$function$;

commit;
