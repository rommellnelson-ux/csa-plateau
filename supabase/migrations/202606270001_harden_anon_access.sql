-- ════════════════════════════════════════════════════════
-- Durcissement de l'accès anonyme à csa_events / csa_profiles
-- Migration : 202606270001
--
-- Des policies « *_anon » (csa_events_select_anon / insert_anon / update_anon)
-- subsistaient, vestiges d'une phase de démo sans authentification. L'app
-- fonctionne uniquement avec des comptes authentifiés + RLS par rôle. Le rôle
-- « anon » (non connecté) ne doit avoir AUCUN accès aux données médicales.
--
-- Cette migration :
--   1. supprime les policies *_anon permissives,
--   2. révoque tout privilège de table à anon et public,
--   3. ré-affirme les privilèges au seul rôle authenticated.
--
-- Sans danger pour l'app : la connexion (supabase.auth) n'utilise pas ces
-- tables ; tout accès aux données se fait en authenticated.
-- À exécuter dans le SQL Editor. Vérification dans
-- supabase/checks/anon_access_report.sql.
-- ════════════════════════════════════════════════════════

begin;

-- 1) Retirer les policies anonymes (si présentes)
drop policy if exists "csa_events_select_anon" on public.csa_events;
drop policy if exists "csa_events_insert_anon" on public.csa_events;
drop policy if exists "csa_events_update_anon" on public.csa_events;
drop policy if exists "csa_profiles_select_anon" on public.csa_profiles;

-- 2) Révoquer tout accès aux rôles non authentifiés
revoke all on table public.csa_events   from anon;
revoke all on table public.csa_events   from public;
revoke all on table public.csa_profiles from anon;
revoke all on table public.csa_profiles from public;

-- 3) Ré-affirmer les droits du seul rôle authentifié (RLS reste la barrière)
grant select, insert, update on table public.csa_events to authenticated;
grant select on table public.csa_profiles to authenticated;

commit;
