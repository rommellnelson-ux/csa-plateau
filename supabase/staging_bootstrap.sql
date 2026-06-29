-- ════════════════════════════════════════════════════════
-- BOOTSTRAP STAGING — recrée tout le schéma CSA sur un projet Supabase VIDE.
-- À exécuter UNE FOIS dans le SQL Editor du projet STAGING (pas la prod !).
-- Reproduit l'état courant de la prod (tables, fonctions RLS, policies,
-- triggers, colonnes de synchro). AUCUNE donnée réelle.
-- ════════════════════════════════════════════════════════
begin;

-- 1) TABLES ────────────────────────────────────────────────
create table if not exists public.csa_events (
  id              bigint generated always as identity primary key,
  event_key       text not null,
  table_name      text not null,
  item_id         text,
  payload         jsonb not null default '{}'::jsonb,
  agent_id        text,
  agent_nom       text,
  created_by      uuid references auth.users(id),
  client_event_id uuid,
  entity_version  bigint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.csa_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  agent_code   text not null unique,
  display_name text not null,
  job_title    text not null,
  module       text not null check (module in ('accueil','soins','labo','pharmacie','compta','chef','sevci')),
  permissions  text[] not null default array[]::text[],
  building     text,
  is_chef      boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint csa_profiles_permissions_check check (
    permissions <@ array['accueil','as','soins','labo','pharmacie','compta','chef','sevci_med','sevci_data','sevci_sup']::text[]
    and cardinality(permissions) > 0
  )
);

-- 2) INDEX ─────────────────────────────────────────────────
create unique index if not exists csa_events_event_key_uidx on public.csa_events(event_key);
create index        if not exists csa_events_table_updated_idx on public.csa_events(table_name, updated_at desc);
create unique index if not exists csa_events_client_event_id_key on public.csa_events(client_event_id) where client_event_id is not null;

-- 3) RLS + GRANTS ──────────────────────────────────────────
alter table public.csa_profiles enable row level security;
alter table public.csa_events   enable row level security;
revoke all on table public.csa_profiles from anon;
revoke all on table public.csa_profiles from public;
revoke all on table public.csa_events   from anon;
revoke all on table public.csa_events   from public;
grant select on table public.csa_profiles to authenticated;
grant select, insert, update on table public.csa_events to authenticated;

-- 4) FONCTIONS ─────────────────────────────────────────────
create or replace function public.csa_is_chief()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.csa_profiles p where p.user_id = auth.uid() and p.active and p.is_chef)
$$;

create or replace function public.csa_current_profile()
returns public.csa_profiles language sql stable security definer set search_path = public as $$
  select p from public.csa_profiles p where p.user_id = auth.uid() and p.active limit 1
$$;

create or replace function public.csa_chief_has_aal2()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal','aal1') = 'aal2'
$$;

create or replace function public.csa_has_aal2()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal','aal1') = 'aal2'
$$;

create or replace function public.csa_can_read(target_table text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.csa_profiles p
    where p.user_id = auth.uid() and p.active and (
      (p.is_chef and public.csa_chief_has_aal2())
      or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes'))
      or ('as' = any(p.permissions) and target_table in ('patients','constantes'))
      or ('soins' = any(p.permissions) and target_table in ('patients','consultations','constantes','soins','observations'))
      or ('labo' = any(p.permissions) and target_table in ('patients','consultations','labo_actes'))
      or ('pharmacie' = any(p.permissions) and target_table in ('patients','consultations','pharma_ventes','pharma_stock','pharma_lots','pharma_mouvements','pharma_inventaires'))
      or ('compta' = any(p.permissions) and target_table in ('transactions','clotures','audit_logs'))
      or (public.csa_has_aal2() and p.permissions && array['sevci_med','sevci_data','sevci_sup'] and target_table in ('sevci_pvvih','sevci_actions'))
    )
  )
$$;

create or replace function public.csa_can_write(target_table text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.csa_profiles p
    where p.user_id = auth.uid() and p.active and (
      (p.is_chef and public.csa_chief_has_aal2())
      or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes','transactions','audit_logs'))
      or ('as' = any(p.permissions) and target_table in ('patients','constantes','transactions','audit_logs'))
      or ('soins' = any(p.permissions) and target_table in ('patients','consultations','constantes','soins','observations','transactions','audit_logs'))
      or ('labo' = any(p.permissions) and target_table in ('patients','labo_actes','transactions','audit_logs'))
      or ('pharmacie' = any(p.permissions) and target_table in ('patients','pharma_ventes','pharma_stock','pharma_lots','pharma_mouvements','pharma_inventaires','transactions','audit_logs'))
      or ('compta' = any(p.permissions) and target_table in ('clotures','audit_logs'))
      or (public.csa_has_aal2() and 'sevci_med'  = any(p.permissions) and target_table in ('sevci_actions','audit_logs'))
      or (public.csa_has_aal2() and 'sevci_data' = any(p.permissions) and target_table in ('sevci_pvvih','sevci_actions','audit_logs'))
      or (public.csa_has_aal2() and 'sevci_sup'  = any(p.permissions) and target_table in ('sevci_pvvih','sevci_actions','audit_logs'))
    )
  )
$$;

create or replace function public.csa_set_event_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.created_by := auth.uid();
  new.updated_at := now();
  return new;
end; $$;

create or replace function public.csa_set_entity_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    new.entity_version := coalesce((select e.entity_version from public.csa_events e where e.event_key = new.event_key), 0) + 1;
  else
    new.entity_version := coalesce(old.entity_version, 0) + 1;
  end if;
  return new;
end; $$;

create or replace function public.csa_validate_event()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare p jsonb := new.payload; v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'csa: payload invalide (objet JSON requis) pour %', new.table_name;
  end if;
  if new.table_name = 'constantes' then
    if (p->>'temperature') ~ '^[0-9]+(\.[0-9]+)?$' then v:=(p->>'temperature')::numeric;
      if v>0 and (v<25 or v>45) then raise exception 'csa: température hors plage: %', v; end if; end if;
    if (p->>'spo2') ~ '^[0-9]+(\.[0-9]+)?$' then v:=(p->>'spo2')::numeric;
      if v>100 then raise exception 'csa: SpO2 hors plage: %', v; end if; end if;
    if (p->>'poids') ~ '^[0-9]+(\.[0-9]+)?$' then v:=(p->>'poids')::numeric;
      if v>0 and v>600 then raise exception 'csa: poids hors plage: %', v; end if; end if;
    if (p->>'taille') ~ '^[0-9]+(\.[0-9]+)?$' then v:=(p->>'taille')::numeric;
      if v>0 and v>300 then raise exception 'csa: taille hors plage: %', v; end if; end if;
    if (p->>'pouls') ~ '^[0-9]+(\.[0-9]+)?$' then v:=(p->>'pouls')::numeric;
      if v>0 and v>400 then raise exception 'csa: pouls hors plage: %', v; end if; end if;
  elsif new.table_name in ('transactions','soins','labo_actes','pharma_ventes') then
    if (p->>'montant') ~ '^\s*-' then raise exception 'csa: montant négatif interdit'; end if;
    if (p->>'total')   ~ '^\s*-' then raise exception 'csa: total négatif interdit'; end if;
  end if;
  return new;
end; $fn$;

-- Commit atomique d'un groupe d'événements append-only (Phase 2.2).
create or replace function public.csa_commit(events jsonb)
returns integer language plpgsql security definer set search_path = public as $cm$
declare e jsonb; my_agent text; n int := 0;
begin
  if jsonb_typeof(events) <> 'array' then
    raise exception 'csa_commit: events doit être un tableau JSON';
  end if;
  select p.agent_code into my_agent from public.csa_profiles p
    where p.user_id = auth.uid() and p.active;
  if my_agent is null then raise exception 'csa_commit: profil introuvable ou inactif'; end if;
  for e in select * from jsonb_array_elements(events) loop
    if e->>'table_name' in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires','sevci_pvvih') then
      raise exception 'csa_commit: table mutable % interdite dans un commit de groupe', e->>'table_name'; end if;
    if not public.csa_can_write(e->>'table_name') then
      raise exception 'csa_commit: écriture non autorisée sur %', e->>'table_name'; end if;
    if coalesce(e->>'agent_id','') <> my_agent then
      raise exception 'csa_commit: agent_id usurpé'; end if;
    insert into public.csa_events (event_key, table_name, item_id, payload, agent_id, agent_nom, client_event_id)
    values (e->>'event_key', e->>'table_name', e->>'item_id', coalesce(e->'payload','{}'::jsonb),
            e->>'agent_id', e->>'agent_nom', nullif(e->>'client_event_id','')::uuid)
    on conflict (event_key) do nothing;
    n := n + 1;
  end loop;
  return n;
end; $cm$;

-- 5) TRIGGERS ──────────────────────────────────────────────
drop trigger if exists csa_events_set_owner on public.csa_events;
create trigger csa_events_set_owner before insert or update on public.csa_events
  for each row execute function public.csa_set_event_owner();

drop trigger if exists csa_events_set_entity_version on public.csa_events;
create trigger csa_events_set_entity_version before insert or update on public.csa_events
  for each row execute function public.csa_set_entity_version();

drop trigger if exists csa_events_validate on public.csa_events;
create trigger csa_events_validate before insert or update on public.csa_events
  for each row execute function public.csa_validate_event();

-- 6) POLICIES ──────────────────────────────────────────────
drop policy if exists "profiles_read_own" on public.csa_profiles;
create policy "profiles_read_own" on public.csa_profiles for select to authenticated
  using (user_id = auth.uid() or public.csa_is_chief());

drop policy if exists "events_read_by_role" on public.csa_events;
create policy "events_read_by_role" on public.csa_events for select to authenticated
  using (public.csa_can_read(table_name));

drop policy if exists "events_insert_by_role" on public.csa_events;
create policy "events_insert_by_role" on public.csa_events for insert to authenticated
  with check (
    public.csa_can_write(table_name)
    and created_by = auth.uid()
    and coalesce(payload->>'agent_id','') = (select p.agent_code from public.csa_profiles p where p.user_id = auth.uid() and p.active)
  );

drop policy if exists "events_update_by_role" on public.csa_events;
create policy "events_update_by_role" on public.csa_events for update to authenticated
  using (
    public.csa_can_write(table_name)
    and table_name in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires','sevci_pvvih')
  )
  with check (
    public.csa_can_write(table_name)
    and table_name in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires','sevci_pvvih')
    and created_by = auth.uid()
    and coalesce(payload->>'agent_id','') = (select p.agent_code from public.csa_profiles p where p.user_id = auth.uid() and p.active)
  );

-- 7) DROITS EXECUTE ────────────────────────────────────────
revoke all on function public.csa_is_chief() from public;
revoke all on function public.csa_current_profile() from public;
revoke all on function public.csa_chief_has_aal2() from public;
revoke all on function public.csa_has_aal2() from public;
revoke all on function public.csa_can_read(text) from public;
revoke all on function public.csa_can_write(text) from public;
revoke all on function public.csa_commit(jsonb) from public;
grant execute on function public.csa_is_chief() to authenticated;
grant execute on function public.csa_current_profile() to authenticated;
grant execute on function public.csa_chief_has_aal2() to authenticated;
grant execute on function public.csa_has_aal2() to authenticated;
grant execute on function public.csa_can_read(text) to authenticated;
grant execute on function public.csa_can_write(text) to authenticated;
grant execute on function public.csa_commit(jsonb) to authenticated;

commit;
