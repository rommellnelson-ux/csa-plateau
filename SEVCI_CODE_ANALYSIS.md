# SEVCI Module - Code Analysis & Extraction

## 📊 Module Statistics

- **File**: module_pvvih_CSA-GR-Plateau_v4.html
- **Size**: 1089 lines
- **Type**: Standalone HTML module (no external dependencies)
- **Theme**: PVVIH (HIV+) patient management
- **Target**: SEV-CI staff members only

## 🔍 Key Findings

### Data Structures Identified

**localStorage Keys** (patient/staff data):
- `pvvih_patients` — Main PVVIH patient registry
- `pvvih_staff` — SEV-CI staff roster
- `pvvih_settings` — Module configuration
- `pvvih_cv_results` — Viral load test results
- `pvvih_arv_regimens` — Current treatments
- `pvvih_indicators` — KPI tracking

**Main JavaScript Objects**:
- `patients[]` — Patient records with detailed fields
- `staff[]` — SEV-CI personnel with roles
- `indicators{}` — PEPFAR 95-95-95 metrics
- `cascade{}` — Care cascade stages
- `exports[]` — DSASA report data

### Functions to Extract (Phase 2)

**Core PVVIH Functions**:
- `loadPatients()` — Retrieve from localStorage
- `savePatient()` — Create/update patient record
- `calculateCascade()` — 95-95-95 cascade algorithm
- `getVLStatus()` — Viral load suppression classification
- `checkIIT()` — Identify treatment interruptions
- `generateDSASAReport()` — Export for compliance
- `filterPatientsByIVSA()` — Advanced disease screening
- `trackCVDue()` — Identify missing lab tests

**UI Functions**:
- `showView()` — Tab navigation
- `filterPatients()` — Search/sort
- `exportJSON()` — Data backup
- `importJSON()` — Data restore

### Data Fields per Patient Record

```javascript
{
  id: UUID,
  num_dossier: "CSA-2026-XXXXX",
  nom: string,
  ddn: date,
  sexe: "M"|"F",
  date_inclusion: date,
  regime_arv: string,
  cd4_initial: number,
  charge_virale_date: date,
  charge_virale_val: number,
  cv_supprimee_date: date,
  iit_status: "actif"|"interrompu"|"perdu",
  ivsa_stade: "stade1"|"stade2"|"stade3"|"stade4",
  vih_status: "positif confirmé",
  notes: string,
  created_at: timestamp,
  updated_at: timestamp
}
```

### CSS Classes to Refactor

**Status badges**:
- `.b-actif` — Active in care
- `.b-pdv` — Lost to follow-up
- `.b-rdv` — Missed appointment
- `.b-transf` — Transfer case
- `.b-nonsupp` — Non-suppressed VL
- `.b-ivsa` — Advanced disease

**Chart/Visual components**:
- `.cascade` — Cascade visualization
- `.kpi` — Key performance indicators
- `.progress-mini` — Progress bars
- `.alert-box` — Warning/info messages

---

## 🛠️ Integration Requirements

### Phase 1: Supabase Tables (Required)

```sql
-- Main PVVIH patients table
CREATE TABLE sevci_pvvih_patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  num_dossier TEXT UNIQUE NOT NULL,
  date_inclusion DATE NOT NULL,
  regime_arv TEXT,
  cd4_initial INTEGER,
  charge_virale_date DATE,
  charge_virale_val INTEGER,
  cv_supprimee_date DATE,
  iit_status TEXT CHECK (iit_status IN ('actif','interrompu','perdu')),
  ivsa_stade TEXT CHECK (ivsa_stade IN ('stade1','stade2','stade3','stade4')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  encrypted_data TEXT -- For SecureStorage
);

-- SEVCI staff roster
CREATE TABLE sevci_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code_staff TEXT UNIQUE NOT NULL,
  fonction TEXT NOT NULL,
  site TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE sevci_pvvih_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sevci_staff ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "SEVCI staff view own patients"
  ON sevci_pvvih_patients
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sevci_staff
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "SEVCI staff create patient records"
  ON sevci_pvvih_patients
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sevci_staff
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "SEVCI staff update own records"
  ON sevci_pvvih_patients
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sevci_staff
      WHERE user_id = auth.uid() AND active = true
    )
  );
```

### Phase 2: CSA Integration Code

**In index.html navigation**:
```javascript
// Add to PERMISSION_TABS
PERMISSION_TABS['sevci'] = ['sevci-dashboard', 'sevci-patients', 'sevci-cv', 'sevci-reports'];

// Add to module list
const MODULES = [..., 'sevci'];
```

**New view structure**:
```javascript
// views/sevci.js - Extract & adapt SEVCI logic
const VIEW_SEVCI = {
  dashboard: () => renderSEVCIDashboard(),
  patients: () => renderSEVCIPatients(),
  cv: () => renderSEVCIChargeVirale(),
  reports: () => renderSEVCIReports()
};
```

### Phase 3: Data Migration Path

**Option 1**: Keep JSON import/export (existing)
```javascript
// User uploads JSON with SEVCI patient data
// System creates sevci_pvvih_patients records
// Stores encrypted in SecureStorage
```

**Option 2**: Direct Supabase sync
```javascript
// Connect to sevci_pvvih_patients table
// Real-time sync with encryption
// Audit trail per patient access
```

---

## 🔐 Security Considerations

### Data Sensitivity
- **PVVIH patient data**: HIGH (PHI/HIPAA)
- **Viral load results**: HIGH (medical records)
- **Staff roster**: MEDIUM (personnel)

### Required Protections
1. ✅ Encryption in transit (HTTPS)
2. ✅ Encryption at rest (SecureStorage)
3. ✅ RLS isolation (SEVCI staff only)
4. ✅ Audit trail (all access logged)
5. ✅ MFA for sensitive operations
6. ✅ CSP header (no external scripts)

### Compliance Requirements
- DSASA/WHO reporting standards
- Patient consent for data tracking
- Staff access audit trail
- Data retention per policy
- Export restrictions

---

## 📈 Integration Complexity

**Code Quality**: ⭐⭐⭐⭐ (Well-structured, clean)  
**Dependencies**: ⭐⭐⭐⭐⭐ (None! Self-contained)  
**Complexity**: MEDIUM (12 sections, ~20 functions)  
**Effort**: 3-4 hours for Option C integration

---

## ✅ Recommended Next Steps

1. **Extract JavaScript** into `js/views/sevci.js`
2. **Map data fields** to Supabase schema
3. **Integrate SecureStorage** for SEVCI data
4. **Create RLS policies** for SEVCI role
5. **Add to CSA navbar** as 'sevci' module
6. **Test with sample data** (100 patients)
7. **Deploy to staging** before production

---

## 📦 Deliverables (This Session)

- [x] SEVCI_INTEGRATION_PLAN.md (comprehensive)
- [x] SEVCI_CODE_ANALYSIS.md (this file)
- [ ] Supabase migration SQL (generating...)
- [ ] js/views/sevci.js (generating...)
- [ ] SEVCI test data (generating...)

