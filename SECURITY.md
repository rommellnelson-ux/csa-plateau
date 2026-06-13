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

## Registre pharmacie fevrier-juin 2026

Apres le controle des stocks, executer
`supabase/migrations/202606130006_import_pharma_history.sql`. La migration
importe en lecture seule:

- 133 references documentaires;
- 222 alias de produits;
- 712 lignes du registre, pour un total de 1 492 710,748 FCFA;
- 152 composants de kits, avec un montant composant fixe a zero.

Ces donnees sont reservees au Medecin-Chef avec MFA. Elles n'affectent ni le
stock courant, ni les lots, ni les ventes, ni les patients. La migration peut
etre relancee: les cles d'evenement empechent les doublons.

Executer ensuite `supabase/checks/pharma_history_import_report.sql`. Le rapport
doit confirmer 712 lignes, 152 composants, aucun composant sans produit et un
montant total de 1 492 710,748 FCFA.

## Catalogue pharmacie operationnel V4

Executer ensuite
`supabase/migrations/202606130007_import_current_pharma_catalogue.sql`.
Cette migration:

- archive les 42 produits et leurs lots precharges pour la demonstration;
- cree 125 references actives issues de `Base_Pharmaceutique_CSA_V4.xlsx`,
  dont 103 medicaments et 22 consommables;
- initialise tous les stocks, seuils et prix a zero;
- conserve les anciennes lignes et mouvements a des fins d'audit;
- reserve techniquement le registre historique au seul Medecin-Chef avec MFA.

Les quantites, numeros de lot, dates de peremption, fournisseurs et prix ne
doivent pas etre deduits du registre historique. Ils doivent etre saisis apres
inventaire physique et validation des tarifs. La migration est relancable sans
ecraser les saisies operationnelles ulterieures.

Executer enfin `supabase/checks/current_pharma_catalogue_report.sql`. Le premier
resultat doit indiquer 125 references actives, 42 produits de demonstration
archives, un stock initial nul et 125 prix a valider.

## Metadonnees et controle financier pharmacie

Executer
`supabase/migrations/202606130008_enrich_pharma_catalogue_financial.sql`
apres la migration 007. Elle complete les 125 references avec le code produit,
le dosage, la forme, le conditionnement, l'eligibilite CMU initiale et la
quantite historique de reference.

La quantite historique de reference correspond aux sorties documentees de
fevrier a juin 2026. Elle aide a preparer l'inventaire mais ne remplace jamais
le comptage physique ni le stock operationnel.

Les gestionnaires pharmacie voient les donnees techniques et les quantites,
mais aucune valorisation financiere du stock. Seul le Medecin-Chef avec MFA
peut saisir et consulter:

- le prix d'acquisition;
- l'eligibilite CMU;
- le tarif de vente CMU;
- le tarif de vente hors CMU;
- les marges unitaires et la valeur financiere du stock.

Pour un patient CMU, un produit marque non eligible CMU est facture au tarif
hors CMU. Executer ensuite
`supabase/checks/pharma_catalogue_financial_report.sql`.

## Coherence du referentiel pharmacie et codes EAN

Executer
`supabase/migrations/202606130009_normalize_pharma_catalogue_ean.sql`
apres la migration 008. Cette migration harmonise les formes galeniques et les
conditionnements, puis ajoute le champ EAN sans modifier les stocks, les lots
ou les prix.

Le code EAN, le dosage, la forme et le conditionnement sont modifiables
uniquement depuis l'espace Medecin-Chef. Un EAN renseigne doit comporter 8, 12,
13 ou 14 chiffres, avoir une cle de controle valide et ne pas etre affecte a
deux produits differents.

Un declencheur PostgreSQL protege egalement les metadonnees du catalogue, les
prix, l'eligibilite CMU et les seuils contre toute modification par un compte
pharmacie. Le compte pharmacie conserve le droit de saisir les mouvements, les
lots et les quantites de stock.

Executer ensuite
`supabase/checks/pharma_catalogue_coherence_report.sql`.

## Parametrage technique par les gestionnaires pharmacie

Executer
`supabase/migrations/202606130010_allow_pharmacy_catalogue_metadata.sql`
apres la migration 009.

Les gestionnaires pharmacie peuvent alors modifier uniquement:

- le code interne;
- le nom du produit;
- le code EAN;
- le dosage;
- la forme galenique;
- le conditionnement.

Ils peuvent consulter les prix de vente CMU et hors CMU necessaires a la
delivrance. Le prix d'acquisition, les marges, la valeur financiere du stock,
l'eligibilite CMU, les seuils et les classifications restent reserves au
Medecin-Chef avec MFA.

Executer ensuite
`supabase/checks/pharmacy_catalogue_editor_report.sql`.
