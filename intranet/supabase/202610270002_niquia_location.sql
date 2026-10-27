-- Business facts confirmed by the owner on 27 October 2026. Importados only.
begin;
do $$ begin
 if not exists(select 1 from public.branches where id='niquia' and address in ('Dg. 55 AV 33','Diagonal 55 Av 38-33 · Edificio Valkiria') and (hours is null or hours='9:00 a. m. – 8:00 p. m.')) then
  raise exception 'La información de Niquía cambió; revisar antes de actualizar';
 end if;
 if exists(select 1 from public.branch_knowledge where id='c4779076-0b72-4c88-8ac7-02e4cc8f1cfe' and branch_id is distinct from 'niquia') then
  raise exception 'Identificador de información ocupado';
 end if;
end;$$;
update public.branches set address='Diagonal 55 Av 38-33 · Edificio Valkiria',hours='9:00 a. m. – 8:00 p. m.' where id='niquia';
insert into public.branch_knowledge(id,branch_id,topic,content,active) values(
 'c4779076-0b72-4c88-8ac7-02e4cc8f1cfe','niquia','Sede Niquía: apertura, horario y dirección',
 'Importados Niquía, Bello, ya está abierta. Dirección: Diagonal 55 Av 38-33, edificio Valkiria. Horario físico confirmado: 9:00 a. m. – 8:00 p. m. La gran inauguración será el 14 y 15 de noviembre de 2026. Este horario de tienda no establece el horario de domicilios ni de atención por WhatsApp. No se han especificado horarios especiales para domingos o festivos.',true)
on conflict(id) do update set content=excluded.content,active=true,updated_at=now();
commit;
