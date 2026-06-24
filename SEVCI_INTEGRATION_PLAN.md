# Plan d'intégration du Module SEVCI/PVVIH

**Module Source**: `module_pvvih_CSA-GR-Plateau_v4.html` (1089 lignes)  
**Type**: Module spécialisé pour personnel SEVCI (Suivi PVVIH)  
**Cible**: Intégration dans CSA Plateau v2.1  
**Status**: ANALYSE EN COURS

---

## 📊 Analyse du module source

### Caractéristiques identifiées
- **Theme**: Suivi des Personnes Vivant avec le VIH (PVVIH)
- **Sections**: 12+ onglets de gestion
- **Design**: CSS standalone (pas de dépendances externes)
- **Data**: JSON local + localStorage
- **Personnel**: SEV-CI, AEMCI (code site 01649)

### Sections principales
1. **Revue de performance** — KPIs 95-95-95
2. **File active** — Liste patients PVVIH
3. **Dossier patient** — Historique/ARV/suivi
4. **Charge virale** — Résultats CV
5. **IIT & RDV manqués** — Interruptions traitement
6. **IVSA** — Stade avancé
7. **Indicateurs/Cibles** — PEPFAR metrics
8. **Personnels SEV-CI** — Staff management
9. **Réunions EACQ** — Coordination
10. **Suggestions & IEC** — Feedback
11. **Qualité & éval** — QA
12. **Rapport DSASA** — Export

---

## 🏗️ Stratégie d'intégration

### Option A: Module indépendant (Quickest)
```
✓ Ajouter SEVCI comme 7ème module dans permissions CSA
✓ Garder HTML/CSS/JS standalone
✓ Intégrer dans RLS Supabase pour SEVCI staff uniquement
✓ Temps: 2-3 heures
✓ Risque: Faible (zéro impact sur modules existants)
```

### Option B: Intégration complète (Best practice)
```
✓ Extraire composants réutilisables
✓ Utiliser SecureStorage CSA existant
✓ Refactoriser CSS dans globals
✓ Unifier schema BD Supabase
✓ Temps: 6-8 heures
✓ Risque: Moyen (nécessite refactor)
```

### Option C: Fusion progressive (Balanced)
```
✓ Ajouter SEVCI module v1 (standalone)
✓ Refactoriser progressivement
✓ Migrer composants au fur à mesure
✓ Temps: 4-5 heures (phase 1)
✓ Risque: Faible (itératif)
```

---

## 📋 Tâches d'intégration

### Phase 1: Setup (30-45 min)

- [ ] Créer table `sevci_pvvih_patients` dans Supabase
- [ ] Créer table `sevci_staff` pour personnels SEV-CI
- [ ] Ajouter RLS policies pour SEVCI role
- [ ] Créer migration SQL pour schema SEVCI
- [ ] Ajouter permission 'sevci' aux profils utilisateurs

### Phase 2: Module intégration (1-2 heures)

- [ ] Extraire JS du module dans `js/views/sevci.js`
- [ ] Intégrer SecureStorage CSA (replace localStorage)
- [ ] Ajouter onglet 'sevci' dans nav CSA
- [ ] Mapper data SEVCI → Supabase tables
- [ ] Implémenter audit logging pour SEVCI actions

### Phase 3: Sécurité (30 min)

- [ ] Vérifier SEVCI staff permissions RLS
- [ ] Tester CSP pour SEVCI resources
- [ ] Valider encryption localStorage SEVCI data
- [ ] Audit trail pour PVVIH patients (HIPAA)

### Phase 4: Tests (1 heure)

- [ ] Tests unitaires fonctionnalités clés
- [ ] Test RLS isolation (SEVCI ne voit que ses patients)
- [ ] Test performance avec 5000+ patients PVVIH
- [ ] Test responsiveness mobile

### Phase 5: Documentation (30 min)

- [ ] Update SECURITY.md avec SEVCI data handling
- [ ] Create SEVCI_MODULE.md user guide
- [ ] Add SEVCI to staff procedures
- [ ] Update architecture docs

---

## 💾 Schema Supabase requis

```sql
-- SEVCI Patients table
create table sevci_pvvih_patients (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid references patients(id) on delete cascade,
  num_dossier text unique not null,
  date_inclusion date not null,
  regime_arv text,
  charge_virale_date date,
  charge_virale_val integer,
  cv_supprimee_date date,
  iit_status text,
  ivsa_stade text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- SEVCI Staff table
create table sevci_staff (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  code_staff text unique,
  fonction text,
  site text,
  created_at timestamptz default now()
);

-- Enable RLS
alter table sevci_pvvih_patients enable row level security;
alter table sevci_staff enable row level security;

-- SEVCI role can see own patients + staff
create policy "SEVCI access own patients"
  on sevci_pvvih_patients for select
  using (
    exists (
      select 1 from sevci_staff 
      where user_id = auth.uid()
    )
  );
```

---

## 🔐 Security Considerations

### Data Protection
- ✓ All SEVCI data encrypted in localStorage (existing SecureStorage)
- ✓ Patient lists protected by RLS
- ✓ HIPAA audit trail for PVVIH patient access
- ✓ Staff credentials in auth.users only

### Access Control
- ✓ SEVCI module visible only to sevci role
- ✓ SEVCI staff can only see their own site patients
- ✓ Read-only mode for non-SEVCI staff viewing PVVIH referrals
- ✓ MFA required for sensitive operations (CV entry, etc.)

### Compliance
- ✓ Patient consent log for PVVIH follow-up
- ✓ Audit log for all data modifications
- ✓ Export restricted to authorized staff only
- ✓ Data retention per DSASA standards

---

## 📈 Recommended Approach: Option C (Balanced)

### Timeline
1. **Today**: Setup Supabase tables + RLS (30 min)
2. **Today**: Extract & integrate SEVCI JS (1 hour)
3. **Tomorrow**: Security audit + tests (1.5 hours)
4. **Tomorrow**: Documentation (30 min)
5. **Total**: ~3.5 hours over 2 days

### Deliverables
- ✓ SEVCI module in CSA Plateau
- ✓ Supabase tables with RLS
- ✓ Encrypted PVVIH data
- ✓ Audit trail + compliance
- ✓ Staff documentation
- ✓ Zero breaking changes to CSA

---

## ⚠️ Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| RLS misconfiguration | SEVCI sees all patients | Strict RLS test before deploy |
| Performance (5K patients) | Slow list loading | Pagination + lazy loading |
| Data conflicts | PVVIH + regular patient overlap | Separate tables + clear schema |
| CSP violations | SEVCI resources blocked | Add SEVCI assets to CSP whitelist |
| Staff access creep | Other staff see PVVIH data | Regular RLS audit + monitoring |

---

## 🎯 Decision Required

**Which approach?**

- [ ] A) Quick standalone (safest, fastest)
- [x] C) Balanced integration (recommended)
- [ ] B) Full integration (best final result, more effort)

**Proceed with**: Option C (unless otherwise specified)

---

**Next Step**: Execute Phase 1 - Supabase schema setup

