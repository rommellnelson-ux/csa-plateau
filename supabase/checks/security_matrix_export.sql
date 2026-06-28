-- ════════════════════════════════════════════════════════
-- Export des objets de sécurité (Phase 0.3) — à exécuter dans le SQL Editor.
-- Copier chaque résultat dans docs/SECURITY_MATRIX.md (preuve écrite des droits
-- réellement en base, vs ce que le code prétend). À relancer après chaque
-- migration touchant la sécurité. 100% lecture seule.
-- ════════════════════════════════════════════════════════

-- 1) Toutes les policies RLS (lecture/écriture par table)
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='public'
order by tablename, cmd, policyname;

-- 2) Définition complète des fonctions de sécurité (à comparer au code)
select p.proname,
       pg_get_functiondef(p.oid) as definition,
       r.rolname as owner,
       p.prosecdef as security_definer
from pg_proc p
join pg_roles r on r.oid = p.proowner
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('csa_can_read','csa_can_write','csa_has_aal2','csa_chief_has_aal2','csa_is_chief','csa_current_profile')
order by p.proname;

-- 3) Privilèges de table (qui peut faire quoi) — surveiller anon/public
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name in ('csa_events','csa_profiles')
order by table_name, grantee, privilege_type;

-- 4) Droits EXECUTE sur les fonctions sensibles (anon/public ne doivent pas figurer)
select p.proname, r.rolname as grantee
from pg_proc p
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
join pg_roles r on r.oid = a.grantee
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and a.privilege_type='EXECUTE'
  and p.proname like 'csa\_%'
order by p.proname, grantee;

-- 5) RLS activé sur les tables exposées ? (rowsecurity doit être true)
select relname, relrowsecurity as rls_active, relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace and relkind='r'
  and relname in ('csa_events','csa_profiles')
order by relname;

-- 6) Triggers sur csa_events (ex. pose de created_by)
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.csa_events'::regclass and not tgisinternal
order by tgname;
