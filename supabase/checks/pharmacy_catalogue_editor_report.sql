-- Controle apres 202606130010_allow_pharmacy_catalogue_metadata.sql.

select
  count(*) as references_actives,
  count(distinct payload->>'code_produit') as codes_internes_distincts,
  count(*) filter (where nullif(payload->>'code_produit', '') is null) as codes_manquants,
  count(*) filter (where nullif(payload->>'nom', '') is null) as produits_sans_nom,
  count(*) filter (where nullif(payload->>'dosage', '') is null) as dosages_a_completer,
  count(*) filter (where nullif(payload->>'code_ean', '') is not null) as ean_renseignes
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true);

select payload->>'code_produit' as code_interne, count(*) as occurrences
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true)
group by payload->>'code_produit'
having count(*) > 1
order by payload->>'code_produit';
