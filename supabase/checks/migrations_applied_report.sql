-- ════════════════════════════════════════════════════════
-- Rapport : objets de migration présents en base (repo vs prod)
-- Les migrations sont appliquées À LA MAIN dans le SQL Editor (pas de CLI) ->
-- une migration du repo peut silencieusement NE PAS être en prod. Ce rapport
-- liste chaque objet attendu (colonnes / fonctions / triggers / index / RLS)
-- et vérifie qu'il existe. C'est ainsi qu'on a détecté, le 2026-06-30, l'absence
-- de la colonne csa_events.client_event_id (migration 202606270003 non appliquée
-- en prod alors que csa_commit l'utilisait -> commit de groupe cassé).
--
-- EXÉCUTER : SQL Editor -> coller -> Run. 100% lecture, aucun effet.
-- RÉSULTAT ATTENDU : colonne « ok » = true PARTOUT (statut « OK »). Toute ligne
-- « ⚠ MANQUANT » = un objet de migration absent -> migration à (ré)appliquer.
-- Les manquants apparaissent EN HAUT (tri ok asc).
-- ════════════════════════════════════════════════════════

with checks(categorie, objet, ok) as (

  -- ── Tables ──
  select 'table', 'public.csa_events',   to_regclass('public.csa_events')   is not null
  union all select 'table', 'public.csa_profiles', to_regclass('public.csa_profiles') is not null

  -- ── Colonnes (csa_events + csa_profiles) ──
  union all select 'colonne', 'csa_events.created_by',       exists(select 1 from information_schema.columns where table_schema='public' and table_name='csa_events'   and column_name='created_by')
  union all select 'colonne', 'csa_events.entity_version',   exists(select 1 from information_schema.columns where table_schema='public' and table_name='csa_events'   and column_name='entity_version')
  union all select 'colonne', 'csa_events.client_event_id',  exists(select 1 from information_schema.columns where table_schema='public' and table_name='csa_events'   and column_name='client_event_id')
  union all select 'colonne', 'csa_profiles.permissions',    exists(select 1 from information_schema.columns where table_schema='public' and table_name='csa_profiles' and column_name='permissions')

  -- ── Fonctions (par nom, schéma public) ──
  union all select 'fonction', 'csa_can_read',                       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_can_read')
  union all select 'fonction', 'csa_can_write',                      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_can_write')
  union all select 'fonction', 'csa_is_chief',                       exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_is_chief')
  union all select 'fonction', 'csa_current_profile',               exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_current_profile')
  union all select 'fonction', 'csa_chief_has_aal2',                exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_chief_has_aal2')
  union all select 'fonction', 'csa_has_aal2',                      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_has_aal2')
  union all select 'fonction', 'csa_set_event_owner',               exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_set_event_owner')
  union all select 'fonction', 'csa_set_entity_version',            exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_set_entity_version')
  union all select 'fonction', 'csa_validate_event',                exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_validate_event')
  union all select 'fonction', 'csa_commit',                        exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_commit')
  union all select 'fonction', 'csa_protect_pharma_stock_insert',   exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_protect_pharma_stock_insert')
  union all select 'fonction', 'csa_protect_pharma_catalogue_fields', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_protect_pharma_catalogue_fields')
  union all select 'fonction', 'csa_normalize_constantes',          exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_normalize_constantes')
  union all select 'fonction', 'csa_safe_number',                   exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_safe_number')
  union all select 'fonction', 'csa_valid_ean',                     exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='csa_valid_ean')

  -- ── Triggers sur csa_events (non internes) ──
  union all select 'trigger', 'csa_events_set_owner',                  exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='csa_events' and not t.tgisinternal and t.tgname='csa_events_set_owner')
  union all select 'trigger', 'csa_events_set_entity_version',         exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='csa_events' and not t.tgisinternal and t.tgname='csa_events_set_entity_version')
  union all select 'trigger', 'csa_events_validate',                   exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='csa_events' and not t.tgisinternal and t.tgname='csa_events_validate')
  union all select 'trigger', 'csa_events_protect_pharma_stock_insert', exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='csa_events' and not t.tgisinternal and t.tgname='csa_events_protect_pharma_stock_insert')
  union all select 'trigger', 'csa_events_protect_pharma_catalogue',    exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='csa_events' and not t.tgisinternal and t.tgname='csa_events_protect_pharma_catalogue')

  -- ── Index sur csa_events ──
  union all select 'index', 'csa_events_event_key_uidx',        exists(select 1 from pg_indexes where schemaname='public' and indexname='csa_events_event_key_uidx')
  union all select 'index', 'csa_events_table_updated_idx',     exists(select 1 from pg_indexes where schemaname='public' and indexname='csa_events_table_updated_idx')
  union all select 'index', 'csa_events_client_event_id_key',   exists(select 1 from pg_indexes where schemaname='public' and indexname='csa_events_client_event_id_key')

  -- ── RLS activée ──
  union all select 'rls', 'csa_events RLS activée',   coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='csa_events'),   false)
  union all select 'rls', 'csa_profiles RLS activée', coalesce((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='csa_profiles'), false)
)
select
  categorie,
  objet,
  coalesce(ok, false)                                  as ok,
  case when coalesce(ok, false) then 'OK' else '⚠ MANQUANT' end as statut
from checks
order by coalesce(ok, false) asc, categorie, objet;
