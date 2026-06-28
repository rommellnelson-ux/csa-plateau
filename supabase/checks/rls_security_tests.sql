-- ════════════════════════════════════════════════════════
-- Tests d'anti-usurpation RLS (Phase 1.2 / plan §4.4)
-- À exécuter dans le SQL Editor. 100% sans effet : chaque test est dans une
-- transaction terminée par ROLLBACK (rien n'est écrit).
--
-- AVANT : remplace les 2 valeurs ci-dessous par un VRAI agent existant :
--   :UUID_A  = user_id (auth.users.id) d'un agent (ex. un infirmier)
--   :CODE_A  = son agent_code dans csa_profiles (ex. 'INF1')
-- On simule sa session via `set local role authenticated` + jwt claims.
-- (Dans l'éditeur, l'exécution se fait en tant qu'owner → RLS ignorée ; le
--  `set local role authenticated` rétablit l'application du RLS.)
--
-- Lecture du résultat : chaque bloc indique le résultat ATTENDU.
-- ════════════════════════════════════════════════════════

-- ── T1. Lecture anonyme : doit échouer (permission denied / 0 ligne) ──
begin;
  set local role anon;
  select count(*) as lignes_visibles_anon from public.csa_events;  -- attendu: erreur ou 0
rollback;

-- ── T2. (Contrôle positif) l'agent écrit SON propre événement : doit RÉUSSIR ──
-- Remplace 'soins' par une table que CODE_A a le droit d'écrire selon son rôle.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"UUID_A","role":"authenticated","aal":"aal1"}';
  insert into public.csa_events (event_key, table_name, item_id, payload, agent_id)
  values ('soins:test-rls-positif', 'soins', 'test-rls-positif',
          '{"id":"test-rls-positif","agent_id":"CODE_A"}'::jsonb, 'CODE_A');  -- attendu: OK (1 ligne)
rollback;

-- ── T3. Usurpation d'identité : écrire au nom d'un AUTRE agent : doit ÉCHOUER ──
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"UUID_A","role":"authenticated","aal":"aal1"}';
  insert into public.csa_events (event_key, table_name, item_id, payload, agent_id)
  values ('soins:test-rls-usurp', 'soins', 'test-rls-usurp',
          '{"id":"test-rls-usurp","agent_id":"CODE_AUTRE"}'::jsonb, 'CODE_AUTRE');  -- attendu: ERREUR RLS
rollback;

-- ── T4. Écriture hors permissions : un soignant écrit une clôture compta : doit ÉCHOUER ──
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"UUID_A","role":"authenticated","aal":"aal1"}';
  insert into public.csa_events (event_key, table_name, item_id, payload, agent_id)
  values ('clotures:test-rls', 'clotures', 'test-rls',
          '{"id":"test-rls","agent_id":"CODE_A"}'::jsonb, 'CODE_A');  -- attendu: ERREUR RLS
rollback;

-- ── T5. Données PVVIH sans MFA (aal1) : doit ÉCHOUER même pour un rôle sevci ──
-- (Remplace UUID_A/CODE_A par un agent sevci pour un test pertinent.)
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"UUID_A","role":"authenticated","aal":"aal1"}';
  insert into public.csa_events (event_key, table_name, item_id, payload, agent_id)
  values ('sevci_pvvih:test-rls', 'sevci_pvvih', 'test-rls',
          '{"id":"test-rls","agent_id":"CODE_A"}'::jsonb, 'CODE_A');  -- attendu: ERREUR RLS (aal1)
rollback;

-- ── T6. Insertion anonyme : doit ÉCHOUER ──
begin;
  set local role anon;
  insert into public.csa_events (event_key, table_name, item_id, payload, agent_id)
  values ('patients:test-anon', 'patients', 'test-anon', '{}'::jsonb, 'X');  -- attendu: ERREUR
rollback;

-- Résultat global attendu : T2 réussit ; T1/T3/T4/T5/T6 échouent (RLS).
-- Si l'un des tests « doit échouer » réussit, c'est une faille à corriger.
