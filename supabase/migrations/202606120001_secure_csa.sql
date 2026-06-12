begin;

create table if not exists public.csa_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  agent_code text not null unique,
  display_name text not null,
  job_title text not null,
  module text not null check (module in ('accueil', 'soins', 'labo', 'pharmacie', 'compta', 'chef')),
  building text,
  is_chef boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.csa_events
  add column if not exists created_by uuid references auth.users(id);

create unique index if not exists csa_events_event_key_uidx
  on public.csa_events(event_key);

create index if not exists csa_events_table_updated_idx
  on public.csa_events(table_name, updated_at desc);

alter table public.csa_profiles enable row level security;
alter table public.csa_events enable row level security;

revoke all on table public.csa_profiles from anon;
revoke all on table public.csa_events from anon;
grant select on table public.csa_profiles to authenticated;
grant select, insert, update on table public.csa_events to authenticated;

create or replace function public.csa_current_profile()
returns public.csa_profiles
language sql
stable
security definer
set search_path = public
as $$
  select p
  from public.csa_profiles p
  where p.user_id = auth.uid() and p.active
  limit 1
$$;

create or replace function public.csa_is_chief()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.csa_profiles p
    where p.user_id = auth.uid() and p.active and p.is_chef
  )
$$;

create or replace function public.csa_can_read(target_table text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.csa_profiles p
    where p.user_id = auth.uid()
      and p.active
      and (
        p.is_chef
        or (p.module = 'accueil' and target_table in ('patients','consultations','constantes'))
        or (p.module = 'soins' and target_table in ('patients','consultations','constantes','soins','observations'))
        or (p.module = 'labo' and target_table in ('patients','consultations','labo_actes'))
        or (p.module = 'pharmacie' and target_table in ('patients','consultations','pharma_ventes','pharma_stock'))
        or (p.module = 'compta' and target_table in ('transactions','clotures','audit_logs'))
      )
  )
$$;

create or replace function public.csa_can_write(target_table text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.csa_profiles p
    where p.user_id = auth.uid()
      and p.active
      and (
        p.is_chef
        or (p.module = 'accueil' and target_table in ('patients','consultations','constantes','transactions','audit_logs'))
        or (p.module = 'soins' and target_table in ('soins','observations','transactions','audit_logs'))
        or (p.module = 'labo' and target_table in ('labo_actes','transactions','audit_logs'))
        or (p.module = 'pharmacie' and target_table in ('pharma_ventes','pharma_stock','transactions','audit_logs'))
        or (p.module = 'compta' and target_table in ('clotures','audit_logs'))
      )
  )
$$;

drop policy if exists "profiles_read_own" on public.csa_profiles;
create policy "profiles_read_own"
on public.csa_profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.csa_is_chief()
);

drop policy if exists "events_read_by_role" on public.csa_events;
create policy "events_read_by_role"
on public.csa_events
for select
to authenticated
using (public.csa_can_read(table_name));

drop policy if exists "events_insert_by_role" on public.csa_events;
create policy "events_insert_by_role"
on public.csa_events
for insert
to authenticated
with check (
  public.csa_can_write(table_name)
  and created_by = auth.uid()
  and coalesce(payload->>'agent_id', '') = (
    select p.agent_code from public.csa_profiles p
    where p.user_id = auth.uid() and p.active
  )
);

drop policy if exists "events_update_by_role" on public.csa_events;
create policy "events_update_by_role"
on public.csa_events
for update
to authenticated
using (
  public.csa_can_write(table_name)
  and table_name in ('patients','observations','pharma_stock')
)
with check (
  public.csa_can_write(table_name)
  and table_name in ('patients','observations','pharma_stock')
  and created_by = auth.uid()
  and coalesce(payload->>'agent_id', '') = (
    select p.agent_code from public.csa_profiles p
    where p.user_id = auth.uid() and p.active
  )
);

revoke all on function public.csa_current_profile() from public;
revoke all on function public.csa_is_chief() from public;
revoke all on function public.csa_can_read(text) from public;
revoke all on function public.csa_can_write(text) from public;
grant execute on function public.csa_current_profile() to authenticated;
grant execute on function public.csa_is_chief() to authenticated;
grant execute on function public.csa_can_read(text) to authenticated;
grant execute on function public.csa_can_write(text) to authenticated;

create or replace function public.csa_set_event_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists csa_events_set_owner on public.csa_events;
create trigger csa_events_set_owner
before insert or update on public.csa_events
for each row execute function public.csa_set_event_owner();

commit;
