# Module SEVCI / PVVIH — état réel et travail restant

## Contexte

Le fichier source `module_pvvih_CSA-GR-Plateau_v4.html` (≈1089 lignes) est une
maquette **autonome** (HTML/CSS/JS, sans dépendance externe) pour le suivi des
PVVIH par le personnel SEV-CI : revue de performance (95-95-95), file active,
charge virale, IIT/RDV manqués, IVSA, indicateurs, rapport DSASA, etc.

## Contrainte d'architecture (important)

L'application déployée (`index.html`) est **monolithique** et **event-sourced** :

- toutes les données transitent par la table Supabase `csa_events`
  (colonne `table_name` + payload JSON), synchronisée depuis le localStorage ;
- il **n'existe pas** de tables métier dédiées (`patients`, etc.) ;
- les droits sont portés par `csa_profiles.permissions[]` et appliqués via
  les fonctions `csa_can_read(table_name)` / `csa_can_write(table_name)`.

Toute intégration SEVCI doit suivre ce modèle — pas de tables séparées, pas de
fichiers `js/views/` (l'appli n'est pas modulaire).

## Ce qui est livré ici

- **`supabase/migrations/202606240001_add_sevci_pvvih_module.sql`**
  Accorde au rôle `sevci` l'accès lecture/écriture aux nouveaux `table_name`
  `sevci_pvvih` et `sevci_staff`, en recréant `csa_can_read/write` à l'identique
  des branches existantes. **Non testé en base** — à valider en staging.
- **`SEVCI_SAMPLE_DATA.json`** — jeu d'exemple illustratif. À interpréter comme
  des *payloads* d'événements `table_name='sevci_pvvih'` / `'sevci_staff'`, et
  non comme des lignes de tables dédiées (les IDs y sont fictifs).

## Ce qui reste à faire (non commencé)

1. **UI dans `index.html`** : ajouter un onglet `sevci` (gardé par la
   permission), et les vues file active / dossier / charge virale / indicateurs
   en réutilisant `DB.get/set('sevci_pvvih')`, `escHtml`, `logAudit`, le système
   de sync existant. À intégrer dans le monolithe, pas dans un fichier séparé.
2. **Enregistrement du rôle** : ajouter `sevci` à la liste des permissions/onglets
   côté front (table `PERMISSION_TABS` / labels).
3. **MFA** : décider si l'accès PVVIH exige une session aal2 (recommandé vu la
   sensibilité), et le cas échéant l'ajouter dans la migration.
4. **Tests réels** : exécuter la migration en staging, vérifier l'isolation RLS
   (un agent `sevci` ne voit pas pharma/compta, et inversement), puis valider
   l'UI dans un navigateur.

Aucune de ces étapes n'est faite ni testée à ce jour. Ce README remplace des
documents antérieurs qui décrivaient à tort une architecture à tables séparées
et un module JS « déjà généré et commité » qui n'existait pas.
