-- Controle apres 202606130009_normalize_pharma_catalogue_ean.sql.

select
  count(*) as references_actives,
  count(*) filter (where nullif(payload->>'dosage', '') is null) as dosages_a_completer,
  count(*) filter (where nullif(payload->>'forme', '') is null) as formes_a_completer,
  count(*) filter (where nullif(payload->>'conditionnement', '') is null) as conditionnements_a_completer,
  count(*) filter (where nullif(payload->>'code_ean', '') is not null) as ean_renseignes,
  count(*) filter (
    where nullif(payload->>'code_ean', '') is not null
      and payload->>'code_ean' !~ '^[0-9]{8}$|^[0-9]{12,14}$'
  ) as formats_ean_invalides
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true);

select payload->>'code_ean' as code_ean, count(*) as produits
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true)
  and nullif(payload->>'code_ean', '') is not null
group by payload->>'code_ean'
having count(*) > 1
order by payload->>'code_ean';

select payload->>'forme' as forme, count(*) as references
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true)
group by payload->>'forme'
order by payload->>'forme';

select payload->>'conditionnement' as conditionnement, count(*) as references
from public.csa_events
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true)
group by payload->>'conditionnement'
order by payload->>'conditionnement';
