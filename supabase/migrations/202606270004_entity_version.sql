-- ════════════════════════════════════════════════════════
-- Version d'entité gérée par le serveur (Phase 1.3a)
-- Migration : 202606270004
--
-- Ajoute entity_version : un compteur incrémenté par le SERVEUR à chaque
-- écriture d'un événement (via trigger). Le navigateur ne peut pas l'imposer.
-- Sert de fondation au contrôle de concurrence optimiste (Phase 1.3b) : le
-- front lira cette version et, plus tard, refusera d'écraser une version plus
-- récente (anti-écrasement silencieux).
--
-- Cette migration est ADDITIVE et non bloquante :
--   • colonne avec valeur par défaut,
--   • trigger BEFORE qui (re)calcule la version,
--   • aucun refus d'écriture introduit ici (l'enforcement viendra en 1.3b).
--
-- ⚠️ À exécuter AVANT que les postes ne chargent la nouvelle version du front
--    (le front lit désormais entity_version au pull).
-- ════════════════════════════════════════════════════════

begin;

alter table public.csa_events
  add column if not exists entity_version bigint not null default 1;

create or replace function public.csa_set_entity_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if (tg_op = 'INSERT') then
    new.entity_version :=
      coalesce((select e.entity_version from public.csa_events e
                where e.event_key = new.event_key), 0) + 1;
  else
    new.entity_version := coalesce(old.entity_version, 0) + 1;
  end if;
  return new;
end;
$fn$;

drop trigger if exists csa_events_set_entity_version on public.csa_events;
create trigger csa_events_set_entity_version
  before insert or update on public.csa_events
  for each row execute function public.csa_set_entity_version();

commit;

-- Vérification : la colonne existe et le trigger est en place.
--   select column_name from information_schema.columns
--     where table_name='csa_events' and column_name='entity_version';
--   select tgname from pg_trigger
--     where tgrelid='public.csa_events'::regclass and tgname='csa_events_set_entity_version';
