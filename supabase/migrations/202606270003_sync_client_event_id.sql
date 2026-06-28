-- ════════════════════════════════════════════════════════
-- Synchronisation idempotente — identifiant d'événement client
-- Migration : 202606270003  (Phase 1.1 du plan de consolidation)
--
-- Ajoute client_event_id : un identifiant unique généré par l'appareil pour
-- CHAQUE événement de synchro. Une contrainte unique garantit qu'un même
-- événement renvoyé deux fois (retry réseau, reprise après crash) n'est
-- enregistré qu'une seule fois — y compris pour les types en insertion pure
-- (ex. pharma_mouvements), en complément de l'unicité déjà assurée par
-- event_key (table:id).
--
-- Sans danger : colonne nullable + index unique PARTIEL (where not null), donc
-- les lignes existantes (client_event_id null) ne sont pas affectées.
-- ════════════════════════════════════════════════════════

begin;

alter table public.csa_events
  add column if not exists client_event_id uuid;

create unique index if not exists csa_events_client_event_id_key
  on public.csa_events (client_event_id)
  where client_event_id is not null;

commit;
