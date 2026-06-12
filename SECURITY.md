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

## MFA du Medecin-Chef

Deployer d'abord l'interface correspondante. A la connexion suivante, le
Medecin-Chef doit scanner le QR code dans une application TOTP puis valider un
code a six chiffres. Apres cette premiere validation, executer
`supabase/migrations/202606120003_require_chief_mfa.sql`. Les politiques RLS
refusent alors les donnees du chef tant que la session n'est pas au niveau
`aal2`.

## Correction des constantes historiques

Executer `supabase/migrations/202606120004_correct_historical_constantes.sql`.
La migration:

- conserve chaque payload original dans `csa_data_corrections`;
- neutralise uniquement les mesures hors bornes;
- recalcule l'IMC lorsque poids et taille sont plausibles;
- ajoute les motifs de correction au payload;
- peut etre relancee sans dupliquer le journal.

Le rapport de controle se trouve dans
`supabase/checks/historical_constantes_report.sql`.

## Controle des stocks pharmacie

Immediatement apres le deploiement de l'interface et avant toute nouvelle
operation pharmacie, executer
`supabase/migrations/202606120005_pharmacy_stock_controls.sql`. Cette migration:

- autorise les profils pharmacie et chef a synchroniser les lots, mouvements
  et inventaires;
- conserve les mouvements comme des evenements non modifiables;
- permet uniquement la mise a jour des lots et des inventaires;
- convertit le stock existant en lots historiques sans date de peremption.

Toute nouvelle entree exige un numero de lot et une date de peremption. Une
delivrance consomme d'abord le lot valide qui expire le plus tot. Un lot perime
ne peut pas etre delivre.

L'inventaire physique ne modifie jamais directement le stock. Les ecarts sont
justifies par le gestionnaire pharmacie, puis approuves ou rejetes par le
Medecin-Chef. Le rapport de controle se trouve dans
`supabase/checks/pharmacy_stock_controls_report.sql`.

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
