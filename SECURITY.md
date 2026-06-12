# Securite et mise en production

L'application utilise Supabase Auth. Aucun compte, PIN ou mot de passe ne doit etre
ajoute au code source.

## Activation obligatoire

1. Dans Supabase, executer la migration
   `supabase/migrations/202606120001_secure_csa.sql` avec le SQL Editor.
2. Dans Authentication, desactiver les inscriptions publiques.
3. Creer chaque utilisateur dans Authentication > Users avec un mot de passe fort.
4. Associer chaque UUID Auth a un profil:

```sql
insert into public.csa_profiles
  (user_id, agent_code, display_name, job_title, module, permissions, building, is_chef)
values
  ('UUID_AUTH', 'MED', 'Medecin-Chef', 'Medecin-Chef / Commandant',
   'chef', array['chef'], null, true);
```

Modules autorises: `accueil`, `soins`, `labo`, `pharmacie`, `compta`, `chef`.

Permissions cumulables: `accueil`, `as`, `soins`, `labo`, `pharmacie`,
`compta`, `chef`. Exemple infirmier gestionnaire de pharmacie:

```sql
permissions = array['soins','pharmacie']
```

La permission `as` donne acces a l'accueil patient, aux constantes et a la file
du jour, sans ouvrir les consultations ni les fonctions financieres.

## Verification

La requete anonyme suivante doit retourner `401` ou un tableau vide:

```text
GET /rest/v1/csa_events?select=event_key&limit=1
```

Ne jamais placer une cle `service_role` dans GitHub Pages. La cle publishable
presente dans le navigateur est normale uniquement lorsque RLS est active.

## Donnees historiques

Les anciennes lignes restent lisibles apres authentification selon le role.
Lorsqu'une ligne est modifiee, le trigger lui attribue automatiquement le compte
connecte. Faire une sauvegarde Supabase avant la migration.
