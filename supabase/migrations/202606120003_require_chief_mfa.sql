begin;

create or replace function public.csa_chief_has_aal2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
$$;

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
        (p.is_chef and public.csa_chief_has_aal2())
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
        (p.is_chef and public.csa_chief_has_aal2())
        or ('accueil' = any(p.permissions) and target_table in ('patients','consultations','constantes','transactions','audit_logs'))
        or ('as' = any(p.permissions) and target_table in ('patients','constantes','transactions','audit_logs'))
        or ('soins' = any(p.permissions) and target_table in ('soins','observations','transactions','audit_logs'))
        or ('labo' = any(p.permissions) and target_table in ('labo_actes','transactions','audit_logs'))
        or ('pharmacie' = any(p.permissions) and target_table in ('pharma_ventes','pharma_stock','transactions','audit_logs'))
        or ('compta' = any(p.permissions) and target_table in ('clotures','audit_logs'))
      )
  )
$$;

revoke all on function public.csa_chief_has_aal2() from public;
grant execute on function public.csa_chief_has_aal2() to authenticated;

commit;
