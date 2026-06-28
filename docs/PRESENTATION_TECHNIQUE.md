# CSA Plateau — Présentation technique (pour audit / revue)

Document destiné à un développeur, un informaticien ou une IA pour **audit,
jugement et appréciation**. Volontairement honnête sur les forces **et** les
compromis assumés.

---

## 1. Objectif

Logiciel de **gestion d'un centre de santé** (CSA‑GR/Plateau) : accueil des
patients, constantes, consultations, soins infirmiers, laboratoire, pharmacie
(stock/lots/délivrance), comptabilité (caisse/clôtures), supervision du
médecin‑chef, et un module spécialisé **PVVIH** (suivi VIH, programme SEV‑CI).

Contexte : connectivité parfois instable, plusieurs postes (PC et téléphones),
plusieurs rôles d'agents. D'où des choix forts : **offline‑first** et **temps réel
différé** (synchronisation).

## 2. Pile technique

- **Front** : HTML/CSS/JavaScript **vanilla** (aucun framework). `index.html`
  (HTML + CSS) + `app.js` (toute la logique, ~4 300 lignes).
- **Librairies** (CDN) : `@supabase/supabase-js` (auth + base), `Chart.js` (graphiques).
- **Backend** : **Supabase** (PostgreSQL managé) — Auth, base, Row‑Level Security.
- **PWA** : `manifest.json` + `sw.js` (service worker, mode hors‑ligne + auto‑MAJ).
- **Hébergement** : **GitHub Pages** (site statique) déployé depuis `main`.
- **CI** : GitHub Actions (Playwright) qui exécute une suite de tests navigateur.

## 3. Architecture

### 3.1 Mono‑page, sans build
Pas de bundler, pas d'étape de compilation : le navigateur charge `index.html`
puis `app.js`. Avantage : simplicité de déploiement (push → en ligne).
Compromis : un gros fichier JS (voir §8).

### 3.2 Event‑sourced
Toutes les données métier sont stockées comme **événements** dans une unique table
PostgreSQL `csa_events` : `(event_key, table_name, item_id, payload jsonb,
created_by, agent_id, created_at, updated_at)`. Le `table_name` joue le rôle de
« type » logique (`patients`, `consultations`, `constantes`, `pharma_*`,
`sevci_pvvih`, `audit_logs`, …). **Il n'y a pas de tables métier dédiées.**
Bénéfices : journal immuable, traçabilité, schéma souple. La plupart des types
sont en **insertion seule** ; seuls quelques‑uns sont modifiables (politique
UPDATE restreinte par liste blanche).

### 3.3 Offline‑first + synchronisation
- Écriture locale immédiate dans `localStorage`, puis **file de synchronisation**.
- **Push** des changements toutes les 30 s, **pull** du cloud toutes les 60 s,
  plus une **synchro immédiate** à l'ouverture/au retour sur l'app
  (`visibilitychange`/`focus`) — important sur téléphone.
- Fusion par identifiant + horodatage ; un indicateur affiche les éléments en
  attente et permet de relancer manuellement.

### 3.4 PWA / service worker
`sw.js` sert les fichiers de l'app en **réseau‑d'abord** (toujours la dernière
version, repli sur le cache hors‑ligne) et met en cache les librairies CDN.
Un bouton « Mettre à jour » s'affiche si une nouvelle version est prête.

## 4. Sécurité

La sécurité repose **côté serveur** (le front est public, c'est assumé) :

- **Authentification** : Supabase Auth (email + mot de passe). Clé front =
  clé *publishable* (normale ; elle ne donne aucun droit sans RLS).
- **Row‑Level Security (RLS)** sur `csa_events` :
  - lecture/écriture filtrées par des fonctions `security definer`
    `csa_can_read(table_name)` / `csa_can_write(table_name)`,
  - droits portés par `csa_profiles.permissions[]` (un agent = un ou plusieurs rôles),
  - **INSERT verrouillé** : `created_by = auth.uid()` **et**
    `payload.agent_id = code de l'agent` (anti‑usurpation),
  - **UPDATE** restreint à une liste blanche de `table_name` (le reste est immuable),
  - **aucune** politique DELETE (journal inviolable).
- **MFA (TOTP, niveau `aal2`)** obligatoire pour le **médecin‑chef** et les rôles
  **SEV‑CI** (données PVVIH sensibles) ; le RLS refuse leurs données tant que la
  session n'est pas `aal2`.
- **Accès anonyme révoqué** : policies `*_anon` supprimées + `revoke` sur le rôle
  `anon`/`public` (un appel non authentifié reçoit « permission denied »).
- **Anti‑XSS** : échappement systématique (`escHtml`/`escSQ`) des données affichées.
- **CSP** (Content‑Security‑Policy) : `connect-src` limité à Supabase
  (**anti‑exfiltration**), `script-src` limité au site + 2 CDN, `object-src 'none'`,
  `base-uri`/`form-action 'self'`. (Voir §8 pour le compromis `'unsafe-inline'`.)

## 5. Rôles & modules

Permissions : `accueil`, `as` (aide‑soignant), `soins`, `labo`, `pharmacie`,
`compta`, `chef`, et `sevci_med` / `sevci_data` / `sevci_sup`.
Chaque rôle ne voit que ses onglets et n'écrit que ses tables (RLS). Le
**médecin‑chef** (MFA) a une vue consolidée (tableau de bord, dossiers, audit,
statistiques, gestion des prix, exports, synthèse PVVIH).

## 6. Module SEVCI / PVVIH (suivi VIH)

Trois profils : **médiatrice communautaire**, **moniteur de données**,
**superviseur** ; le médecin‑chef voit la **synthèse** (cascade 95‑95‑95, file
active, charges virales, IIT, IVSA, activité par agent). 
**Confidentialité renforcée** : le dossier PVVIH **ne contient jamais le nom du
patient** — uniquement un **N° de dossier** + une **catégorie (Militaire/Civil)**.

## 7. Qualité / tests

- `tests.html` : suite de tests **exécutée dans un vrai navigateur** (charge l'app
  et vérifie ~17 points : parsing, validations, échappement XSS, isolation des
  permissions, rendu de toutes les vues).
- **CI** GitHub Actions (Playwright) rejoue ces tests à chaque push.
- `supabase/checks/*.sql` : contrôles de non‑régression RLS (à exécuter après
  chaque migration).

## 8. Choix & limites assumés (pour l'auditeur)

- **Mono‑fichier JS** (`app.js`, ~4 300 lignes) : simple à déployer, mais lourd à
  maintenir. Une modularisation est envisageable mais non prioritaire.
- **CSP non « strict »** : conserve `'unsafe-inline'`/`'unsafe-eval'` car l'app
  utilise ~118 gestionnaires d'événements *inline* (`onclick`…). Le CSP actuel
  protège quand même contre l'exfiltration et les scripts externes. Un CSP strict
  exigerait de retirer tous les handlers inline (gros refactor, gain marginal).
- **Pas de chiffrement applicatif du `localStorage`** : décision assumée — un
  pseudo‑chiffrement base64 avait été tenté puis retiré (inutile). La
  confidentialité repose sur le **RLS serveur** + la sécurité du poste (session
  OS, disque chiffré). Le `localStorage` est purgé à la déconnexion.
- **Plafond local** de 3 000 enregistrements par type (le cloud reste la référence).
- **Dépendances via CDN** (pas de SRI/pinning fort) : à considérer si exigence élevée.
- **Pré‑requis navigateur** : le stockage local doit être autorisé (un garde‑fou
  prévient l'utilisateur si le navigateur le bloque, ex. Edge « Protection contre
  le suivi »).

## 9. Points qu'un audit voudra probablement vérifier

1. Les **policies RLS** réellement en base (vs le code) — fournir l'export de
   `pg_policies` + `pg_get_functiondef('csa_can_read/write')`.
2. La robustesse de l'**anti‑usurpation** sur INSERT/UPDATE.
3. La gestion des **conflits de synchronisation** (dernier écrivain gagne par horodatage).
4. La **confidentialité PVVIH** (aucune donnée nominative).
5. L'exposition CDN et l'absence de SRI.

---

*Honnêteté de la démarche : ce document liste sciemment les compromis. L'objectif
est une appréciation juste, pas une vitrine.*
