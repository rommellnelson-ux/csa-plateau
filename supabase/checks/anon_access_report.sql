-- ════════════════════════════════════════════════════════
-- Vérification : le rôle anonyme n'a aucun accès aux données.
-- Les DEUX requêtes doivent renvoyer 0 ligne.
-- À relancer après 202606270001_harden_anon_access.sql.
-- ════════════════════════════════════════════════════════

-- 1) Plus aucune policy *_anon (doit être vide)
select policyname, tablename
from pg_policies
where schemaname='public'
  and tablename in ('csa_events','csa_profiles')
  and policyname ilike '%anon%';

-- 2) anon / public n'ont AUCUN privilège de table (doit être vide)
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('csa_events','csa_profiles')
  and grantee in ('anon','public')
order by grantee, table_name, privilege_type;
