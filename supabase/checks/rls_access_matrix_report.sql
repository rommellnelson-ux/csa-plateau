-- ════════════════════════════════════════════════════════
-- Contrôle de non-régression RLS — à exécuter dans le SQL Editor.
-- Version 100% SELECT (lecture seule, sans bloc do/$$ que l'éditeur Supabase
-- peut tronquer). Toutes les lignes doivent renvoyer ok = true.
-- Une ligne à false = exactement l'accès manquant (ex. policy UPDATE sans
-- sevci_pvvih => les charges virales ne se synchronisent pas).
-- À relancer après chaque migration touchant le RLS.
-- ════════════════════════════════════════════════════════

with defs as (
  select
    pg_get_functiondef('public.csa_can_read(text)'::regprocedure)  as r,
    pg_get_functiondef('public.csa_can_write(text)'::regprocedure) as w,
    (select coalesce(qual,'')||' '||coalesce(with_check,'') from pg_policies
       where tablename='csa_events' and policyname='events_update_by_role') as upd,
    (select coalesce(with_check,'') from pg_policies
       where tablename='csa_events' and policyname='events_insert_by_role') as ins
)
select 'lecture: pharma_lots'         as verif, (r   like '%pharma_lots%')        as ok from defs
union all select 'lecture: pharma_mouvements',   (r   like '%pharma_mouvements%')        from defs
union all select 'lecture: pharma_inventaires',  (r   like '%pharma_inventaires%')       from defs
union all select 'lecture: sevci_pvvih',         (r   like '%sevci_pvvih%')              from defs
union all select 'lecture: sevci_actions',       (r   like '%sevci_actions%')            from defs
union all select 'lecture: MFA sevci (aal2)',    (r   like '%csa_has_aal2%')             from defs
union all select 'ecriture: pharma_lots',        (w   like '%pharma_lots%')              from defs
union all select 'ecriture: sevci_pvvih',        (w   like '%sevci_pvvih%')              from defs
union all select 'ecriture: sevci_actions',      (w   like '%sevci_actions%')            from defs
union all select 'policy UPDATE: pharma_lots',   (upd like '%pharma_lots%')              from defs
union all select 'policy UPDATE: sevci_pvvih',   (upd like '%sevci_pvvih%')              from defs
union all select 'policy INSERT: created_by',    (ins like '%created_by%')               from defs;

-- Récap profils SEV-CI
select agent_code, module, permissions, active
from public.csa_profiles
where module = 'sevci' or permissions && array['sevci_med','sevci_data','sevci_sup']
order by agent_code;

-- Récap policies actives sur csa_events
select policyname, cmd
from pg_policies
where schemaname='public' and tablename='csa_events'
order by cmd, policyname;
