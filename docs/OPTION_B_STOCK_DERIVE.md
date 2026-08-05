# Option B — Stock dérivé des mouvements (roadmap staged)

## Pourquoi

Aujourd'hui `pharma_stock.stock` est un **compteur absolu mutable** : chaque
vente/réappro/inventaire le réécrit en place. C'est ce qui impose toute la
machinerie **anti-écrasement** (`entity_version`, `MUTABLE_TABLES`, conflits
Phase 1.3) sur le stock — deux postes qui vendent le même produit hors ligne
peuvent produire un conflit d'écrasement.

Or chaque mutation écrit **déjà** un `pharma_mouvements` append-only avec
`quantite` signée + `stock_avant`/`stock_apres`
(`app.js` : vente ~2487, réappro ~2760, inventaire ~3634). Donc le stock
*pourrait* être **dérivé** du registre → `pharma_stock` deviendrait un simple
catalogue **immuable**, sans conflits d'écrasement, avec un audit intégral.

C'est un changement de **source de vérité** sur un système médical vivant :
on procède par étapes réversibles, staging d'abord, **jamais** de bascule à chaud
sans preuve de réconciliation.

## État : B0 (dé-risquage) — FAIT

Livrable : [`supabase/checks/stock_reconciliation_report.sql`](../supabase/checks/stock_reconciliation_report.sql).
Compare, par médicament, le compteur stocké au stock dérivé
(`last_apres` = running-balance du dernier mouvement ; `sum_quantite` = somme
signée). **Aucune modification de comportement.**

**Décision B0** = lire ce rapport en prod :

| Observation | Interprétation | Suite |
|---|---|---|
| `delta_apres = 0` partout | le registre réconcilie parfaitement | → **B2** (dérivation viable) |
| `delta_apres` ≠ 0 mais **constant** par med | solde d'ouverture non tracé comme mouvement | → **B1** puis re-réconcilier |
| `delta_apres` **erratique** / `AUCUN MOUVEMENT` | registre incomplet | **STOP** — rester sur le compteur, corriger d'abord la traçabilité |

## Étapes suivantes (à ne lancer que si B0 le permet)

- **B1 — Solde d'ouverture.** Si l'écart est un solde initial : migration ajoutant
  un `pharma_mouvements` `type='OUVERTURE'` par médicament (quantité = solde à la
  date d'origine), de sorte que `sum_quantite` = stock courant. Re-lancer le
  rapport B0 jusqu'à `delta = 0`.
- **B2 — Lecture dérivée, STAGING uniquement. ✅ FAIT.** Helper front
  `deriveStock(medId, mouvements)` (solde = `stock_apres` du dernier mouvement,
  `app.js`) + `DB.getStock()` renvoie le stock dérivé **seulement si**
  `CSA_ENV==='staging'`. Prod **strictement inchangée** (compteur + anti-écrasement
  conservés — un seul point modifié, toutes les lectures passent par getStock).
  Parité couverte par `tests.html` (3 assertions `deriveStock`).
  **✅ Validé au niveau intégration** (preview) : en `?env=staging`, `DB.getStock()`
  renvoie le stock **dérivé** (dernier `stock_apres` du registre) ; en prod il
  renvoie le **compteur** inchangé. Gate vérifié dans les deux sens.
  **Reste à valider en session RÉELLE staging** (login pack pharmacie, inventaire
  → vente → réappro, y c. hors-ligne à 2 postes) pour confirmer que le modèle
  dérivé tient sous des opérations réelles (pas seulement des données seedées).
- **B3 — Neutraliser le faux conflit sur le stock. ✅ FAIT (staging).**
  **Recadrage** : `pharma_stock` ne peut PAS devenir immuable (le retirer de
  `MUTABLE_TABLES` le rendrait insert-only → MAJ perdues ; il porte aussi des
  MÉTADONNÉES — prix/nom/seuil/statut — protégées par l'anti-écrasement). B3 ne
  rend donc rien immuable : flag unique `STOCK_DERIVED` (= `CSA_ENV==='staging'`),
  `getStock` l'utilise, et **`pushCloudRow` auto-résout** un conflit `pharma_stock`
  qui ne diffère QUE sur `stock` (helper `stockOnlyDiff`) → plus de fausse bannière
  lors de ventes concurrentes hors ligne ; un écart sur une métadonnée reste un
  vrai conflit parqué. Aucun changement serveur (le modèle serveur est déjà
  compatible : `pharma_mouvements` append-only). Tests : 4 assertions `stockOnlyDiff`
  (109/109 TESTS_PASS). Compteur `pharma_stock.stock` toujours écrit = cache
  rollback-safe (ignoré en lecture en mode dérivé).
  **Raffinement — validation d'inventaire par le chef** (`decidePharmaInventory`) :
  en mode compteur, toute vente entre la saisie et l'approbation invalide
  l'inventaire (blocage « stock changé »). En mode dérivé, l'écart est un delta
  qui se compose avec les ventes intercalées (`courant+écart = physique−ventes`) →
  le blocage est **relâché** (l'ajustement s'applique quand même), avec un **clamp
  anti-négatif** : on bloque seulement si `courant+écart < 0` (des ventes ont
  consommé plus que le manquant constaté). Gated `STOCK_DERIVED` ; mode compteur
  strictement inchangé.
- **B4 — Bascule prod.** Décision de **release** (ASK avant). `STOCK_DERIVED = true`
  (au lieu de `CSA_ENV==='staging'`). Prérequis : validation opérationnelle réelle
  en staging + `stock_reconciliation_report.sql` propre. Garder le compteur en cache
  (rollback = reflipper à `false`).
- **B5 — Lots dérivés (hors scope B3/B4).** `pharma_lots` reste mutable et
  décrémenté (`consumeLots`/`setLots`) → source de conflit résiduelle. Le dériver
  des mouvements (`lot_id`+`quantite`) est une phase ultérieure distincte.

## Garde-fous

- Chaque étape : réversible par `git revert` + le compteur `pharma_stock.stock`
  reste écrit jusqu'à B4 (double source pendant la transition).
- Re-lancer `stock_reconciliation_report.sql` avant/après chaque étape.
- Tests : `tests.html` couvre `deriveStock` (B2) et `stockOnlyDiff` (B3). B4/B5
  n'exigent pas de changement serveur → pas de pgTAP additionnel.
