-- Incremental correction after 202610200001_whatsapp.sql (already applied).
-- A late receipt for an old notice must never authorize a new privacy version.
begin;
alter table public.whatsapp_outbox add column if not exists privacy_version text;
alter table public.whatsapp_conversations add column if not exists privacy_notice_id uuid references public.whatsapp_outbox(id);

create or replace function importados_private.whatsapp_notice_version()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.purpose='privacy_notice' then
  select privacy_version into new.privacy_version from public.whatsapp_config where id;
  if new.privacy_version is null then raise exception 'Falta versión del aviso de privacidad';end if;
 else new.privacy_version:=null;end if;
 return new;
end;$$;
create or replace function importados_private.whatsapp_bind_notice()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.purpose='privacy_notice' then
  update public.whatsapp_conversations set privacy_notice_id=new.id,consent_version=new.privacy_version,
   consent_status=case when consent_status='revoked' then 'revoked' else 'unknown' end,
   privacy_notice_delivered_at=null where id=new.conversation_id;
 end if;
 return new;
end;$$;
create or replace function importados_private.whatsapp_guard_notice_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
declare notice_valid boolean;
begin
 if new.consent_status='revoked' then new.privacy_notice_id:=null;new.privacy_notice_delivered_at:=null;return new;end if;
 select exists(select 1 from public.whatsapp_outbox o cross join public.whatsapp_config cfg
  where cfg.id and o.id=new.privacy_notice_id and o.conversation_id=new.id and o.purpose='privacy_notice'
  and o.privacy_version=new.consent_version and o.privacy_version=cfg.privacy_version
  and o.status in ('delivered','read')) into notice_valid;
 if not notice_valid then new.privacy_notice_delivered_at:=null;end if;
 if new.consent_status='granted' and old.consent_status is distinct from 'granted'
  and (not notice_valid or new.privacy_notice_delivered_at is null) then
  new.consent_status:=old.consent_status;new.consent_at:=old.consent_at;
 end if;
 return new;
end;$$;
create or replace function importados_private.whatsapp_apply_notice_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.purpose='privacy_notice' and new.status in ('delivered','read') then
  update public.whatsapp_conversations c set privacy_notice_delivered_at=coalesce(c.privacy_notice_delivered_at,now())
   from public.whatsapp_config cfg where cfg.id and c.id=new.conversation_id and c.privacy_notice_id=new.id
   and c.consent_status<>'revoked' and c.consent_version=new.privacy_version and cfg.privacy_version=new.privacy_version;
 end if;
 return new;
end;$$;
drop trigger if exists whatsapp_notice_version on public.whatsapp_outbox;
create trigger whatsapp_notice_version before insert on public.whatsapp_outbox for each row execute function importados_private.whatsapp_notice_version();
drop trigger if exists whatsapp_bind_notice on public.whatsapp_outbox;
create trigger whatsapp_bind_notice after insert on public.whatsapp_outbox for each row execute function importados_private.whatsapp_bind_notice();
drop trigger if exists whatsapp_guard_notice_receipt on public.whatsapp_conversations;
create trigger whatsapp_guard_notice_receipt before update on public.whatsapp_conversations for each row execute function importados_private.whatsapp_guard_notice_receipt();
drop trigger if exists whatsapp_apply_notice_receipt on public.whatsapp_outbox;
create trigger whatsapp_apply_notice_receipt after update of status,meta_message_id on public.whatsapp_outbox for each row execute function importados_private.whatsapp_apply_notice_receipt();
revoke all on function importados_private.whatsapp_notice_version(),importados_private.whatsapp_bind_notice(),importados_private.whatsapp_guard_notice_receipt(),importados_private.whatsapp_apply_notice_receipt() from public,anon,authenticated;
commit;
