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
  **À valider en staging** (`?env=staging`, pack de test pharmacie) : inventorier
  un produit → vendre → réappro → vérifier que le stock affiché suit le registre,
  y compris hors-ligne. Tant que ça n'est pas validé : ne PAS passer à B3.
- **B3 — `pharma_stock` immuable.** Une fois le dérivé prouvé en staging : retirer
  `pharma_stock` de `MUTABLE_TABLES` (`app.js:84`) → supprime l'anti-écrasement du
  stock, `pharma_stock` devient catalogue append-only. Adapter `csa_commit` (le
  stock peut alors entrer dans le groupe atomique).
- **B4 — Bascule prod.** Décision de **release** (ASK avant). Passer le flag en
  prod, surveiller, garder le compteur en lecture de secours le temps d'une
  fenêtre d'observation.

## Garde-fous

- Chaque étape : réversible par `git revert` + le compteur `pharma_stock.stock`
  reste écrit jusqu'à B4 (double source pendant la transition).
- Re-lancer `stock_reconciliation_report.sql` avant/après chaque étape.
- Tests : étendre `tests.html` (parité `deriveStock` vs compteur) en B2 ;
  pgTAP en B3 (csa_commit acceptant pharma_stock).
