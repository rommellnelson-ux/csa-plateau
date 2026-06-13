select
  table_name,
  count(*) as nombre,
  round(sum(
    case
      when table_name = 'pharma_registre_historique'
        then coalesce((payload->>'amount')::numeric, 0)
      else 0
    end
  ), 3) as montant_historique
from public.csa_events
where table_name in (
  'pharma_catalogue_historique',
  'pharma_aliases',
  'pharma_registre_historique',
  'pharma_composants_historiques'
)
group by table_name
order by table_name;

select
  count(*) as lignes_registre,
  round(sum((payload->>'amount')::numeric), 3) as montant_total,
  count(*) filter (where payload->>'product_id' is null) as lignes_sans_produit,
  count(*) filter (where payload->>'record_type' = 'KIT_FINANCIER') as lignes_kits
from public.csa_events
where table_name = 'pharma_registre_historique';

select
  count(*) as composants,
  round(sum((payload->>'component_amount')::numeric), 3) as montant_composants,
  count(*) filter (where payload->>'product_id' is null) as composants_sans_produit
from public.csa_events
where table_name = 'pharma_composants_historiques';

select
  count(*) as hpv_lignes,
  round(sum((payload->>'amount')::numeric), 3) as hpv_montant
from public.csa_events
where table_name = 'pharma_registre_historique'
  and payload->>'product_id' = 'PRD-0122';
