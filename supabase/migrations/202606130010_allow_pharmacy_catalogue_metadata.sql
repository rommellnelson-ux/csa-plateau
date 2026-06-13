-- Autorise les gestionnaires pharmacie a maintenir uniquement le referentiel
-- technique: code interne, produit, EAN, dosage, forme et conditionnement.
-- Les donnees CMU, financieres et de classification restent protegees.

begin;

-- Les anciens codes de rapprochement Mxxx peuvent etre partages par plusieurs
-- lignes. Dans ce cas, le PRD source redevient le code interne unique.
with duplicated_codes as (
  select payload->>'code_produit' as code_produit
  from public.csa_events
  where table_name = 'pharma_stock'
    and coalesce((payload->>'active')::boolean, true)
    and nullif(payload->>'code_produit', '') is not null
  group by payload->>'code_produit'
  having count(*) > 1
)
update public.csa_events e
set payload = e.payload || jsonb_build_object(
      'code_produit', e.payload->>'source_product_id',
      'updated_at', now(),
      'synced', true
    ),
    updated_at = now(),
    agent_id = 'SYSTEME',
    agent_nom = 'Unicite codes internes pharmacie'
from duplicated_codes d
where e.table_name = 'pharma_stock'
  and coalesce((e.payload->>'active')::boolean, true)
  and e.payload->>'code_produit' = d.code_produit
  and nullif(e.payload->>'source_product_id', '') is not null;

create or replace function public.csa_valid_ean(value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text := coalesce(trim(value), '');
  total integer := 0;
  i integer;
  expected_check integer;
begin
  if cleaned = '' then
    return true;
  end if;
  if cleaned !~ '^[0-9]+$' or length(cleaned) not in (8, 12, 13, 14) then
    return false;
  end if;
  for i in reverse (length(cleaned) - 1)..1 loop
    total := total + substring(cleaned from i for 1)::integer
      * case when (length(cleaned) - i) % 2 = 1 then 3 else 1 end;
  end loop;
  expected_check := (10 - (total % 10)) % 10;
  return expected_check = right(cleaned, 1)::integer;
end;
$$;

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
    'cmu_eligible','cmu_source','px_achat','px_cmu','px_na',
    'px_cession','seuil','price_status','active','catalogue_status',
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

revoke all on function public.csa_protect_pharma_catalogue_fields() from public;
revoke all on function public.csa_valid_ean(text) from public;
grant execute on function public.csa_protect_pharma_catalogue_fields() to authenticated;
grant execute on function public.csa_valid_ean(text) to authenticated;

commit;
