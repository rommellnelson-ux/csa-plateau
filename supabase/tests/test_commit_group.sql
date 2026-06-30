-- ════════════════════════════════════════════════════════
-- Tests pgTAP — commit atomique de groupe csa_commit (Phase 2.2)
-- Vérifie les GARDES de sécurité de la RPC public.csa_commit, qui re-contrôle
-- les droits côté serveur (la fonction est SECURITY DEFINER -> court-circuite la
-- RLS, donc elle doit re-vérifier) :
--   • une table MUTABLE (patients/observations/pharma_stock/lots/inventaires/
--     sevci_pvvih) ne peut PAS entrer dans un commit de groupe ;
--   • l'agent_id de chaque event doit = l'agent_code du profil (anti-usurpation) ;
--   • un groupe contenant UN seul élément invalide est rejeté EN ENTIER
--     (atomicité tout-ou-rien : une fonction plpgsql qui lève annule tous ses
--      inserts — garantie transactionnelle Postgres ; si csa_commit ignorait
--      l'élément fautif et committait le reste, il NE lèverait PAS, et le test
--      ci-dessous échouerait).
--
-- SÉCURITÉ : tous les cas testés ici LÈVENT une exception AVANT le moindre
-- insert -> AUCUNE écriture ne persiste dans csa_events. Sûr à lancer sur prod.
-- (Le happy-path « commit réussi » et l'idempotence écrivent réellement -> à
--  tester via psql dans une transaction `begin; … rollback;`, pas ici.)
--
-- AVANT DE LANCER — un SEUL placeholder à remplacer (l'agent_code est dérivé
-- automatiquement du profil via auth.uid()) :
--   REMPLACER_UUID_CHEF -> le user_id de TON compte Médecin-Chef (uuid).
--   Le récupérer :  select user_id from public.csa_profiles where is_chef;
--
-- COMMENT EXÉCUTER : SQL Editor Supabase -> coller tout le fichier -> Run.
-- Attendu : 4 lignes, toutes « ok ». Un « not ok » = garde serveur défaillante.
-- ════════════════════════════════════════════════════════

create extension if not exists pgtap;

-- Simule la session du chef : auth.uid() lira ce 'sub'. L'« aal:aal2 » simule la
-- connexion MFA du chef -> csa_chief_has_aal2() vrai -> csa_can_write l'autorise
-- (la branche chef = is_chef AND aal2 ; sans aal2 le chef est traité comme aal1
--  et n'écrit rien — c'est voulu). Session-level (false) pour persister jusqu'au
-- SELECT final. (Ouvre un nouvel onglet de requête ensuite pour repartir propre.)
select set_config('request.jwt.claims', '{"sub":"REMPLACER_UUID_CHEF","role":"authenticated","aal":"aal2"}', false);

select no_plan();

-- Tous les résultats dans un seul tableau (chaque ligne « ok » / « not ok »).
-- throws_like vérifie le MESSAGE (pas juste « une erreur ») -> garantit que c'est
-- la BONNE garde qui lève, et rend un placeholder non remplacé évident (le
-- message serait « invalid input syntax for type uuid »).
select * from has_function('public', 'csa_commit', ARRAY['jsonb']::name[], 'csa_commit(jsonb) présente')

-- Garde 1 : une table MUTABLE est refusée dans un groupe. (agent_id sans
-- importance ici : la garde « mutable » lève AVANT le contrôle d'agent_id.)
union all select * from throws_like(
  $$ select public.csa_commit('[{"event_key":"pgtap-mut:1","table_name":"patients","item_id":"1","agent_id":"X","payload":{"id":"1"}}]'::jsonb) $$,
  '%mutable%', 'csa_commit refuse une table mutable (patients) dans un groupe')

-- Garde 2 : agent_id usurpé (≠ agent_code du profil) est refusé.
-- Table 'audit_logs' : écrivable par TOUS les rôles (présente dans chaque branche
-- de csa_can_write) -> la garde can_write passe quel que soit le profil, et c'est
-- bien le contrôle d'agent_id qui doit lever.
union all select * from throws_like(
  $$ select public.csa_commit('[{"event_key":"pgtap-usurp:1","table_name":"audit_logs","item_id":"1","agent_id":"AGENT_BIDON","payload":{"id":"1"}}]'::jsonb) $$,
  '%usurp%', 'csa_commit refuse un agent_id usurpé')

-- Garde 3 (atomicité) : un groupe [élément valide, élément mutable] est rejeté
-- EN ENTIER. L'agent_id du 1er élément est dérivé du profil (sous-requête) ->
-- il passe les contrôles, est inséré, PUIS le 2e élément (mutable) lève -> tout
-- est annulé. (Construit via jsonb_build_* pour injecter l'agent_code réel.)
union all select * from throws_like(
  $$ select public.csa_commit( jsonb_build_array(
       jsonb_build_object('event_key','pgtap-atom:1','table_name','audit_logs','item_id','1',
         'agent_id',(select agent_code from public.csa_profiles where user_id = auth.uid()),
         'agent_nom','Test','payload', jsonb_build_object('id','1')),
       jsonb_build_object('event_key','pgtap-atom:2','table_name','patients','item_id','2',
         'agent_id',(select agent_code from public.csa_profiles where user_id = auth.uid()),
         'payload', jsonb_build_object('id','2'))
     ) ) $$,
  '%mutable%', 'csa_commit rejette TOUT le groupe si un élément est invalide (tout-ou-rien)');
