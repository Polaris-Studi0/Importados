-- Aplicar únicamente al proyecto Importados: opeytkcqblgjfyvfjkwe.
begin;
create table if not exists public.job_applications (
  id uuid primary key,
  receipt text not null unique,
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) <= 254),
  phone text not null,
  branch text not null check (branch in ('santa-lucia','niquia','cualquiera')),
  object_path text not null unique,
  file_size integer not null check (file_size between 1 and 5242880),
  payload_hash text not null,
  status text not null default 'uploading' check (status in ('uploading','received')),
  consent_version text not null default 'recruitment-2026-10-12',
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.job_applications enable row level security;
revoke all on public.job_applications from anon, authenticated;
grant select, insert, update, delete on public.job_applications to service_role;
create index if not exists job_applications_received_idx on public.job_applications (created_at desc) where status='received';
comment on table public.job_applications is 'Postulaciones de Importados. Lectura y escritura exclusivas del servicio; ninguna política pública.';
commit;
