# Chantier de durcissement sécurité — plan par étapes testées

Objectif : pouvoir activer un **CSP strict** et envisager le **chiffrement au repos**,
sans jamais casser l'app en production. Chaque étape est validée (`tests.html`
+ aperçu navigateur) et poussée séparément, réversible par `git revert`.

## Volet A — CSP (Content-Security-Policy)

Le CSP strict est aujourd'hui impossible car **tout le JS est inline** (un gros
`<script>` + ~118 gestionnaires `onclick`/`onchange`/`oninput`). Étapes :

- **A1 — Externaliser le script** : déplacer le contenu du `<script>` final dans
  `app.js`, chargé par `<script src="app.js"></script>` en fin de `body`.
  Les fonctions restent globales → les `onclick` continuent de marcher.
  ⚠️ Mettre à jour `sw.js` pour servir `app.js` en **réseau d'abord** (sinon les
  MAJ du JS ne se propageraient plus, comme le bug index.html de juin).
  *Risque : faible (déplacement à comportement identique). Validation : tests + vues.*

- **A2 — Supprimer les gestionnaires inline** : remplacer les ~118 `onclick=...`
  par une délégation d'événements (`data-action` + un seul `addEventListener`).
  À faire **module par module** (accueil, soins, labo, pharma, compta, chef, sevci),
  un commit validé par module. *Risque : moyen, c'est l'étape la plus longue.*

- **A3 — Activer le CSP** : une fois A1+A2 faits, ajouter
  `Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://wsnehnempnexzxzuklbv.supabase.co`.
  (On garde `'unsafe-inline'` pour les **styles** seulement.) Tester chaque rôle.

## Volet B — Chiffrement au repos (à évaluer, probablement différé)

`DB.get/set` sont **synchrones** et utilisés partout ; Web Crypto est **asynchrone**.
Un vrai chiffrement imposerait de réécrire toute la couche données + migrer
l'existant → risque élevé de perte de données. Options réalistes :

- **B1 (recommandé d'abord)** : protections non‑applicatives — chiffrement disque
  des postes, verrouillage de session OS, et **purge localStorage au logout**
  (déjà en place). Le RLS serveur reste la vraie barrière de confidentialité.
- **B2 (si exigé)** : chiffrer le **blob localStorage** au repos via une clé
  dérivée de la session, déchiffré en mémoire au démarrage. Complexe ; à
  prototyper hors production d'abord.

## Séquencement recommandé

1. **Résoudre d'abord le problème de visibilité du médecin‑chef** (journal d'audit
   vide) — c'est un incident de production, prioritaire sur ce chantier.
2. Puis A1 (externalisation) → valider → pousser.
3. Puis A2 par module → valider chacun.
4. Puis A3 (activer CSP) → tester tous les rôles.
5. Évaluer B1/B2 selon le besoin de conformité.

Chaque étape : `tests.html` doit rester **TESTS_PASS**, et un test manuel par
rôle concerné avant de passer à la suivante.
