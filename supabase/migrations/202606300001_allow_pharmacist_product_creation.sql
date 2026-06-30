-- ════════════════════════════════════════════════════════
-- Création de produits par les pharmaciens (règle métier juin 2026)
-- Règle voulue : pharmaciens ET Médecin-Chef peuvent CRÉER un produit,
-- mais SEUL le Médecin-Chef (MFA/aal2) fixe/modifie les PRIX.
--
-- Avant : csa_protect_pharma_stock_insert rejetait TOUTE création hors chef
--         (raise 42501) -> les gestionnaires pharmacie ne pouvaient rien créer,
--         et une init de catalogue empilait des events bloqués (poison queue).
-- Après : la création hors chef est AUTORISÉE, mais les champs financiers sont
--         neutralisés à l'insertion (retirés du payload) -> le produit naît
--         "sans prix", le chef les fixe ensuite via la voie déjà protégée
--         (csa_protect_pharma_catalogue_fields, UPDATE = chef+aal2 only).
-- La protection des MODIFICATIONS de prix (UPDATE) reste inchangée.
-- ════════════════════════════════════════════════════════
begin;

create or replace function public.csa_protect_pharma_stock_insert()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- Hors Médecin-Chef MFA : on laisse créer le produit, mais on retire les
  -- champs financiers/pricing du payload (réservés au chef). Le chef, lui,
  -- garde la main complète.
  if new.table_name = 'pharma_stock'
     and auth.uid() is not null
     and not (public.csa_is_chief() and public.csa_chief_has_aal2()) then
    new.payload := new.payload
      - 'px_achat' - 'px_cession' - 'px_cmu' - 'px_na'
      - 'cmu_eligible' - 'cmu_markup_pct' - 'cmu_source';
  end if;
  return new;
end; $fn$;

commit;

-- Le trigger csa_events_protect_pharma_stock_insert pointe déjà sur cette
-- fonction : rien à recréer. Fonction de trigger -> pas de cache PostgREST à
-- recharger (effet immédiat).
