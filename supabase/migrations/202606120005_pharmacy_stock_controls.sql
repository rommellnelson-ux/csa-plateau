begin;

create or replace function public.csa_can_read(target_table text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.csa_profiles p
    where p.user_id = auth.uid()
      and p.active
      and (
        (p.is_chef and public.csa_chief_has_aal2())
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes'))
        or ('soins' = any(p.permissions) and target_table in ('patients','consultations','constantes','soins','observations'))
        or ('labo' = any(p.permissions) and target_table in ('patients','consultations','labo_actes'))
        or ('pharmacie' = any(p.permissions) and target_table in (
          'patients','consultations','pharma_ventes','pharma_stock',
          'pharma_lots','pharma_mouvements','pharma_inventaires'
        ))
        or ('compta' = any(p.permissions) and target_table in ('transactions','clotures','audit_logs'))
      )
  )
$$;

create or replace function public.csa_can_write(target_table text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.csa_profiles p
    where p.user_id = auth.uid()
      and p.active
      and (
        (p.is_chef and public.csa_chief_has_aal2())
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes','transactions','audit_logs'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes','transactions','audit_logs'))
        or ('soins' = any(p.permissions) and target_table in ('soins','observations','transactions','audit_logs'))
        or ('labo' = any(p.permissions) and target_table in ('labo_actes','transactions','audit_logs'))
        or ('pharmacie' = any(p.permissions) and target_table in (
          'pharma_ventes','pharma_stock','pharma_lots','pharma_mouvements',
          'pharma_inventaires','transactions','audit_logs'
        ))
        or ('compta' = any(p.permissions) and target_table in ('clotures','audit_logs'))
      )
  )
$$;

drop policy if exists "events_update_by_role" on public.csa_events;
create policy "events_update_by_role"
on public.csa_events
for update
to authenticated
using (
  public.csa_can_write(table_name)
  and table_name in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires')
)
with check (
  public.csa_can_write(table_name)
  and table_name in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires')
  and created_by = auth.uid()
  and coalesce(payload->>'agent_id', '') = (
    select p.agent_code from public.csa_profiles p
    where p.user_id = auth.uid() and p.active
  )
);

insert into public.csa_events (
  event_key, table_name, item_id, payload, created_at, updated_at, agent_id, agent_nom
)
select
  'pharma_lots:LOT-LEGACY-' || coalesce(e.payload->>'id', e.item_id),
  'pharma_lots',
  'LOT-LEGACY-' || coalesce(e.payload->>'id', e.item_id),
  jsonb_build_object(
    'id', 'LOT-LEGACY-' || coalesce(e.payload->>'id', e.item_id),
    'med_id', coalesce(e.payload->>'id', e.item_id),
    'medicament', coalesce(e.payload->>'nom', 'Médicament historique'),
    'numero_lot', 'HISTORIQUE',
    'date_peremption', '',
    'fournisseur', 'Stock antérieur à la gestion des lots',
    'quantite', greatest(0, case
      when trim(coalesce(e.payload->>'stock', '')) ~ '^[0-9]+([.,][0-9]+)?$'
        then replace(e.payload->>'stock', ',', '.')::numeric
      else 0
    end),
    'quantite_initiale', greatest(0, case
      when trim(coalesce(e.payload->>'stock', '')) ~ '^[0-9]+([.,][0-9]+)?$'
        then replace(e.payload->>'stock', ',', '.')::numeric
      else 0
    end),
    'created_at', coalesce(e.created_at, now()),
    'updated_at', now(),
    'agent_id', 'SYSTEME',
    'agent_nom', 'Migration lots historiques',
    'synced', true
  ),
  coalesce(e.created_at, now()),
  now(),
  'SYSTEME',
  'Migration lots historiques'
from public.csa_events e
where e.table_name = 'pharma_stock'
  and case
    when trim(coalesce(e.payload->>'stock', '')) ~ '^[0-9]+([.,][0-9]+)?$'
      then replace(e.payload->>'stock', ',', '.')::numeric
    else 0
  end > 0
on conflict (event_key) do nothing;

commit;
