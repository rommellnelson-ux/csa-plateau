begin;

create table if not exists public.csa_data_corrections (
  id bigint generated always as identity primary key,
  migration_tag text not null,
  event_key text not null,
  item_id text,
  original_payload jsonb not null,
  corrected_payload jsonb not null,
  reasons jsonb not null,
  corrected_at timestamptz not null default now(),
  corrected_by uuid default auth.uid(),
  unique (migration_tag, event_key)
);

alter table public.csa_data_corrections enable row level security;
revoke all on table public.csa_data_corrections from anon;
grant select on table public.csa_data_corrections to authenticated;

drop policy if exists "chief_reads_data_corrections" on public.csa_data_corrections;
create policy "chief_reads_data_corrections"
on public.csa_data_corrections
for select
to authenticated
using (public.csa_is_chief() and public.csa_chief_has_aal2());

create or replace function public.csa_safe_number(value text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when trim(coalesce(value, '')) ~ '^-?[0-9]+([.,][0-9]+)?$'
      then replace(trim(value), ',', '.')::numeric
    else null
  end
$$;

create or replace function public.csa_normalize_constantes(source_payload jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  result jsonb := source_payload;
  reasons text[] := array[]::text[];
  value_num numeric;
  poids_num numeric;
  taille_num numeric;
  imc_num numeric;
  ta_match text[];
  sys_num integer;
  dia_num integer;
begin
  value_num := public.csa_safe_number(source_payload->>'poids');
  if coalesce(source_payload->>'poids', '') <> ''
     and (value_num is null or value_num < 1 or value_num > 400) then
    result := jsonb_set(result, '{poids}', 'null'::jsonb, true);
    reasons := array_append(reasons, 'poids_hors_bornes');
  end if;

  value_num := public.csa_safe_number(source_payload->>'taille');
  if coalesce(source_payload->>'taille', '') <> ''
     and (value_num is null or value_num < 30 or value_num > 250) then
    result := jsonb_set(result, '{taille}', 'null'::jsonb, true);
    reasons := array_append(reasons, 'taille_hors_bornes');
  end if;

  value_num := public.csa_safe_number(source_payload->>'temperature');
  if coalesce(source_payload->>'temperature', '') <> ''
     and (value_num is null or value_num < 30 or value_num > 45) then
    result := jsonb_set(result, '{temperature}', 'null'::jsonb, true);
    reasons := array_append(reasons, 'temperature_hors_bornes');
  end if;

  value_num := public.csa_safe_number(source_payload->>'pouls');
  if coalesce(source_payload->>'pouls', '') <> ''
     and (value_num is null or value_num < 20 or value_num > 250) then
    result := jsonb_set(result, '{pouls}', 'null'::jsonb, true);
    reasons := array_append(reasons, 'pouls_hors_bornes');
  end if;

  value_num := public.csa_safe_number(source_payload->>'spo2');
  if coalesce(source_payload->>'spo2', '') <> ''
     and (value_num is null or value_num < 50 or value_num > 100) then
    result := jsonb_set(result, '{spo2}', 'null'::jsonb, true);
    reasons := array_append(reasons, 'spo2_hors_bornes');
  end if;

  if coalesce(source_payload->>'ta', '') <> '' then
    ta_match := regexp_match(source_payload->>'ta', '^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*$');
    if ta_match is null then
      result := jsonb_set(result, '{ta}', 'null'::jsonb, true);
      reasons := array_append(reasons, 'tension_format_invalide');
    else
      sys_num := ta_match[1]::integer;
      dia_num := ta_match[2]::integer;
      if sys_num < 50 or sys_num > 260 or dia_num < 30 or dia_num > 160 then
        result := jsonb_set(result, '{ta}', 'null'::jsonb, true);
        reasons := array_append(reasons, 'tension_hors_bornes');
      end if;
    end if;
  end if;

  poids_num := public.csa_safe_number(result->>'poids');
  taille_num := public.csa_safe_number(result->>'taille');
  imc_num := public.csa_safe_number(result->>'imc');

  if poids_num between 1 and 400 and taille_num between 30 and 250 then
    value_num := round(poids_num / power(taille_num / 100, 2), 1);
    if imc_num is null or abs(imc_num - value_num) > 0.1 then
      result := jsonb_set(result, '{imc}', to_jsonb(value_num), true);
      reasons := array_append(reasons, 'imc_recalcule');
    end if;
  elsif coalesce(result->>'imc', '') <> ''
        and (imc_num is null or imc_num < 5 or imc_num > 100) then
    result := jsonb_set(result, '{imc}', 'null'::jsonb, true);
    reasons := array_append(reasons, 'imc_invalide_sans_mesures_fiables');
  end if;

  if cardinality(reasons) > 0 then
    result := result || jsonb_build_object(
      'data_quality_corrected', true,
      'data_quality_corrected_at', now(),
      'data_quality_correction_reasons', to_jsonb(reasons)
    );
  end if;

  return jsonb_build_object(
    'payload', result,
    'reasons', to_jsonb(reasons)
  );
end;
$$;

drop table if exists pg_temp.csa_constantes_fix;

create temporary table csa_constantes_fix as
select
  e.event_key,
  e.item_id,
  e.payload as original_payload,
  normalized->'payload' as corrected_payload,
  normalized->'reasons' as reasons
from public.csa_events e
cross join lateral public.csa_normalize_constantes(e.payload) normalized
where e.table_name = 'constantes'
  and jsonb_array_length(normalized->'reasons') > 0;

insert into public.csa_data_corrections (
  migration_tag, event_key, item_id, original_payload, corrected_payload, reasons
)
select
  '202606120004',
  event_key,
  item_id,
  original_payload,
  corrected_payload,
  reasons
from csa_constantes_fix
on conflict (migration_tag, event_key) do nothing;

update public.csa_events e
set
  payload = f.corrected_payload,
  updated_at = now()
from csa_constantes_fix f
where e.event_key = f.event_key
  and e.payload is distinct from f.corrected_payload;

drop table if exists pg_temp.csa_constantes_fix;

revoke all on function public.csa_safe_number(text) from public;
revoke all on function public.csa_normalize_constantes(jsonb) from public;
grant execute on function public.csa_safe_number(text) to authenticated;
grant execute on function public.csa_normalize_constantes(jsonb) to authenticated;

commit;
