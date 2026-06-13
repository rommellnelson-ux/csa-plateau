-- Controle apres 202606130011_inventory_new_products_cmu_markup.sql.

select
  count(*) as references_actives,
  count(*) filter (where coalesce((payload->>'cmu_eligible')::boolean, false)) as produits_cmu,
  count(*) filter (
    where coalesce((payload->>'cmu_eligible')::boolean, false)
      and coalesce((payload->>'cmu_markup_pct')::numeric, 15) <> 15
  ) as majorations_cmu_personnalisees,
  count(*) filter (
    where payload->>'validation_source' = 'INVENTAIRE_APPROUVE'
  ) as produits_crees_par_inventaire,
  sum(coalesce((payload->>'stock')::numeric, 0)) as stock_operationnel_total
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true);

select
  payload->>'code_produit' as code_interne,
  payload->>'nom' as produit,
  payload->>'px_cession' as prix_cession,
  payload->>'cmu_markup_pct' as majoration_cmu_pct,
  payload->>'px_cmu' as tarif_cmu
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true)
  and coalesce((payload->>'cmu_eligible')::boolean, false)
order by payload->>'nom'
limit 30;
