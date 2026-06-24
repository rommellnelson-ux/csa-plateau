# Module SEVCI / PVVIH

Suivi des PVVIH par l'équipe SEV-CI, intégré dans `index.html` sur le modèle
des modules existants (soins, pharmacie). Branche : `feat/sevci-pvvih`.

## Les 3 rôles (+ médecin-chef)

| Rôle | module / permission | Onglets | Fait quoi |
|------|--------------------|---------|-----------|
| Médiatrice communautaire | `sevci` / `sevci_med` | Action communautaire, Actions | Saisit les actions terrain : visites, recherche de perdus de vue, rappels RDV, soutien observance |
| Moniteur de données | `sevci` / `sevci_data` | File active, Charge virale, Indicateurs | Saisit/maintient les dossiers PVVIH et les charges virales ; voit la cascade 95-95-95 |
| Superviseur | `sevci` / `sevci_sup` | Supervision, Actions, File active, Rapport DSASA | Contrôle le travail de l'équipe, corrige, exporte le rapport DSASA |
| Médecin-chef | `chef` (MFA) | onglet **Synthèse PVVIH** | Voit la synthèse consolidée (KPIs, cascade, activité par agent) |

## Données (event-sourced via `csa_events`)

- `sevci_pvvih` — un enregistrement par patient : n° dossier, nom, sexe, date
  d'inclusion, régime ARV, CD4 initial, statut (actif/interrompu/perdu),
  stade IVSA, dernière charge virale + date de suppression.
- `sevci_actions` — une ligne par action communautaire.

Ajoutés à `SYNC_TABLES` → synchronisés comme les autres données.

## Mise en service

1. Exécuter `supabase/migrations/202606240001_add_sevci_pvvih_module.sql`
   (étend les fonctions RLS `csa_can_read/write` pour les 3 permissions).
2. Créer 3 utilisateurs dans Supabase Auth, puis 3 profils `csa_profiles`
   avec `module='sevci'` et la permission correspondante (exemple SQL en
   commentaire dans la migration).
3. Le médecin-chef voit automatiquement l'onglet « Synthèse PVVIH ».

## ⚠️ État de test

Code écrit sur la branche `feat/sevci-pvvih`, **non fusionné dans main**.
Vérifié ici : équilibrage des accolades/parenthèses + présence d'une vue pour
chaque onglet. **Non vérifié** : exécution réelle en navigateur et migration en
base (pas d'outil disponible côté assistant). À tester avant merge :
- ouvrir l'appli, se connecter avec chaque profil, saisir un dossier + une CV +
  une action, vérifier les listes et la synthèse chef ;
- exécuter la migration en staging et vérifier l'isolation RLS.

## Pistes suivantes (non faites)

- Édition d'un dossier existant depuis la file active (actuellement : ajout +
  mise à jour CV ; pas de formulaire d'édition complet).
- Historique des charges virales par patient.
- MFA (aal2) pour les rôles sevci vu la sensibilité des données.
