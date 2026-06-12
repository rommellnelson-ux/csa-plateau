select
  table_name,
  count(*) as nombre_enregistrements,
  max(updated_at) as derniere_mise_a_jour
from public.csa_events
where table_name in ('pharma_stock','pharma_lots','pharma_mouvements','pharma_inventaires')
group by table_name
order by table_name;

select
  payload->>'medicament' as medicament,
  payload->>'numero_lot' as numero_lot,
  payload->>'date_peremption' as date_peremption,
  (payload->>'quantite')::numeric as quantite
from public.csa_events
where table_name = 'pharma_lots'
order by nullif(payload->>'date_peremption', '') nulls last, payload->>'medicament';
