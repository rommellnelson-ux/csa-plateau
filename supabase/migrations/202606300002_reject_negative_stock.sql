-- ════════════════════════════════════════════════════════
-- Garde-fou serveur : stock jamais négatif (Phase 2.2 - suite)
-- pharma_stock.stock est un compteur absolu : il ne peut pas être < 0.
-- Le front clampe déjà à 0, mais un client trafiqué pourrait envoyer un stock
-- négatif. On étend csa_validate_event (BEFORE INSERT/UPDATE) pour le refuser.
-- Conservateur : on ne valide que si 'stock' est un nombre ; on ne rejette que
-- le strictement négatif. (pharma_mouvements.quantite, lui, EST négatif pour
-- une sortie -> non concerné, c'est une autre table.)
-- ════════════════════════════════════════════════════════
begin;

create or replace function public.csa_validate_event()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare p jsonb := new.payload; v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'csa: payload invalide (objet JSON requis) pour %', new.table_name;
  end if;

  if new.table_name = 'constantes' then
    if (p->>'temperature') ~ '^[0-9]+(\.[0-9]+)?$' then
      v := (p->>'temperature')::numeric;
      if v > 0 and (v < 25 or v > 45) then raise exception 'csa: température hors plage (25-45): %', v; end if;
    end if;
    if (p->>'spo2') ~ '^[0-9]+(\.[0-9]+)?$' then
      v := (p->>'spo2')::numeric;
      if v > 100 then raise exception 'csa: SpO2 hors plage (<=100): %', v; end if;
    end if;
    if (p->>'poids') ~ '^[0-9]+(\.[0-9]+)?$' then
      v := (p->>'poids')::numeric;
      if v > 0 and v > 600 then raise exception 'csa: poids hors plage (<=600 kg): %', v; end if;
    end if;
    if (p->>'taille') ~ '^[0-9]+(\.[0-9]+)?$' then
      v := (p->>'taille')::numeric;
      if v > 0 and v > 300 then raise exception 'csa: taille hors plage (<=300 cm): %', v; end if;
    end if;
    if (p->>'pouls') ~ '^[0-9]+(\.[0-9]+)?$' then
      v := (p->>'pouls')::numeric;
      if v > 0 and v > 400 then raise exception 'csa: pouls hors plage (<=400): %', v; end if;
    end if;

  elsif new.table_name in ('transactions','soins','labo_actes','pharma_ventes') then
    if (p->>'montant') ~ '^\s*-' then raise exception 'csa: montant négatif interdit'; end if;
    if (p->>'total')   ~ '^\s*-' then raise exception 'csa: total négatif interdit'; end if;

  elsif new.table_name = 'pharma_stock' then
    if (p->>'stock') ~ '^-?[0-9]+(\.[0-9]+)?$' then
      v := (p->>'stock')::numeric;
      if v < 0 then raise exception 'csa: stock négatif interdit: %', v; end if;
    end if;
  end if;

  return new;
end; $fn$;

commit;

-- Fonction de trigger -> effet immédiat, pas de cache PostgREST à recharger.
