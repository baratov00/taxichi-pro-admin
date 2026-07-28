-- Taxichi Pro auth hardening.
-- Safe to apply while old clients still work: it only adds tables/columns/indexes.

create extension if not exists pgcrypto;

alter table if exists public.taxichi_pro_dispatchers
  add column if not exists password_hash text,
  add column if not exists last_login_at timestamptz,
  add column if not exists disabled_at timestamptz;

alter table if exists public.taxichi_pro_directors
  add column if not exists password_hash text,
  add column if not exists last_login_at timestamptz,
  add column if not exists disabled_at timestamptz;

create table if not exists public.taxichi_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('admin','director','driver','system')),
  actor_id text not null,
  token_hash text not null unique,
  user_agent text,
  ip text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_taxichi_sessions_actor on public.taxichi_sessions(actor_type, actor_id);
create index if not exists idx_taxichi_sessions_expires on public.taxichi_sessions(expires_at);
create index if not exists idx_taxichi_sessions_token_hash on public.taxichi_sessions(token_hash);

create table if not exists public.taxichi_login_attempts (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  login text,
  success boolean not null default false,
  ip text,
  user_agent text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_taxichi_login_attempts_login_time on public.taxichi_login_attempts(login, created_at desc);
