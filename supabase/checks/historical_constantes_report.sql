select
  count(*) as nombre_corrige,
  reasons,
  min(corrected_at) as premiere_correction,
  max(corrected_at) as derniere_correction
from public.csa_data_corrections
where migration_tag = '202606120004'
group by reasons
order by nombre_corrige desc;

select
  event_key,
  item_id,
  original_payload,
  corrected_payload,
  reasons,
  corrected_at
from public.csa_data_corrections
where migration_tag = '202606120004'
order by corrected_at desc, event_key;
