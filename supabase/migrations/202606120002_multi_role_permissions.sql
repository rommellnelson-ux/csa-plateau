begin;

alter table public.csa_profiles
  add column if not exists permissions text[] not null default '{}';

update public.csa_profiles
set permissions = array[module]
where cardinality(permissions) = 0;

alter table public.csa_profiles
  drop constraint if exists csa_profiles_permissions_check;

alter table public.csa_profiles
  add constraint csa_profiles_permissions_check
  check (
    permissions <@ array['accueil','as','soins','labo','pharmacie','compta','chef']::text[]
    and cardinality(permissions) > 0
  );

create or replace function public.csa_can_read(target_table text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.csa_profiles p
    where p.user_id = auth.uid()
      and p.active
      and (
        p.is_chef
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes'))
        or ('soins' = any(p.permissions) and target_table in ('patients','consultations','constantes','soins','observations'))
        or ('labo' = any(p.permissions) and target_table in ('patients','consultations','labo_actes'))
        or ('pharmacie' = any(p.permissions) and target_table in ('patients','consultations','pharma_ventes','pharma_stock'))
        or ('compta' = any(p.permissions) and target_table in ('transactions','clotures','audit_logs'))
      )
  )
$$;

create or replace function public.csa_can_write(target_table text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.csa_profiles p
    where p.user_id = auth.uid()
      and p.active
      and (
        p.is_chef
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes','transactions','audit_logs'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes','transactions','audit_logs'))
        or ('soins' = any(p.permissions) and target_table in ('soins','observations','transactions','audit_logs'))
        or ('labo' = any(p.permissions) and target_table in ('labo_actes','transactions','audit_logs'))
        or ('pharmacie' = any(p.permissions) and target_table in ('pharma_ventes','pharma_stock','transactions','audit_logs'))
        or ('compta' = any(p.permissions) and target_table in ('clotures','audit_logs'))
      )
  )
$$;

commit;
