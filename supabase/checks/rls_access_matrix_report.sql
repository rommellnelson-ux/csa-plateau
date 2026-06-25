-- ════════════════════════════════════════════════════════
-- Contrôle de non-régression RLS — à exécuter dans le SQL Editor.
-- Lève une exception si un accès attendu manque (ex. une migration a recréé
-- csa_can_read/write sans les tables pharmacie, ou la policy UPDATE sans
-- sevci_pvvih). C'est exactement la classe de bug rencontrée en juin 2026.
-- En cas de succès : "OK — matrice RLS conforme".
-- ════════════════════════════════════════════════════════

do $$
declare
  r text;   -- source csa_can_read
  w text;   -- source csa_can_write
  upd text; -- définition policy UPDATE (using + with check)
  ins text; -- définition policy INSERT
  missing text := '';
begin
  select pg_get_functiondef('public.csa_can_read(text)'::regprocedure)  into r;
  select pg_get_functiondef('public.csa_can_write(text)'::regprocedure) into w;
  select coalesce(qual,'')||' '||coalesce(with_check,'')
    into upd from pg_policies
    where schemaname='public' and tablename='csa_events' and policyname='events_update_by_role';
  select coalesce(with_check,'')
    into ins from pg_policies
    where schemaname='public' and tablename='csa_events' and policyname='events_insert_by_role';

  -- Lecture : pharmacie complète + sevci + MFA sevci
  if r not like '%pharma_lots%'        then missing := missing||'csa_can_read:pharma_lots; '; end if;
  if r not like '%pharma_mouvements%'  then missing := missing||'csa_can_read:pharma_mouvements; '; end if;
  if r not like '%pharma_inventaires%' then missing := missing||'csa_can_read:pharma_inventaires; '; end if;
  if r not like '%sevci_pvvih%'        then missing := missing||'csa_can_read:sevci_pvvih; '; end if;
  if r not like '%sevci_actions%'      then missing := missing||'csa_can_read:sevci_actions; '; end if;
  if r not like '%csa_has_aal2%'       then missing := missing||'csa_can_read:MFA-sevci(csa_has_aal2); '; end if;

  -- Écriture : pharmacie + sevci
  if w not like '%pharma_lots%'        then missing := missing||'csa_can_write:pharma_lots; '; end if;
  if w not like '%sevci_pvvih%'        then missing := missing||'csa_can_write:sevci_pvvih; '; end if;
  if w not like '%sevci_actions%'      then missing := missing||'csa_can_write:sevci_actions; '; end if;

  -- Policy UPDATE : doit inclure pharmacie ET sevci_pvvih (sinon CV ne sync pas)
  if upd not like '%pharma_lots%'      then missing := missing||'events_update:pharma_lots; '; end if;
  if upd not like '%sevci_pvvih%'      then missing := missing||'events_update:sevci_pvvih; '; end if;

  -- Policy INSERT : doit imposer l'appartenance (anti-usurpation)
  if ins not like '%created_by%'       then missing := missing||'events_insert:created_by(anti-usurpation); '; end if;

  if missing <> '' then
    raise exception 'RLS NON CONFORME — éléments manquants: %', missing;
  end if;
  raise notice 'OK — matrice RLS conforme (pharmacie + sevci en lecture/écriture/update, MFA sevci, INSERT verrouillé).';
end $$;

-- Récapitulatif lisible : profils SEV-CI
select agent_code, module, permissions, active
from public.csa_profiles
where module = 'sevci' or permissions && array['sevci_med','sevci_data','sevci_sup']
order by agent_code;

-- Récapitulatif : policies actives sur csa_events
select policyname, cmd
from pg_policies
where schemaname='public' and tablename='csa_events'
order by cmd, policyname;
