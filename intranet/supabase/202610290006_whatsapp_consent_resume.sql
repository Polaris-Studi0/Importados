begin;
alter table public.whatsapp_outbox add column if not exists inbound_message_id uuid references public.whatsapp_messages(id);
create or replace function importados_private.whatsapp_notice_version()
returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.purpose='privacy_notice' then
  select privacy_version into new.privacy_version from public.whatsapp_config where id;
  if new.privacy_version is null then raise exception 'Falta versión del aviso de privacidad';end if;
  select id into new.inbound_message_id from public.whatsapp_messages where conversation_id=new.conversation_id and direction='inbound' order by created_at desc,sequence_id desc limit 1;
 else new.privacy_version:=null;end if;return new;
end;$$;
-- Meta may deliver its receipt after a customer has already answered the notice.
-- Re-evaluate only the latest explicit acceptance of the exact delivered notice.
create or replace function importados_private.whatsapp_apply_notice_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations;m public.whatsapp_messages;normalized text;begin
 if new.purpose='privacy_notice' and new.status in ('delivered','read') then
  update public.whatsapp_conversations target set privacy_notice_delivered_at=coalesce(target.privacy_notice_delivered_at,now())
   from public.whatsapp_config cfg where cfg.id and target.id=new.conversation_id and target.privacy_notice_id=new.id
   and target.consent_status<>'revoked' and target.consent_version=new.privacy_version and cfg.privacy_version=new.privacy_version returning target.* into c;
  if c.id is null or c.consent_status<>'unknown' then return new;end if;
  select * into m from public.whatsapp_messages where conversation_id=c.id and direction='inbound' order by created_at desc,sequence_id desc limit 1;
  normalized:=upper(trim(regexp_replace(translate(coalesce(m.body,''),'áéíóúÁÉÍÓÚ','aeiouAEIOU'),'[^a-zA-Z0-9]+',' ','g')));
  if m.id is not null and m.kind='text' and m.created_at>=date_trunc('second',new.created_at)
   and m.sequence_id>(select sequence_id from public.whatsapp_messages where id=new.inbound_message_id)
   and normalized in ('SI','ACEPTO','YO ACEPTO','SI ACEPTO','SI ACEPTO GRACIAS','ACEPTO GRACIAS','SI GRACIAS') then
   update public.whatsapp_conversations set consent_status='granted',consent_at=m.created_at,context_version=context_version+1 where id=c.id;
   insert into public.whatsapp_inbox(event_key,kind,event,conversation_id)
    values(md5('consent:'||new.id::text)||md5(m.id::text),'service_reopen',jsonb_build_object('message_id',m.id,'reason','consent_resume'),c.id) on conflict(event_key) do nothing;
  end if;
 end if;return new;
end;$$;
revoke all on function importados_private.whatsapp_apply_notice_receipt() from public,anon,authenticated;
commit;
