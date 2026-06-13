-- Controle apres 202606130007_import_current_pharma_catalogue.sql

select
  count(*) filter (where payload->>'catalogue_source' = 'Base_Pharmaceutique_CSA_V4.xlsx'
    and coalesce((payload->>'active')::boolean, true)) as catalogue_actif,
  count(*) filter (where payload->>'catalogue_status' = 'DEMO_ARCHIVE') as produits_demo_archives,
  coalesce(sum(case
    when payload->>'catalogue_source' = 'Base_Pharmaceutique_CSA_V4.xlsx'
      and coalesce((payload->>'active')::boolean, true)
    then coalesce((payload->>'stock')::numeric, 0) else 0 end), 0) as stock_initial_catalogue,
  count(*) filter (where payload->>'catalogue_source' = 'Base_Pharmaceutique_CSA_V4.xlsx'
    and coalesce((payload->>'px_cession')::numeric, 0) = 0) as prix_a_valider
from public.csa_events
where table_name = 'pharma_stock';

select
  item_id,
  payload->>'nom' as produit,
  payload->>'code_atc' as code_atc,
  payload->>'catalogue_status' as statut
from public.csa_events
where table_name = 'pharma_stock'
  and payload->>'catalogue_source' = 'Base_Pharmaceutique_CSA_V4.xlsx'
  and payload->>'nom' in ('Malva','HPV Hydrosol Poly Vitamine','Célécoxib 200mg cp','Litacold cp')
order by produit;

select public.csa_can_read('pharma_registre_historique') as acces_historique_du_compte_courant;
