-- Controle apres 202606130008_enrich_pharma_catalogue_financial.sql

select
  count(*) as references,
  count(*) filter (where coalesce((payload->>'cmu_eligible')::boolean, false)) as produits_cmu,
  count(*) filter (where nullif(payload->>'conditionnement', '') is not null) as conditionnements_renseignes,
  sum(coalesce((payload->>'quantite_theorique')::numeric, 0)) as quantite_historique_reference,
  sum(coalesce((payload->>'stock')::numeric, 0)) as stock_operationnel
from public.csa_events
where table_name = 'pharma_stock'
  and payload->>'catalogue_source' = 'Base_Pharmaceutique_CSA_V4.xlsx'
  and coalesce((payload->>'active')::boolean, true);

select
  payload->>'code_produit' as code,
  payload->>'nom' as produit,
  payload->>'dosage' as dosage,
  payload->>'forme' as forme,
  payload->>'conditionnement' as conditionnement,
  payload->>'quantite_theorique' as reference_historique,
  payload->>'stock' as stock_courant,
  payload->>'cmu_eligible' as cmu
from public.csa_events
where table_name = 'pharma_stock'
  and payload->>'catalogue_source' = 'Base_Pharmaceutique_CSA_V4.xlsx'
order by payload->>'nom'
limit 20;
