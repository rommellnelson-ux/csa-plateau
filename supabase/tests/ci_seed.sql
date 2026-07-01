-- ════════════════════════════════════════════════════════
-- Seed CI — un compte Médecin-Chef de test à UUID fixe.
-- Le runner substitue REMPLACER_UUID_CHEF par cet UUID dans les fichiers de test.
-- Exécuté en tant que superuser -> RLS contournée pour l'insert.
-- ════════════════════════════════════════════════════════

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'chef-ci@example.test')
on conflict (id) do nothing;

insert into public.csa_profiles
  (user_id, agent_code, display_name, job_title, module, is_chef, active, permissions)
values
  ('00000000-0000-0000-0000-000000000001', 'CHEF_CI', 'Chef CI', 'Médecin-Chef',
   'chef', true, true, '{chef}')
on conflict (user_id) do nothing;
