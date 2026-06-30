-- ════════════════════════════════════════════════════════
-- Tests pgTAP — validation serveur des payloads (Phase 2.1/2.2)
-- Couvre la fonction de trigger public.csa_validate_event :
--   • bornes constantes (T°, SpO2, poids, taille, pouls)
--   • montant/total négatif interdits (transactions/soins/labo/ventes)
--   • stock négatif interdit (pharma_stock)
--   • payload non-objet rejeté
-- + gardes en amont de public.csa_commit testables sans session auth.
--
-- ISOLATION : on n'écrit PAS dans csa_events. La fonction de validation ne lit
-- que NEW.table_name / NEW.payload, donc on l'attache à une table TEMP jetable
-- -> aucune RLS, aucun autre trigger, aucune donnée réelle touchée.
--
-- COMMENT EXÉCUTER :
--   • SQL Editor Supabase : COLLER TOUT CE FICHIER puis « Run ». Le dernier
--     SELECT renvoie un tableau d'une colonne où chaque ligne commence par
--     « ok » (réussi) ou « not ok » (échec). Attendu : 29 lignes, toutes « ok ».
--     ⚠ Coller le CONTENU du fichier, PAS la commande « psql … » (qui est une
--       commande terminal, pas du SQL).
--   • Terminal : psql "$DATABASE_URL" -f supabase/tests/test_validate_event.sql
-- Pré-requis (une fois) : l'extension pgTAP, créée juste en dessous.
-- ════════════════════════════════════════════════════════

create extension if not exists pgtap;

-- Harnais : la vraie fonction de validation, attachée à une table temp jetable.
-- (drop préalable : une connexion Supabase poolée peut garder un _v d'un run
--  précédent -> sinon « relation _v already exists ».)
drop table if exists _v cascade;
create temp table _v (table_name text, payload jsonb);
create trigger _v_validate before insert on _v
  for each row execute function public.csa_validate_event();

-- Tous les résultats dans UN seul tableau (lisible dans le SQL Editor) :
select * from has_function('public', 'csa_validate_event', 'csa_validate_event présente')
union all select * from has_function('public', 'csa_commit', ARRAY['jsonb']::name[], 'csa_commit(jsonb) présente')

-- Constantes : températures
union all select * from lives_ok($$ insert into _v values('constantes','{"temperature":"37"}') $$,        'T 37 acceptee (dans 25-45)')
union all select * from throws_ok($$ insert into _v values('constantes','{"temperature":"50"}') $$, 'P0001', NULL, 'T 50 rejetee (>45)')
union all select * from throws_ok($$ insert into _v values('constantes','{"temperature":"20"}') $$, 'P0001', NULL, 'T 20 rejetee (<25, borne basse conservatrice)')
union all select * from lives_ok($$ insert into _v values('constantes','{"temperature":"0"}') $$,          'T 0 acceptee (v>0 faux -> non validee)')
union all select * from lives_ok($$ insert into _v values('constantes','{"temperature":""}') $$,           'T vide acceptee (champ non renseigne)')
union all select * from lives_ok($$ insert into _v values('constantes','{"temperature":"36,5"}') $$,       'T "36,5" virgule passe (format non numerique -> non valide)')

-- Constantes : SpO2 / poids / taille / pouls
union all select * from lives_ok($$ insert into _v values('constantes','{"spo2":"98"}') $$,                'SpO2 98 acceptee')
union all select * from throws_ok($$ insert into _v values('constantes','{"spo2":"150"}') $$, 'P0001', NULL,'SpO2 150 rejetee (>100)')
union all select * from lives_ok($$ insert into _v values('constantes','{"spo2":"100"}') $$,               'SpO2 100 acceptee (borne incluse)')
union all select * from lives_ok($$ insert into _v values('constantes','{"poids":"70"}') $$,               'Poids 70 accepte')
union all select * from throws_ok($$ insert into _v values('constantes','{"poids":"700"}') $$, 'P0001', NULL,'Poids 700 rejete (>600)')
union all select * from lives_ok($$ insert into _v values('constantes','{"taille":"175"}') $$,             'Taille 175 acceptee')
union all select * from throws_ok($$ insert into _v values('constantes','{"taille":"350"}') $$, 'P0001', NULL,'Taille 350 rejetee (>300)')
union all select * from lives_ok($$ insert into _v values('constantes','{"pouls":"80"}') $$,               'Pouls 80 accepte')
union all select * from throws_ok($$ insert into _v values('constantes','{"pouls":"500"}') $$, 'P0001', NULL,'Pouls 500 rejete (>400)')

-- Montant / total négatif interdits
union all select * from lives_ok($$ insert into _v values('transactions','{"montant":"100"}') $$,          'Montant 100 accepte')
union all select * from throws_ok($$ insert into _v values('transactions','{"montant":"-5"}') $$, 'P0001', NULL,'Montant -5 rejete (negatif)')
union all select * from throws_ok($$ insert into _v values('transactions','{"total":"-1"}') $$, 'P0001', NULL,'Total -1 rejete (negatif)')
union all select * from throws_ok($$ insert into _v values('pharma_ventes','{"montant":"-3"}') $$, 'P0001', NULL,'Vente montant -3 rejete (negatif)')

-- Stock pharmacie jamais négatif (garde-fou 0ba285d)
union all select * from throws_ok($$ insert into _v values('pharma_stock','{"stock":"-1"}') $$, 'P0001', NULL,'Stock -1 rejete (negatif interdit)')
union all select * from lives_ok($$ insert into _v values('pharma_stock','{"stock":"0"}') $$,              'Stock 0 accepte (rupture autorisee)')
union all select * from lives_ok($$ insert into _v values('pharma_stock','{"stock":"5"}') $$,              'Stock 5 accepte')

-- Payload doit être un objet JSON
union all select * from throws_ok($$ insert into _v values('soins','[]'::jsonb) $$, 'P0001', NULL,         'Payload tableau rejete (objet requis)')
union all select * from throws_ok($$ insert into _v values('soins','null'::jsonb) $$, 'P0001', NULL,       'Payload JSON null rejete (objet requis)')
union all select * from throws_ok($$ insert into _v values('soins','"x"'::jsonb) $$, 'P0001', NULL,        'Payload chaine rejete (objet requis)')

-- csa_commit : gardes en amont (testables sans session auth)
union all select * from throws_ok($$ select public.csa_commit('{}'::jsonb) $$, 'P0001', NULL,              'csa_commit rejette un non-tableau')
union all select * from throws_ok($$ select public.csa_commit('[]'::jsonb) $$, 'P0001', NULL,              'csa_commit exige un profil (aucune session = refus)');

-- (Pas de DROP en fin de fichier : il faut que le SELECT ci-dessus reste la
--  DERNIÈRE instruction pour que le SQL Editor affiche bien le tableau. La table
--  temp _v est nettoyée par le « drop table if exists » en tête au prochain run
--  et disparaît à la fermeture de session.)
