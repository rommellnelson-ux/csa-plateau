select
  payload->>'reference' as reference,
  payload->>'inventory_date' as date_inventaire,
  payload->>'statut' as statut,
  (payload->'import_summary'->>'inventory_lines')::integer as lignes,
  (payload->'import_summary'->>'existing_products')::integer as produits_rapproches,
  (payload->'import_summary'->>'new_products')::integer as nouvelles_fiches,
  (payload->'import_summary'->>'review_required')::integer as lignes_a_corriger
from public.csa_events
where event_key = 'pharma_inventaires:INV-PHYSIQUE-2026-06-12-V3';

select
  line->>'source_row' as ligne_source,
  line->>'medicament' as produit,
  line->>'physique' as quantite,
  line->>'unite' as unite,
  line->>'review_reason' as anomalie
from public.csa_events event
cross join lateral jsonb_array_elements(event.payload->'lignes') as line
where event.event_key = 'pharma_inventaires:INV-PHYSIQUE-2026-06-12-V3'
  and coalesce((line->>'review_required')::boolean, false)
order by (line->>'source_row')::integer;
