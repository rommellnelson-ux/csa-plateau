# Tests end-to-end MFA (Playwright)

Harnais **indépendant** du navigateur, sans compte distant ni URL de production.
Le bundle Supabase du CDN est remplacé à la volée par `stub.js`, un client simulé :
aucun appel réseau réel n'est émis vers Supabase.

## Exécution

```bash
# 1. dépendances épinglées (depuis package-lock.json) + Chromium
cd tests/e2e && npm ci && npx playwright install chromium

# 2. servir le dépôt en statique (depuis la RACINE du dépôt)
python -m http.server 8769 --bind 127.0.0.1
# copie pour les tests service worker (qui réécrivent la constante CACHE) :
mkdir -p tests/e2e/site && cp index.html app.js sw.js manifest.json tests/e2e/site/
( cd tests/e2e/site && python -m http.server 8770 --bind 127.0.0.1 )

# 3. lancer (chemins relatifs à tests/e2e)
BASE_URL=http://127.0.0.1:8769   npx playwright test --config=playwright.config.mjs
SW_BASE_URL=http://127.0.0.1:8770 npx playwright test sw.spec.mjs --config=playwright.config.mjs
BASE_URL=http://127.0.0.1:8769   npx playwright test --config=playwright.edge.config.mjs   # Edge (local, si installé)
```

La CI (`.github/workflows/mfa-e2e.yml`) exécute automatiquement les suites Chromium et
service worker à chaque `pull_request` et à chaque `push` sur la branche du correctif,
**exclusivement contre `127.0.0.1`**, sans secret ni accès Supabase. Edge reste **local
uniquement** (non garanti reproductible sur le runner GitHub).

## Couverture

- `mfa.spec.mjs` — P1 à P10 (aucun facteur, facteur inachevé, reprise, redémarrage,
  facteur vérifié, deux facteurs, plus de deux, plusieurs inachevés, événements Auth
  concurrents, déconnexion) + erreurs réseau (indisponible, 429, 500, code incorrect,
  code expiré, réseau lent).
- `sw.spec.mjs` — migration réelle du cache v16 → v17, purge de l'ancien cache,
  contenu servi depuis le nouveau cache, absence de mise en cache de `supabase.co`,
  fonctionnement du shell hors ligne.

`sw.spec.mjs` réécrit la constante `CACHE` d'une **copie** du site (`tests/e2e/site/`),
jamais celle du dépôt. Créez cette copie avant de lancer les tests service worker.

Aucun secret, aucun identifiant, aucune URL de production ne figure dans ces fichiers.
