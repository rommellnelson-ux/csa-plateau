# Handoff — reprise de contexte (CSA Plateau)

Document de continuité : à lire en premier au démarrage d'une nouvelle session.

## Le projet en une phrase
Application web médicale **CSA‑GR/Plateau** (centre de santé), mono‑page,
**offline‑first (PWA)**, **event‑sourced** sur Supabase, déployée sur **GitHub Pages**
depuis la branche `main` de `github.com/rommellnelson-ux/csa-plateau`.
URL en ligne : `https://rommellnelson-ux.github.io/csa-plateau/`.

## Où est le code (attention, 2 copies)
- **Source de vérité** : GitHub `main` (c'est ce qui est déployé).
- Le dossier local du user `Bureau\CSA` (= `Desktop\CSA`) peut être **en retard**.
  Pour les migrations, on **colle le SQL** dans Supabase (pas besoin du fichier local).
- Méthode de travail de l'assistant : cloner le repo dans un dossier temporaire,
  éditer, **valider en navigateur** (voir ci‑dessous), commit + push sur `main`.

## Conventions de travail (importantes)
1. **Architecture** : `index.html` = HTML+CSS (~269 l.) ; **tout le JS dans `app.js`**
   (~4339 l., script classique → fonctions globales ; `const` comme `escHtml`/`VIEW`
   ne sont **pas** sur `window`). Pas de modules `js/views/`.
2. **Valider AVANT de pousser** : servir le repo en statique (`python -m http.server`)
   via un `.claude/launch.json`, ouvrir l'aperçu, et exécuter `tests.html`
   (doit afficher titre `TESTS_PASS`, 17 assertions). Nettoyer le `launch.json` après.
3. **RLS** : avant/après toute migration touchant `csa_can_read/write`, lancer
   `supabase/checks/rls_access_matrix_report.sql` (SELECT pur — `do $$…$$` est
   tronqué par l'éditeur Supabase). Toutes les lignes `ok` doivent être `true`.
   Régression classique : recréer `csa_can_read/write` en oubliant une table
   pharmacie ou sevci (toujours repartir de la **dernière** définition).
4. **CSP** : un CSP protecteur est actif et **garde `'unsafe-inline'`/`'unsafe-eval'`**.
   Ne JAMAIS passer en CSP strict sans d'abord retirer les ~118 handlers inline
   (sinon site mort — déjà vécu). Voir `docs/SECURITY_HARDENING_PLAN.md`.
5. **PWA** : `sw.js` est en **réseau‑d'abord** (same‑origin) ; les MAJ se propagent
   au rechargement. Bumper `CACHE` si on change la stratégie.
6. **Je ne peux pas** exécuter le SQL Supabase ni créer des comptes Auth — je
   fournis le SQL, le user l'exécute dans le SQL Editor / le dashboard.
7. Ne pas réintroduire le pseudo‑chiffrement base64 du localStorage (retiré).

## État actuel (juin 2026) — fait & en prod
- Sécurité : accès `anon` révoqué ; CSP protecteur ; échappement XSS ; MFA chef + sevci.
- JS externalisé (`app.js`) ; PWA réseau‑d'abord + bouton « Mettre à jour ».
- Synchro auto (30s push / 60s pull) + immédiate à l'ouverture (visibilitychange/focus).
- Création de patient : accueil, consultation, soins (entrée directe), labo, pharmacie.
- Infirmiers : onglet **Constantes** (+ RLS d'écriture élargi soins/labo/pharma → patients).
- Module **SEVCI/PVVIH** complet (3 rôles + synthèse chef, dossier **sans nom** = N° + Militaire/Civil).
- Saisie tolérante : virgule décimale + taille en cm ou mètres.
- Tests `tests.html` + CI Playwright (verts).

## Optionnel / laissé de côté (décisions assumées)
- **CSP strict** (retrait des 118 handlers inline) : optionnel, fort effort/risque.
- **Chiffrement au repos** du localStorage (Web Crypto) : écarté (faible ROI vu le RLS serveur).

## Rappels opérationnels pour le user
- Navigateur : **Chrome** (ou Edge avec « Protection contre le suivi » désactivée pour le site).
- Chaque poste : un rechargement bascule sur la dernière version.
- Médecin‑chef : doit valider le **MFA** à la connexion pour voir les données.
