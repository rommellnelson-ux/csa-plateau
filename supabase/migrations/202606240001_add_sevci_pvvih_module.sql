-- ════════════════════════════════════════════════════════
-- Module SEVCI / PVVIH — intégration RLS
-- Migration : 202606240001
--
-- IMPORTANT : ce projet est event-sourced. Toutes les données métier
-- transitent par public.csa_events (colonne table_name + payload), et NON
-- par des tables dédiées. Il n'existe pas de table public.patients.
-- Cette migration n'ajoute donc AUCUNE table : elle accorde au rôle
-- « sevci » l'accès en lecture/écriture à de nouveaux table_name PVVIH,
-- exactement comme les rôles existants (soins, labo, pharmacie…).
--
-- Nouveaux table_name introduits :
--   • sevci_pvvih  — dossiers de suivi PVVIH (file active, CV, IIT, IVSA)
--   • sevci_staff  — personnels SEV-CI
--
-- ⚠️ NON TESTÉ en base. À exécuter dans un projet de staging et à vérifier
--    (notamment l'isolation RLS) AVANT toute exécution en production.
-- ════════════════════════════════════════════════════════

begin;

-- Recrée csa_can_read en conservant à l'identique les branches existantes
-- (cf. 202606120003_require_chief_mfa.sql) et en ajoutant le rôle « sevci ».
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
        (p.is_chef and public.csa_chief_has_aal2())
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes'))
        or ('soins' = any(p.permissions) and target_table in ('patients','consultations','constantes','soins','observations'))
        or ('labo' = any(p.permissions) and target_table in ('patients','consultations','labo_actes'))
        or ('pharmacie' = any(p.permissions) and target_table in ('patients','consultations','pharma_ventes','pharma_stock'))
        or ('compta' = any(p.permissions) and target_table in ('transactions','clotures','audit_logs'))
        or ('sevci' = any(p.permissions) and target_table in ('patients','consultations','sevci_pvvih','sevci_staff'))
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
        (p.is_chef and public.csa_chief_has_aal2())
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes','transactions','audit_logs'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes','transactions','audit_logs'))
        or ('soins' = any(p.permissions) and target_table in ('soins','observations','transactions','audit_logs'))
        or ('labo' = any(p.permissions) and target_table in ('labo_actes','transactions','audit_logs'))
        or ('pharmacie' = any(p.permissions) and target_table in ('pharma_ventes','pharma_stock','transactions','audit_logs'))
        or ('compta' = any(p.permissions) and target_table in ('clotures','audit_logs'))
        or ('sevci' = any(p.permissions) and target_table in ('sevci_pvvih','sevci_staff','audit_logs'))
      )
  )
$$;

commit;

-- ════════════════════════════════════════════════════════
-- Attribution du rôle « sevci » à un agent (à adapter) :
--
--   update public.csa_profiles
--   set permissions = array_append(permissions, 'sevci')
--   where agent_code = 'CODE_AGENT_SEVCI';
--
-- Vérification d'isolation (doit renvoyer QUE les données autorisées) :
--   select public.csa_can_read('sevci_pvvih');   -- true pour un agent sevci
--   select public.csa_can_read('pharma_stock');  -- false pour un agent sevci seul
--
-- Remarque sécurité : les données PVVIH sont particulièrement sensibles.
-- Envisager d'exiger une session aal2 (MFA) pour le rôle sevci, sur le
-- modèle de csa_chief_has_aal2(), avant la mise en production.
-- ════════════════════════════════════════════════════════
