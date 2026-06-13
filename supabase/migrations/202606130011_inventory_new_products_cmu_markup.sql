-- Nouveaux produits via inventaire et majoration CMU paramétrable.
-- Aucun stock historique n'est converti automatiquement en stock courant.

begin;

update public.csa_events
set payload = payload || jsonb_build_object(
      'cmu_markup_pct', coalesce(
        case
          when trim(coalesce(payload->>'cmu_markup_pct', '')) ~ '^[0-9]+([.,][0-9]+)?$'
            then replace(payload->>'cmu_markup_pct', ',', '.')::numeric
        end,
        15
      ),
      'px_cmu', case
        when coalesce((payload->>'cmu_eligible')::boolean, false)
          and trim(coalesce(payload->>'px_cession', '')) ~ '^[0-9]+([.,][0-9]+)?$'
        then round(
          replace(payload->>'px_cession', ',', '.')::numeric
          * (
            1 + coalesce(
              case
                when trim(coalesce(payload->>'cmu_markup_pct', '')) ~ '^[0-9]+([.,][0-9]+)?$'
                  then replace(payload->>'cmu_markup_pct', ',', '.')::numeric
              end,
              15
            ) / 100
          )
        )
        else 0
      end,
      'updated_at', now(),
      'synced', true
    ),
    updated_at = now(),
    agent_id = 'SYSTEME',
    agent_nom = 'Initialisation majoration CMU'
where table_name = 'pharma_stock'
  and coalesce((payload->>'active')::boolean, true);

create or replace function public.csa_protect_pharma_catalogue_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  protected_key text;
  protected_keys constant text[] := array[
    'code_atc','dci','noms_commerciaux','classe_therapeutique',
    'voie_administration','categorie','sous_famille','type_produit',
    'cmu_eligible','cmu_source','cmu_markup_pct','px_achat','px_cmu',
    'px_na','px_cession','seuil','price_status','active','catalogue_status',
    'quantite_theorique','quantite_theorique_type',
    'historique_nb_sorties','historique_quantite','historique_montant',
    'prix_historique_min','prix_historique_max','prix_historique_moyen',
    'catalogue_source','catalogue_version','source_product_id'
  ];
begin
  if old.table_name = 'pharma_stock' then
    if nullif(trim(new.payload->>'code_produit'), '') is null then
      raise exception 'Le code interne du produit est obligatoire'
        using errcode = '23514';
    end if;
    if nullif(trim(new.payload->>'nom'), '') is null then
      raise exception 'Le nom du produit est obligatoire'
        using errcode = '23514';
    end if;
    if not public.csa_valid_ean(new.payload->>'code_ean') then
      raise exception 'Le code EAN est invalide'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from public.csa_events other
      where other.table_name = 'pharma_stock'
        and other.event_key <> old.event_key
        and coalesce((other.payload->>'active')::boolean, true)
        and upper(trim(other.payload->>'code_produit')) =
            upper(trim(new.payload->>'code_produit'))
    ) then
      raise exception 'Le code interne "%" est déjà utilisé', new.payload->>'code_produit'
        using errcode = '23505';
    end if;
    if nullif(trim(new.payload->>'code_ean'), '') is not null and exists (
      select 1 from public.csa_events other
      where other.table_name = 'pharma_stock'
        and other.event_key <> old.event_key
        and coalesce((other.payload->>'active')::boolean, true)
        and trim(other.payload->>'code_ean') = trim(new.payload->>'code_ean')
    ) then
      raise exception 'Le code EAN "%" est déjà utilisé', new.payload->>'code_ean'
        using errcode = '23505';
    end if;
  end if;

  if old.table_name = 'pharma_stock'
     and auth.uid() is not null
     and not (public.csa_is_chief() and public.csa_chief_has_aal2()) then
    foreach protected_key in array protected_keys loop
      if old.payload -> protected_key is distinct from new.payload -> protected_key then
        raise exception 'Modification du champ pharmacie "%" réservée au Médecin-Chef avec MFA', protected_key
          using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.csa_protect_pharma_stock_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.table_name = 'pharma_stock'
     and auth.uid() is not null
     and not (public.csa_is_chief() and public.csa_chief_has_aal2()) then
    raise exception 'La création d’un produit nécessite la validation du Médecin-Chef avec MFA'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists csa_events_protect_pharma_stock_insert on public.csa_events;
create trigger csa_events_protect_pharma_stock_insert
before insert on public.csa_events
for each row
when (new.table_name = 'pharma_stock')
execute function public.csa_protect_pharma_stock_insert();

revoke all on function public.csa_protect_pharma_stock_insert() from public;
grant execute on function public.csa_protect_pharma_stock_insert() to authenticated;

commit;
