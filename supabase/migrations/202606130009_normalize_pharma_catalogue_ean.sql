-- Normalise le referentiel pharmacie et prepare la saisie des codes EAN.
-- Cette migration ne modifie ni les stocks, ni les lots, ni les prix.

begin;

update public.csa_events
set payload = payload || jsonb_build_object(
      'code_ean', coalesce(payload->>'code_ean', ''),
      'forme', case
        when upper(trim(coalesce(payload->>'type_produit', ''))) = 'CONSOMMABLE'
          then 'Non applicable'
        else case upper(trim(coalesce(payload->>'forme', '')))
        when 'AEROSOL' then 'Aérosol'
        when 'CAPSULE' then 'Capsule'
        when 'COLLYRE' then 'Collyre'
        when 'COMPRIME' then 'Comprimé'
        when 'COMPRIMÉ' then 'Comprimé'
        when 'COMPRIME LP' then 'Comprimé LP'
        when 'COMPRIMÉ LP' then 'Comprimé LP'
        when 'COMPRIME/GELULE' then 'Comprimé / Gélule'
        when 'COMPRIMÉ/GÉLULE' then 'Comprimé / Gélule'
        when 'COMPRIME/INJECTABLE' then 'Comprimé / Solution injectable'
        when 'COMPRIMÉ/INJECTABLE' then 'Comprimé / Solution injectable'
        when 'INJECTABLE/COMPRIME' then 'Solution injectable / Comprimé'
        when 'INJECTABLE/COMPRIMÉ' then 'Solution injectable / Comprimé'
        when 'COMPRIME/SUSPENSION' then 'Comprimé / Suspension'
        when 'COMPRIMÉ/SUSPENSION' then 'Comprimé / Suspension'
        when 'COMPRIME/SIROP' then 'Comprimé / Sirop'
        when 'COMPRIMÉ/SIROP' then 'Comprimé / Sirop'
        when 'CREME' then 'Crème dermique'
        when 'CRÈME' then 'Crème dermique'
        when 'CREME DERMIQUE' then 'Crème dermique'
        when 'CRÈME DERMIQUE' then 'Crème dermique'
        when 'GEL BUVABLE' then 'Gel buvable'
        when 'GEL DERMIQUE' then 'Gel dermique'
        when 'GELULE' then 'Gélule'
        when 'GÉLULE' then 'Gélule'
        when 'INJECTABLE' then 'Solution injectable'
        when 'INJECTABLE POUDRE' then 'Poudre pour solution injectable'
        when 'OVULE' then 'Ovule'
        when 'POMMADE' then 'Pommade dermique'
        when 'POMMADE DERMIQUE' then 'Pommade dermique'
        when 'POMMADE OPHTALMIQUE' then 'Pommade ophtalmique'
        when 'SIROP' then 'Sirop'
        when 'SOLUTION AURICULAIRE' then 'Solution auriculaire'
        when 'SOLUTION BUVABLE' then 'Solution buvable'
        when 'SOLUTION DERMIQUE' then 'Solution dermique'
        when 'SOLUTION EXTERNE' then 'Solution dermique'
        when 'SOLUTION INJECTABLE' then 'Solution injectable'
        when 'SOLUTION NASALE' then 'Solution nasale'
        when 'SOLUTION PERFUSABLE' then 'Solution perfusable'
        when 'SOLUTION VAGINALE' then 'Solution vaginale'
        when 'SPRAY BUCCAL' then 'Spray buccal'
        when 'SUPPOSITOIRE' then 'Suppositoire'
        when 'SUSPENSION BUVABLE' then 'Suspension buvable'
        when 'SUSPENSION INJECTABLE' then 'Suspension injectable'
        else nullif(trim(payload->>'forme'), '')
      end end,
      'conditionnement', case upper(trim(coalesce(payload->>'conditionnement', payload->>'unite', '')))
        when 'AMPOULE' then 'Ampoule'
        when 'BOITE' then 'Boîte'
        when 'BOÎTE' then 'Boîte'
        when 'COMPRIME' then 'Comprimé / unité'
        when 'COMPRIMÉ' then 'Comprimé / unité'
        when 'COMPRIME / UNITE' then 'Comprimé / unité'
        when 'COMPRIMÉ / UNITÉ' then 'Comprimé / unité'
        when 'FLACON' then 'Flacon'
        when 'GELULE' then 'Gélule / unité'
        when 'GÉLULE' then 'Gélule / unité'
        when 'GELULE / UNITE' then 'Gélule / unité'
        when 'GÉLULE / UNITÉ' then 'Gélule / unité'
        when 'OVULE' then 'Ovule / unité'
        when 'PAQUET' then 'Paquet'
        when 'PLAQUETTE' then 'Plaquette'
        when 'POCHE' then 'Poche'
        when 'ROULEAU' then 'Rouleau'
        when 'SACHET' then 'Sachet'
        when 'SACHET / BOITE' then 'Sachet / boîte'
        when 'SACHET / BOÎTE' then 'Sachet / boîte'
        when 'SERINGUE' then 'Seringue'
        when 'SOLIDE' then 'Unité'
        when 'SUPPOSITOIRE' then 'Suppositoire / unité'
        when 'TUBE' then 'Tube'
        when 'U' then 'Unité'
        when 'UNITE' then 'Unité'
        when 'UNITÉ' then 'Unité'
        else nullif(trim(coalesce(payload->>'conditionnement', payload->>'unite')), '')
      end,
      'catalogue_normalized_at', now(),
      'updated_at', now(),
      'synced', true
    ),
    updated_at = now(),
    agent_id = 'SYSTEME',
    agent_nom = 'Normalisation catalogue pharmacie et EAN'
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
    'code_produit','code_atc','code_ean','dci','dosage','forme',
    'conditionnement','cmu_eligible','px_achat','px_cmu','px_na',
    'px_cession','seuil'
  ];
begin
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

drop trigger if exists csa_events_protect_pharma_catalogue on public.csa_events;
create trigger csa_events_protect_pharma_catalogue
before update on public.csa_events
for each row
when (old.table_name = 'pharma_stock')
execute function public.csa_protect_pharma_catalogue_fields();

revoke all on function public.csa_protect_pharma_catalogue_fields() from public;
grant execute on function public.csa_protect_pharma_catalogue_fields() to authenticated;

commit;
