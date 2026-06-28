-- ════════════════════════════════════════════════════════
-- Élargir csa_can_write : permettre la saisie infirmière des constantes et la
-- création de patients depuis soins / labo / pharmacie.
-- Migration : 202606270002
--
-- Contexte : les infirmiers doivent pouvoir saisir les constantes, et les
-- créations de patients « entrée directe » (soins, consultation, labo, pharma)
-- doivent se synchroniser. Or csa_can_write ne l'autorisait pas → INSERT rejeté.
--
-- Changements (par rapport à 202606240001) :
--   • soins      : + 'patients', + 'constantes'
--   • labo       : + 'patients'
--   • pharmacie  : + 'patients'
-- Le reste est conservé À L'IDENTIQUE (chef MFA, sevci, pharma lots/mvt/inv).
--
-- ⚠️ À exécuter dans le SQL Editor. Lecture (csa_can_read) déjà OK pour soins.
-- ════════════════════════════════════════════════════════

begin;

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
        (p.is_chef and public.csa_chief_has_aal2())
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes','transactions','audit_logs'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes','transactions','audit_logs'))
        or ('soins' = any(p.permissions) and target_table in ('patients','constantes','soins','observations','transactions','audit_logs'))
        or ('labo' = any(p.permissions) and target_table in ('patients','labo_actes','transactions','audit_logs'))
        or ('pharmacie' = any(p.permissions) and target_table in ('patients','pharma_ventes','pharma_stock','pharma_lots','pharma_mouvements','pharma_inventaires','transactions','audit_logs'))
        or ('compta' = any(p.permissions) and target_table in ('clotures','audit_logs'))
        or (public.csa_has_aal2() and 'sevci_med' = any(p.permissions) and target_table in ('sevci_actions','audit_logs'))
        or (public.csa_has_aal2() and 'sevci_data' = any(p.permissions) and target_table in ('sevci_pvvih','sevci_actions','audit_logs'))
        or (public.csa_has_aal2() and 'sevci_sup' = any(p.permissions) and target_table in ('sevci_pvvih','sevci_actions','audit_logs'))
      )
  )
$$;

commit;

-- Vérification (doit renvoyer ok=true) :
--   select pg_get_functiondef('public.csa_can_write(text)'::regprocedure) like '%''soins'' = any(p.permissions) and target_table in (''patients'',''constantes''%' as ok;
