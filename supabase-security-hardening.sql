-- Taxichi Pro security hardening
-- ВНИМАНИЕ: этот SQL подготавливает структуру.
-- Строгие RLS-политики включайте только после перевода сайтов/APK на серверные Edge Functions.

create extension if not exists pgcrypto;

alter table if exists public.taxichi_pro_dispatchers
  add column if not exists director_id text,
  add column if not exists password_hash text,
  add column if not exists role text default 'admin',
  add column if not exists last_login_at timestamptz,
  add column if not exists disabled_at timestamptz;

alter table if exists public.taxichi_pro_directors
  add column if not exists password_hash text,
  add column if not exists role text default 'director',
  add column if not exists last_login_at timestamptz;

alter table if exists public.driver_profiles
  add column if not exists admin_id text,
  add column if not exists driver_id text,
  add column if not exists deleted_at timestamptz;

alter table if exists public.waybills
  add column if not exists admin_id text,
  add column if not exists driver_profile_id text,
  add column if not exists deleted_at timestamptz;

create table if not exists public.taxichi_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id text,
  admin_id text,
  action text not null,
  entity_table text,
  entity_id text,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.taxichi_payments (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id text,
  admin_id text,
  provider text not null default 'yookassa',
  provider_payment_id text unique,
  amount numeric not null default 0,
  currency text not null default 'RUB',
  status text not null default 'pending',
  days integer not null default 0,
  raw jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.taxichi_backups (
  id uuid primary key default gen_random_uuid(),
  admin_id text,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_taxichi_dispatchers_login on public.taxichi_pro_dispatchers(login);
create index if not exists idx_taxichi_dispatchers_director on public.taxichi_pro_dispatchers(director_id);
create index if not exists idx_driver_profiles_admin on public.driver_profiles(admin_id);
create index if not exists idx_driver_profiles_phone_digits on public.driver_profiles(phone_digits);
create index if not exists idx_waybills_admin_date on public.waybills(admin_id, date desc);
create index if not exists idx_waybills_driver_date on public.waybills(driver_profile_id, date desc);
create index if not exists idx_audit_admin_created on public.taxichi_audit_logs(admin_id, created_at desc);
create index if not exists idx_payments_provider_payment_id on public.taxichi_payments(provider_payment_id);

create or replace function public.taxichi_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists taxichi_payments_touch_updated_at on public.taxichi_payments;
create trigger taxichi_payments_touch_updated_at
before update on public.taxichi_payments
for each row execute function public.taxichi_touch_updated_at();

create or replace function public.taxichi_current_admin_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'taxichi_admin_id', '')
$$;

create or replace function public.taxichi_current_director_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'taxichi_director_id', '')
$$;

-- RLS-режим для следующего этапа.
-- Не включайте эти строки, пока фронтенд работает напрямую через anon key.
--
-- alter table public.taxichi_pro_dispatchers enable row level security;
-- alter table public.driver_profiles enable row level security;
-- alter table public.waybills enable row level security;
-- alter table public.taxichi_audit_logs enable row level security;
-- alter table public.taxichi_payments enable row level security;
--
-- create policy dispatchers_by_director on public.taxichi_pro_dispatchers
--   for all to authenticated
--   using (director_id = public.taxichi_current_director_id() or id = public.taxichi_current_admin_id())
--   with check (director_id = public.taxichi_current_director_id());
--
-- create policy driver_profiles_by_admin on public.driver_profiles
--   for all to authenticated
--   using (admin_id = public.taxichi_current_admin_id())
--   with check (admin_id = public.taxichi_current_admin_id());
--
-- create policy waybills_by_admin on public.waybills
--   for all to authenticated
--   using (admin_id = public.taxichi_current_admin_id())
--   with check (admin_id = public.taxichi_current_admin_id());
