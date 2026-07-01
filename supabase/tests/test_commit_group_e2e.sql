-- ════════════════════════════════════════════════════════
-- Test pgTAP end-to-end — csa_commit HAPPY PATH + idempotence (Phase 2.2)
-- Complète test_commit_group.sql (qui teste les GARDES, lesquelles lèvent AVANT
-- insert) : ici on committe un GROUPE VALIDE complet, avec de vraies écritures,
-- puis on ROLLBACK. Impossible dans le SQL Editor (le rollback masquerait le
-- resultset) -> ce fichier tourne dans un RUNNER TRANSACTIONNEL (psql / CI).
--
-- Ce qui est prouvé :
--   1. un quatuor de vente pharmacie (pharma_ventes + pharma_mouvements +
--      transactions + audit_logs) s'insère et csa_commit renvoie 4 ;
--   2. les 4 events atterrissent bien, répartis sur les 4 tables ;
--   3. IDEMPOTENCE : rejouer le même groupe (on conflict event_key do nothing)
--      n'ajoute aucun doublon.
-- L'atomicité tout-ou-rien SUR ÉCHEC est déjà couverte par test_commit_group.sql
-- (garde « groupe [valide, mutable] rejeté en entier »).
--
-- Placeholder REMPLACER_UUID_CHEF -> substitué par le runner (uuid du chef seedé).
-- Tout est annulé par le ROLLBACK final : aucune écriture ne persiste.
-- ════════════════════════════════════════════════════════

create extension if not exists pgtap;

begin;

-- Session chef MFA (aal2 obligatoire pour la branche chef de csa_can_write).
select set_config('request.jwt.claims',
  '{"sub":"REMPLACER_UUID_CHEF","role":"authenticated","aal":"aal2"}', true);

select plan(3);

-- Le groupe est construit dynamiquement pour injecter l'agent_code réel du profil.
-- (Défini une fois via un paramètre de session pour être rejoué à l'identique.)
select set_config('csa.e2e_group', (
  jsonb_build_array(
    jsonb_build_object('event_key','e2e-vente:1','table_name','pharma_ventes','item_id','1',
      'agent_id',(select agent_code from public.csa_profiles where user_id = auth.uid()),
      'agent_nom','E2E','payload', jsonb_build_object('id','1','total','1000')),
    jsonb_build_object('event_key','e2e-mvt:1','table_name','pharma_mouvements','item_id','1',
      'agent_id',(select agent_code from public.csa_profiles where user_id = auth.uid()),
      'agent_nom','E2E','payload', jsonb_build_object('id','1','med_id','M1','quantite','-2')),
    jsonb_build_object('event_key','e2e-tx:1','table_name','transactions','item_id','1',
      'agent_id',(select agent_code from public.csa_profiles where user_id = auth.uid()),
      'agent_nom','E2E','payload', jsonb_build_object('id','1','montant','1000')),
    jsonb_build_object('event_key','e2e-audit:1','table_name','audit_logs','item_id','1',
      'agent_id',(select agent_code from public.csa_profiles where user_id = auth.uid()),
      'agent_nom','E2E','payload', jsonb_build_object('id','1','action','VENTE'))
  )
)::text, true);

-- 1. csa_commit accepte le quatuor et renvoie 4.
select is(
  public.csa_commit(current_setting('csa.e2e_group')::jsonb),
  4,
  'csa_commit (happy path) insère le quatuor vente et renvoie 4'
);

-- 2. Les 4 events sont bien présents, sur 4 tables distinctes.
select is(
  (select count(distinct table_name) from public.csa_events where event_key like 'e2e-%')::int,
  4,
  'les 4 events sont insérés, répartis sur 4 tables (ventes/mouvements/transaction/audit)'
);

-- Rejoue le MÊME groupe : on conflict (event_key) do nothing.
select public.csa_commit(current_setting('csa.e2e_group')::jsonb);

-- 3. Idempotence : toujours 4 lignes, aucun doublon.
select is(
  (select count(*) from public.csa_events where event_key like 'e2e-%')::int,
  4,
  'idempotence : rejouer le groupe n''ajoute aucun doublon (on conflict do nothing)'
);

select * from finish();

rollback;
