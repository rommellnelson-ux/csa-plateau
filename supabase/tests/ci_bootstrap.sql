-- ════════════════════════════════════════════════════════
-- Bootstrap CI — stub minimal de l'environnement Supabase
-- Un Postgres nu ne connaît ni le schéma `auth`, ni les rôles Supabase, ni
-- auth.uid()/auth.jwt(). Les migrations en dépendent (grants, FK vers auth.users,
-- policies). Ce script recrée juste ce qu'il faut pour APPLIQUER les migrations
-- et FAIRE TOURNER les pgTAP en CI. Il n'est PAS destiné à la prod.
-- ════════════════════════════════════════════════════════

-- Rôles référencés par les grants/policies des migrations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon          nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role  nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

create extension if not exists pgcrypto;
create extension if not exists pgtap;

-- Table cible des FK (csa_profiles.user_id, csa_events.created_by).
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- auth.uid()/auth.jwt()/auth.role() lisent le GUC request.jwt.claims, exactement
-- comme sur Supabase -> les tests posent la session via set_config(...).
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
