-- ════════════════════════════════════════════════════════
-- Commit atomique d'un groupe d'événements (Phase 2.2)
-- Une vente pharmacie = vente + N mouvements de stock + transaction (caisse).
-- Ces événements APPEND-ONLY doivent atterrir ENSEMBLE ou pas du tout :
-- jamais de vente sans son encaissement ni son mouvement (ni l'inverse).
--
-- csa_commit(events) insère tout le groupe dans UNE seule transaction.
-- SECURITY DEFINER court-circuite la RLS -> on RE-VÉRIFIE les droits ici :
--   - csa_can_write(table_name)         (mêmes droits que la policy d'insert)
--   - agent_id = agent_code du profil   (anti-usurpation, comme la policy)
--   - tables MUTABLES refusées          (pas d'upsert ambigu dans un groupe ;
--                                        le stock garde son chemin per-row +
--                                        anti-écrasement de la Phase 1.3)
-- Idempotent : on conflict (event_key) do nothing -> un renvoi du même groupe
-- ne crée pas de doublon et ne casse pas la transaction.
-- Les triggers existants (owner, entity_version, validate) s'appliquent à
-- chaque insert dans la même transaction.
-- À tester d'abord en STAGING.
-- ════════════════════════════════════════════════════════
begin;

create or replace function public.csa_commit(events jsonb)
returns integer language plpgsql security definer set search_path = public as $fn$
declare e jsonb; my_agent text; n int := 0;
begin
  if jsonb_typeof(events) <> 'array' then
    raise exception 'csa_commit: events doit être un tableau JSON';
  end if;

  select p.agent_code into my_agent
    from public.csa_profiles p
   where p.user_id = auth.uid() and p.active;
  if my_agent is null then
    raise exception 'csa_commit: profil introuvable ou inactif';
  end if;

  for e in select * from jsonb_array_elements(events) loop
    if e->>'table_name' in ('patients','observations','pharma_stock','pharma_lots','pharma_inventaires','sevci_pvvih') then
      raise exception 'csa_commit: table mutable % interdite dans un commit de groupe', e->>'table_name';
    end if;
    if not public.csa_can_write(e->>'table_name') then
      raise exception 'csa_commit: écriture non autorisée sur %', e->>'table_name';
    end if;
    if coalesce(e->>'agent_id','') <> my_agent then
      raise exception 'csa_commit: agent_id usurpé (% attendu %)', e->>'agent_id', my_agent;
    end if;

    insert into public.csa_events
      (event_key, table_name, item_id, payload, agent_id, agent_nom, client_event_id)
    values (
      e->>'event_key',
      e->>'table_name',
      e->>'item_id',
      coalesce(e->'payload','{}'::jsonb),
      e->>'agent_id',
      e->>'agent_nom',
      nullif(e->>'client_event_id','')::uuid
    )
    on conflict (event_key) do nothing;

    n := n + 1;
  end loop;

  return n;
end; $fn$;

revoke all on function public.csa_commit(jsonb) from public;
grant execute on function public.csa_commit(jsonb) to authenticated;

commit;
