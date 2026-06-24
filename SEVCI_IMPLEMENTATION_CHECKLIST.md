# SEVCI/PVVIH Module - Implementation Checklist

**Status**: Ready for Option C Integration  
**Timeline**: 3.5-4 hours  
**Deliverables Generated**: 6 files  

---

## ✅ Phase 1: Analysis & Planning (COMPLETED)

- [x] **SEVCI_INTEGRATION_PLAN.md** — 3 options, timeline, risks
- [x] **SEVCI_CODE_ANALYSIS.md** — Code structure, functions, data fields
- [x] **SEVCI_SAMPLE_DATA.json** — Test data (3 staff, 3 patients, indicators)
- [x] **202606240001_add_sevci_pvvih_module.sql** — Supabase migration with RLS

**Deliverables**: 4/6 complete

---

## 📋 Phase 2: Integration Implementation (NEXT)

### Step 1: CSA Module Registration (30 min)

**File**: `index.html`

Add to navigation tabs:
```html
<button class="tab" data-v="sevci">PVVIH (SEV-CI)</button>
```

Add to module config:
```javascript
PERMISSION_TABS['sevci'] = ['sevci-dashboard', 'sevci-patients', 'sevci-cv', 'sevci-reports', 'sevci-export'];

const SEVCI_VIEWS = {
  'sevci-dashboard': 'Revue de performance',
  'sevci-patients': 'File active',
  'sevci-cv': 'Charge virale',
  'sevci-reports': 'Indicateurs',
  'sevci-export': 'Rapport DSASA'
};
```

### Step 2: Supabase Setup (15 min)

1. Run migration in Supabase SQL Editor:
   - `supabase/migrations/202606240001_add_sevci_pvvih_module.sql`

2. Update `csa_profiles` table:
   ```sql
   UPDATE public.csa_profiles 
   SET permissions = array_append(permissions, 'sevci')
   WHERE agent_code = 'SEVCI_STAFF_CODE';
   ```

3. Create test staff record:
   ```sql
   INSERT INTO public.sevci_staff (user_id, code_staff, fonction, site)
   VALUES ('test-user-uuid', 'DR-TEST-001', 'Médecin Test', '01649');
   ```

### Step 3: Module JavaScript (1.5-2 hours)

**File**: `js/views/sevci.js` (to be created)

**Core functions needed**:

```javascript
// ════ DATA MANAGEMENT ════
function loadSEVCIPatients() { /* from DB */ }
function saveSEVCIPatient(patient) { /* to DB */ }
function updateVLStatus(patientId, vlValue) { /* update iit/suppression */ }

// ════ DASHBOARD ════
function renderSEVCIDashboard() { /* KPIs + cascade */ }
function calculateCascade95_95_95() { /* PEPFAR metrics */ }
function generateAlerts() { /* IIT + CV due */ }

// ════ PATIENT MANAGEMENT ════
function renderSEVCIPatientList() { /* list + filters */ }
function showPatientDetail(patientId) { /* full record */ }
function editPatient(patientId) { /* form modal */ }

// ════ CHARGE VIRALE ════
function renderVLResults() { /* table view */ }
function markCVSuppressed(patientId, date) { /* update */ }
function identifyNonSuppressed() { /* filter */ }

// ════ REPORTING ════
function generateDSASAReport() { /* export compliance */ }
function exportPatientList() { /* CSV/Excel */ }

// ════ SECURITY/AUDIT ════
function logSEVCIAction(action, patientId) { /* audit trail */ }
function checkSEVCIPermission() { /* RLS check */ }
```

### Step 4: CSS Integration (20 min)

Add to `index.html` `<style>`:
```css
/* SEVCI-specific overrides */
.sevci-nav { /* Module-specific nav styling */ }
.sevci-kpi { /* PVVIH KPI cards */ }
.sevci-status-actif { color: #2f7d56; }
.sevci-status-interrompu { color: #a83232; }
.sevci-cascade-bar { /* 95-95-95 visualization */ }
```

### Step 5: Data Integration (1 hour)

Replace localStorage with Supabase:
```javascript
// Before (module standalone)
const patients = JSON.parse(localStorage.getItem('pvvih_patients'));

// After (CSA integrated)
const patients = await DB.get('sevci_pvvih_patients');
```

---

## 🧪 Phase 3: Testing (1-1.5 hours)

### Unit Tests
- [ ] Load SEVCI patients from Supabase
- [ ] Save new patient record
- [ ] Calculate 95-95-95 cascade
- [ ] Identify non-suppressed VL
- [ ] Generate DSASA report
- [ ] Audit logging works

### Integration Tests
- [ ] SEVCI role sees module in nav
- [ ] Non-SEVCI staff cannot access
- [ ] RLS isolation verified
- [ ] Encryption in localStorage
- [ ] CSP allows SEVCI assets

### Performance Tests
- [ ] Load 500+ patients in <2 sec
- [ ] Dashboard renders in <1 sec
- [ ] Export 100 patients in <5 sec

### Security Tests
- [ ] MFA required for exports
- [ ] Audit trail complete
- [ ] Data encrypted at rest
- [ ] CSP violations logged

---

## 📋 Phase 4: Deployment Prep (30 min)

### Pre-deployment
- [ ] Create staging environment
- [ ] Load sample data
- [ ] Run full test suite
- [ ] Security review
- [ ] Performance baseline

### Deployment
- [ ] Push Supabase migration
- [ ] Deploy CSA code change
- [ ] Verify RLS policies
- [ ] Create SEVCI staff user
- [ ] Train staff on module

### Post-deployment
- [ ] Monitor error logs
- [ ] Check performance metrics
- [ ] Verify RLS isolation
- [ ] Audit log growing
- [ ] 24-hour stability check

---

## 📊 Metrics & Monitoring

### KPIs to Track
- **TX_CURR**: Active patients on treatment
- **TX_NEW**: New patient inclusions (quarterly)
- **TX_PVLS**: Viral load suppression rate
- **IIT**: Treatment interruption rate
- **IVSA**: Advanced disease cases

### Performance Metrics
- Page load time: <1 sec
- Dashboard render: <1 sec
- Patient search: <500ms
- Export: <5 sec for 100 patients
- Audit logs: <100ms per action

### Security Metrics
- RLS policy violations: 0
- CSP violations: 0
- Unauthorized access attempts: 0
- Data encryption: 100%

---

## 📦 Files Generated This Session

```
✓ SEVCI_INTEGRATION_PLAN.md
✓ SEVCI_CODE_ANALYSIS.md
✓ SEVCI_SAMPLE_DATA.json
✓ 202606240001_add_sevci_pvvih_module.sql
✓ SEVCI_IMPLEMENTATION_CHECKLIST.md
△ js/views/sevci.js (template ready)
△ SEVCI_MODULE_README.md (to create)
```

---

## 🚀 Next Action Items

### Immediate (Today)
1. Review this checklist
2. Confirm Supabase credentials
3. Choose: Full automation OR step-by-step guidance?

### Short-term (Next 2 days)
1. Run Supabase migration
2. Create SEVCI test staff
3. Implement js/views/sevci.js
4. Test with sample data
5. Deploy to staging

### Medium-term (Next week)
1. Train SEVCI staff
2. Load real patient data
3. Monitor KPIs
4. Gather feedback
5. Optimize performance

---

## 💬 Decision Point

**Do you want me to:**

**Option A**: Auto-generate `js/views/sevci.js` right now  
→ I create the full JavaScript module ready to use

**Option B**: Create detailed implementation guide  
→ You implement step-by-step with my guidance

**Option C**: Wait for Supabase credentials  
→ Confirm config details first, then proceed

**Your preference?** 🤔

