-- ════════════════════════════════════════════════════════
-- Tests pgTAP — validation serveur des payloads (Phase 2.1/2.2)
-- Couvre la fonction de trigger public.csa_validate_event :
--   • bornes constantes (T°, SpO2, poids, taille, pouls)
--   • montant/total négatif interdits (transactions/soins/labo/ventes)
--   • stock négatif interdit (pharma_stock)
--   • payload non-objet rejeté
-- + gardes en amont de public.csa_commit testables sans session auth.
--
-- ISOLATION : on n'écrit PAS dans csa_events. La fonction de validation ne
-- lit que NEW.table_name / NEW.payload, donc on l'attache à une table TEMP
-- jetable -> aucune RLS, aucun autre trigger, aucune donnée réelle touchée.
-- Toute la session tourne dans une transaction terminée par ROLLBACK.
--
-- COMMENT EXÉCUTER (le mieux : psql ou supabase CLI, qui montrent chaque ligne) :
--   psql "$DATABASE_URL" -f supabase/tests/test_validate_event.sql
--   # ou : supabase db query < supabase/tests/test_validate_event.sql
-- Dans le SQL Editor Supabase (un seul resultset affiché = le dernier SELECT) :
--   exécuter le fichier ; finish() liste les éventuels échecs + le bilan.
-- Pré-requis une fois : l'extension pgTAP (create extension ci-dessous).
-- Résultat attendu : « ok » sur les 29 assertions, 0 « not ok ».
-- ════════════════════════════════════════════════════════

create extension if not exists pgtap;

begin;
select plan(29);

-- ── Harnais : la vraie fonction de validation, attachée à une table temp ──
create temp table _v (table_name text, payload jsonb) on commit drop;
create trigger _v_validate before insert on _v
  for each row execute function public.csa_validate_event();

-- Les fonctions existent (détecte un déploiement incomplet) ----------------
select has_function('public', 'csa_validate_event', 'csa_validate_event présente');
select has_function('public', 'csa_commit', ARRAY['jsonb']::name[], 'csa_commit(jsonb) présente');

-- ── Constantes : températures ──────────────────────────────────────────────
select lives_ok($$ insert into _v values('constantes','{"temperature":"37"}') $$,        'T° 37 acceptée (dans 25-45)');
select throws_ok($$ insert into _v values('constantes','{"temperature":"50"}') $$, 'P0001', NULL, 'T° 50 rejetée (>45)');
select throws_ok($$ insert into _v values('constantes','{"temperature":"20"}') $$, 'P0001', NULL, 'T° 20 rejetée (<25, borne basse conservatrice)');
select lives_ok($$ insert into _v values('constantes','{"temperature":"0"}') $$,          'T° 0 acceptée (v>0 faux -> non validée)');
select lives_ok($$ insert into _v values('constantes','{"temperature":""}') $$,           'T° vide acceptée (champ non renseigné)');
select lives_ok($$ insert into _v values('constantes','{"temperature":"36,5"}') $$,       'T° "36,5" virgule passe (format non numérique -> non validé)');

-- ── Constantes : SpO2 / poids / taille / pouls ─────────────────────────────
select lives_ok($$ insert into _v values('constantes','{"spo2":"98"}') $$,                'SpO2 98 acceptée');
select throws_ok($$ insert into _v values('constantes','{"spo2":"150"}') $$, 'P0001', NULL,'SpO2 150 rejetée (>100)');
select lives_ok($$ insert into _v values('constantes','{"spo2":"100"}') $$,               'SpO2 100 acceptée (borne incluse)');
select lives_ok($$ insert into _v values('constantes','{"poids":"70"}') $$,               'Poids 70 accepté');
select throws_ok($$ insert into _v values('constantes','{"poids":"700"}') $$, 'P0001', NULL,'Poids 700 rejeté (>600)');
select lives_ok($$ insert into _v values('constantes','{"taille":"175"}') $$,             'Taille 175 acceptée');
select throws_ok($$ insert into _v values('constantes','{"taille":"350"}') $$, 'P0001', NULL,'Taille 350 rejetée (>300)');
select lives_ok($$ insert into _v values('constantes','{"pouls":"80"}') $$,               'Pouls 80 accepté');
select throws_ok($$ insert into _v values('constantes','{"pouls":"500"}') $$, 'P0001', NULL,'Pouls 500 rejeté (>400)');

-- ── Montant / total négatif interdits ──────────────────────────────────────
select lives_ok($$ insert into _v values('transactions','{"montant":"100"}') $$,          'Montant 100 accepté');
select throws_ok($$ insert into _v values('transactions','{"montant":"-5"}') $$, 'P0001', NULL,'Montant -5 rejeté (négatif)');
select throws_ok($$ insert into _v values('transactions','{"total":"-1"}') $$, 'P0001', NULL,'Total -1 rejeté (négatif)');
select throws_ok($$ insert into _v values('pharma_ventes','{"montant":"-3"}') $$, 'P0001', NULL,'Vente montant -3 rejeté (négatif)');

-- ── Stock pharmacie jamais négatif (garde-fou 0ba285d) ─────────────────────
select throws_ok($$ insert into _v values('pharma_stock','{"stock":"-1"}') $$, 'P0001', NULL,'Stock -1 rejeté (négatif interdit)');
select lives_ok($$ insert into _v values('pharma_stock','{"stock":"0"}') $$,              'Stock 0 accepté (rupture autorisée)');
select lives_ok($$ insert into _v values('pharma_stock','{"stock":"5"}') $$,              'Stock 5 accepté');

-- ── Payload doit être un objet JSON ────────────────────────────────────────
select throws_ok($$ insert into _v values('soins','[]'::jsonb) $$, 'P0001', NULL,         'Payload tableau rejeté (objet requis)');
select throws_ok($$ insert into _v values('soins','null'::jsonb) $$, 'P0001', NULL,       'Payload JSON null rejeté (objet requis)');
select throws_ok($$ insert into _v values('soins','"x"'::jsonb) $$, 'P0001', NULL,        'Payload chaîne rejeté (objet requis)');

-- ── csa_commit : gardes en amont (testables sans session auth) ─────────────
-- ordre voulu : (1) events doit être un tableau, AVANT la recherche de profil.
select throws_ok($$ select public.csa_commit('{}'::jsonb) $$, 'P0001', NULL,              'csa_commit rejette un non-tableau');
-- tableau valide mais pas de session -> profil introuvable (la fonction existe).
select throws_ok($$ select public.csa_commit('[]'::jsonb) $$, 'P0001', NULL,              'csa_commit exige un profil (aucune session = refus)');

select * from finish();
rollback;
