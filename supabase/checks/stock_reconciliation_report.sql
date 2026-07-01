-- ════════════════════════════════════════════════════════
-- Rapport de réconciliation du stock (Option B0 — dé-risquage)
-- Compare, PAR MÉDICAMENT, le compteur de stock STOCKÉ (pharma_stock.stock)
-- au stock DÉRIVÉ du registre append-only pharma_mouvements. Objectif : savoir
-- si le stock peut un jour être *dérivé* des mouvements (Option B) — SANS rien
-- changer au comportement actuel. 100 % lecture, aucun effet.
--
-- Modèle event-sourced : l'état vit dans public.csa_events.
--   • pharma_stock     = upsert -> 1 ligne par médicament (event_key pharma_stock:<id>)
--   • pharma_mouvements = append-only -> N lignes (payload.med_id, quantite signée,
--                         stock_avant, stock_apres). quantite < 0 = sortie.
--
-- Par médicament :
--   stored       = pharma_stock.stock (compteur actuel, source de vérité actuelle)
--   last_apres   = stock_apres du DERNIER mouvement (running-balance du registre)
--   sum_quantite = somme signée des quantite (ledger pur, sans solde d'ouverture)
--   delta_apres  = stored - last_apres   (0 = le registre colle au compteur)
--   delta_somme  = stored - sum_quantite (souvent = solde d'ouverture non tracé)
--   ok           = (stored = last_apres)
--
-- LECTURE : divergents (ok=false) en HAUT.
--   • delta_apres = 0 partout  -> le registre réconcilie : Option B viable (→ B2).
--   • delta_apres ≠ 0 mais CONSTANT par med -> solde d'ouverture manquant (→ B1 :
--     injecter un mouvement d'OUVERTURE, puis re-réconcilier).
--   • delta_apres erratique / mouvements manquants -> registre incomplet :
--     dérivation NON viable en l'état (rester sur le compteur).
-- Voir docs/OPTION_B_STOCK_DERIVE.md.
-- ════════════════════════════════════════════════════════

with stock as (
  select
    payload->>'id'             as med_id,
    nullif(payload->>'nom','')  as nom,
    case when payload->>'stock' ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (payload->>'stock')::numeric end as stored
  from public.csa_events
  where table_name = 'pharma_stock'
    and payload ? 'id'
    and coalesce(payload->>'active','') <> 'false'
),
mv as (
  select
    payload->>'med_id' as med_id,
    case when payload->>'quantite' ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (payload->>'quantite')::numeric end as quantite,
    case when payload->>'stock_apres' ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (payload->>'stock_apres')::numeric end as stock_apres,
    row_number() over (
      partition by payload->>'med_id'
      order by created_at desc, event_key desc
    ) as rn
  from public.csa_events
  where table_name = 'pharma_mouvements'
),
agg as (
  select med_id, sum(quantite) as sum_quantite, count(*) as n_mouvements
  from mv group by med_id
),
last_mv as (
  select med_id, stock_apres as last_apres from mv where rn = 1
)
select
  s.med_id,
  s.nom,
  s.stored,
  lm.last_apres,
  coalesce(a.sum_quantite, 0)                                   as sum_quantite,
  coalesce(a.n_mouvements, 0)                                   as n_mouvements,
  s.stored - lm.last_apres                                      as delta_apres,
  s.stored - coalesce(a.sum_quantite, 0)                        as delta_somme,
  (lm.last_apres is not null and s.stored = lm.last_apres)      as ok,
  case
    when lm.last_apres is null                       then 'AUCUN MOUVEMENT'
    when s.stored = lm.last_apres                     then 'OK'
    else '⚠ DIVERGENT'
  end                                                           as statut
from stock s
left join agg     a  on a.med_id  = s.med_id
left join last_mv lm on lm.med_id = s.med_id
order by
  (lm.last_apres is not null and s.stored = lm.last_apres) asc, -- divergents/absents en haut
  abs(s.stored - coalesce(lm.last_apres, s.stored)) desc,
  s.nom nulls last;
