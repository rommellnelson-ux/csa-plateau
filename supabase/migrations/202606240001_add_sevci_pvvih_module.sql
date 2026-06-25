-- ════════════════════════════════════════════════════════
-- Module SEVCI / PVVIH — intégration RLS
-- Migration : 202606240001
--
-- IMPORTANT : ce projet est event-sourced. Toutes les données métier
-- transitent par public.csa_events (colonne table_name + payload), et NON
-- par des tables dédiées. Il n'existe pas de table public.patients.
-- Cette migration n'ajoute donc AUCUNE table : elle accorde aux 3 rôles
-- SEV-CI l'accès en lecture/écriture à de nouveaux table_name PVVIH,
-- exactement comme les rôles existants (soins, labo, pharmacie…).
--
-- 3 rôles (= permissions dans csa_profiles.permissions) :
--   • sevci_med   — médiatrice communautaire : écrit sevci_actions
--   • sevci_data  — moniteur de données      : écrit sevci_pvvih (+ CV)
--   • sevci_sup   — superviseur              : lecture + corrections + DSASA
--   Le médecin-chef (is_chef + aal2) voit la synthèse de tous.
--
-- Nouveaux table_name introduits :
--   • sevci_pvvih   — dossiers de suivi PVVIH (file active, CV, IIT, IVSA)
--   • sevci_actions — actions communautaires (visites, PDV, rappels…)
--
-- ⚠️ NON TESTÉ en base. À exécuter dans un projet de staging et à vérifier
--    (notamment l'isolation RLS) AVANT toute exécution en production.
-- ════════════════════════════════════════════════════════

begin;

-- Autoriser le module 'sevci' (la contrainte d'origine ne listait pas ce module).
alter table public.csa_profiles drop constraint if exists csa_profiles_module_check;
alter table public.csa_profiles add constraint csa_profiles_module_check
  check (module in ('accueil','soins','labo','pharmacie','compta','chef','sevci'));

-- Autoriser les permissions sevci (la contrainte d'origine ne les listait pas).
alter table public.csa_profiles drop constraint if exists csa_profiles_permissions_check;
alter table public.csa_profiles add constraint csa_profiles_permissions_check
  check (
    permissions <@ array['accueil','as','soins','labo','pharmacie','compta','chef','sevci_med','sevci_data','sevci_sup']::text[]
    and cardinality(permissions) > 0
  );

-- MFA générique : vrai si la session courante est de niveau aal2.
-- Les données PVVIH exigent une session MFA, comme le médecin-chef.
create or replace function public.csa_has_aal2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
$$;

-- Recrée csa_can_read/write en reprenant À L'IDENTIQUE l'état le plus récent
-- (read = 202606130007, write = 202606120005, incl. accès pharmacie aux
-- lots/mouvements/inventaires) et en ajoutant les 3 rôles « sevci ».
-- ⚠️ Si d'autres migrations ont modifié ces fonctions depuis, re-synchroniser
--    ces deux corps AVANT d'exécuter, sinon on régresse les accès existants.
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
        or ('pharmacie' = any(p.permissions) and target_table in (
          'patients','consultations','pharma_ventes','pharma_stock',
          'pharma_lots','pharma_mouvements','pharma_inventaires'
        ))
        or ('compta' = any(p.permissions) and target_table in ('transactions','clotures','audit_logs'))
        or (public.csa_has_aal2() and p.permissions && array['sevci_med','sevci_data','sevci_sup'] and target_table in ('sevci_pvvih','sevci_actions'))
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
        or ('pharmacie' = any(p.permissions) and target_table in (
          'pharma_ventes','pharma_stock','pharma_lots','pharma_mouvements',
          'pharma_inventaires','transactions','audit_logs'
        ))
        or ('compta' = any(p.permissions) and target_table in ('clotures','audit_logs'))
        or (public.csa_has_aal2() and 'sevci_med' = any(p.permissions) and target_table in ('sevci_actions','audit_logs'))
        or (public.csa_has_aal2() and 'sevci_data' = any(p.permissions) and target_table in ('sevci_pvvih','sevci_actions','audit_logs'))
        or (public.csa_has_aal2() and 'sevci_sup' = any(p.permissions) and target_table in ('sevci_pvvih','sevci_actions','audit_logs'))
      )
  )
$$;

revoke all on function public.csa_has_aal2() from public;
grant execute on function public.csa_has_aal2() to authenticated;

-- sevci_pvvih doit être modifiable (édition de dossier + enregistrement des
-- charges virales mettent à jour l'enregistrement). La policy UPDATE n'autorise
-- sinon que patients/observations/pharma_*. On la recrée en ajoutant sevci_pvvih.
-- (sevci_actions reste en insertion seule.)
drop policy if exists "events_update_by_role" on public.csa_events;
create policy "events_update_by_role"
on public.csa_events
for update
to authenticated
using (
  public.csa_can_write(table_name)
  and table_name in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires','sevci_pvvih')
)
with check (
  public.csa_can_write(table_name)
  and table_name in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires','sevci_pvvih')
  and created_by = auth.uid()
  and coalesce(payload->>'agent_id', '') = (
    select p.agent_code from public.csa_profiles p
    where p.user_id = auth.uid() and p.active
  )
);

commit;

-- ════════════════════════════════════════════════════════
-- Création des 3 profils SEV-CI (après avoir créé les utilisateurs dans
-- Authentication > Users). module = 'sevci' (gate de connexion), et la
-- permission précise le rôle :
--
--   insert into public.csa_profiles
--     (user_id, agent_code, display_name, job_title, module, permissions, is_chef)
--   values
--     ('UUID_AUTH_1','SEVCI-MED','Médiatrice communautaire','Médiatrice communautaire SEV-CI','sevci', array['sevci_med'],  false),
--     ('UUID_AUTH_2','SEVCI-DAT','Moniteur de données',     'Moniteur de données SEV-CI',     'sevci', array['sevci_data'], false),
--     ('UUID_AUTH_3','SEVCI-SUP','Superviseur',             'Superviseur SEV-CI',             'sevci', array['sevci_sup'],  false);
--
-- Vérification d'isolation (doit renvoyer QUE les données autorisées) :
--   select public.csa_can_read('sevci_pvvih');   -- true pour un agent sevci
--   select public.csa_can_read('pharma_stock');  -- false pour un agent sevci seul
--
-- Remarque sécurité : les données PVVIH sont particulièrement sensibles.
-- Envisager d'exiger une session aal2 (MFA) pour les rôles sevci, sur le
-- modèle de csa_chief_has_aal2(), avant la mise en production.
-- ════════════════════════════════════════════════════════
