-- ════════════════════════════════════════════════════════
-- Validation serveur des payloads (Phase 2.1)
-- Un trigger BEFORE INSERT/UPDATE refuse les valeurs ABERRANTES, même si le
-- navigateur est modifié. Volontairement CONSERVATEUR : on ne valide un champ
-- que s'il est un nombre, et on ne rejette que l'évidemment impossible — pour
-- ne JAMAIS rejeter une donnée légitime (champs vides, quantités négatives de
-- sortie de stock, formats anciens... sont laissés passer).
-- À tester d'abord en STAGING.
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
    -- montants/totaux jamais négatifs (les sorties de caisse passent par
    -- contre-écriture, pas par un montant négatif).
    if (p->>'montant') ~ '^\s*-' then raise exception 'csa: montant négatif interdit'; end if;
    if (p->>'total')   ~ '^\s*-' then raise exception 'csa: total négatif interdit'; end if;
  end if;

  return new;
end; $fn$;

drop trigger if exists csa_events_validate on public.csa_events;
create trigger csa_events_validate
  before insert or update on public.csa_events
  for each row execute function public.csa_validate_event();

commit;
