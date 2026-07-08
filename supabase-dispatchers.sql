create table if not exists public.taxichi_pro_dispatchers (
  id text primary key,
  name text not null,
  phone text,
  login text not null unique,
  password text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.taxichi_pro_dispatchers disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.taxichi_pro_dispatchers to anon, authenticated;

insert into public.taxichi_pro_dispatchers (id, name, phone, login, password, active)
values ('demo', 'Иванова Мария', '+7 999 999-77-42', 'admin', '1234', true)
on conflict (id) do update set
  name = excluded.name,
  phone = excluded.phone,
  login = excluded.login,
  password = excluded.password,
  active = excluded.active,
  updated_at = now();
