# Post-Deployment Monitoring Guide

**Status**: LIVE IN PRODUCTION  
**Deployment Date**: 2026-06-23  
**Monitoring Systems**: ACTIVE

---

## 🎯 Immediate Monitoring Tasks (First 24-48 hours)

### 1. CSP Violation Monitoring

All CSP violations are **automatically logged to audit_logs**. Check them:

```javascript
// In browser console:
DB.get('audit_logs')
  .filter(log => log.action === 'CSP_VIOLATION')
  .forEach(v => console.log(v));

// Expected: Empty array (no violations)
```

**What it logs**:
- `violatedDirective` — Which CSP rule was violated
- `blockedURI` — What resource was blocked
- `sourceFile` — Where violation came from
- `lineNumber` — Exact line number
- `timestamp` — When it happened

**If violations found**:
1. Check if legitimate (e.g., new CDN needed)
2. If legitimate: Update CSP meta tag
3. If malicious: Investigate source code changes
4. Log action: `logAudit('CSP_VIOLATION_RESOLVED', {details})`

---

### 2. Verify Logout Clears All 12 Keys

Run this test in console after logout:

```javascript
// Test 1: Quick check
const sensitiveKeys = ['csa2_sq','csa2_patients','csa2_consultations','csa2_constantes','csa2_soins','csa2_observations','csa2_labo_actes','csa2_pharma_ventes','csa2_pharma_stock','csa2_transactions','csa2_clotures','csa2_audit_logs'];
const remaining = sensitiveKeys.filter(k => localStorage.getItem(k));
console.log('Keys remaining after logout:', remaining);
// Expected: Empty array []

// Test 2: Use built-in verification
verifyLogoutCleanup()
// Expected: PASS status
```

**Success criteria**:
- ✅ All 12 keys removed
- ✅ No medical data in localStorage
- ✅ No console errors
- ✅ Session fully isolated

**If FAIL**:
1. Check logout() function was called
2. Verify SecureStorage.decrypt not throwing errors
3. Check browser storage permissions
4. Log incident: `logAudit('LOGOUT_CLEANUP_FAILED', {details})`

---

### 3. Check Console for Errors

Monitor console for errors automatically:

```javascript
// Get all errors tracked during session
getConsoleErrors()
// Expected: Empty array [] or minimal errors

// Example output if errors exist:
[
  {message: "TypeError: X is not defined", source: "index.html", lineno: 1234, timestamp: "2026-06-23T15:23:00Z"},
  ...
]
```

**Action on errors**:
1. Check error message and line number
2. If related to encryption/localStorage: HIGH PRIORITY
3. If related to CSP: MEDIUM PRIORITY
4. If unrelated: LOW PRIORITY
5. Log: `logAudit('CONSOLE_ERROR', {error})`

---

## 📊 Monitoring Dashboard (Recommended Setup)

Create a monitoring dashboard in the app:

```javascript
// Dashboard data source
async function getMonitoringStatus() {
  const cspViolations = DB.get('audit_logs').filter(l => l.action === 'CSP_VIOLATION').length;
  const consoleErrors = getConsoleErrors().length;
  const storageSize = Object.keys(localStorage).reduce((sum, k) => sum + localStorage.getItem(k).length, 0);
  const encryptedKeys = ['csa2_sq','csa2_patients','csa2_consultations','csa2_constantes','csa2_soins','csa2_observations','csa2_labo_actes','csa2_pharma_ventes','csa2_pharma_stock','csa2_transactions','csa2_clotures','csa2_audit_logs'].filter(k => !!localStorage.getItem(k)).length;
  
  return {
    cspViolations: {value: cspViolations, status: cspViolations === 0 ? 'PASS' : 'WARN'},
    consoleErrors: {value: consoleErrors, status: consoleErrors === 0 ? 'PASS' : 'WARN'},
    storageSize: {value: Math.round(storageSize / 1024) + ' KB', status: storageSize < 5242880 ? 'PASS' : 'WARN'},
    encryptedKeys: {value: encryptedKeys, status: encryptedKeys === 12 ? 'PASS' : 'WARN'},
    cspValid: {value: CSPTest.validatePolicy() ? 'YES' : 'NO', status: CSPTest.validatePolicy() ? 'PASS' : 'FAIL'},
    encryptionWorks: {value: CSPTest.testEncryption() ? 'YES' : 'NO', status: CSPTest.testEncryption() ? 'PASS' : 'FAIL'}
  };
}
```

---

## ⏰ Monitoring Schedule

### Every 4 hours
- [ ] Check CSP violations in audit_logs
- [ ] Verify no new console errors
- [ ] Spot check one logout → verify cleanup

### Every 24 hours
- [ ] Run full monitoring dashboard
- [ ] Review all CSP violations
- [ ] Check storage size growth
- [ ] Verify all tests still pass

### Every week
- [ ] Trend analysis of CSP violations
- [ ] Review console errors for patterns
- [ ] Audit all session logouts
- [ ] Check for performance degradation

---

## 🚨 Alert Thresholds

**RED ALERT (Immediate Action Required)**:
- CSP_VIOLATION count > 10 in 1 hour
- Console errors > 5 per user session
- Logout cleanup FAIL (keys remaining)
- localStorage storage > 5 MB
- Encryption test FAIL

**YELLOW ALERT (Review Required)**:
- CSP_VIOLATION count > 3 in 24 hours
- New CDN or script source causing violations
- Storage growth trend > 100 KB/day
- Any encryption/decryption timeout

**GREEN (All Good)**:
- Zero CSP violations
- Zero console errors
- All 12 keys cleaned on logout
- Storage < 2 MB per session
- All tests PASS

---

## 🔍 Quick Diagnostics

If something is wrong, run in console:

```javascript
// Full diagnostic report
{
  timestamp: new Date().toISOString(),
  cspStatus: CSPTest.validatePolicy() ? 'PASS' : 'FAIL',
  encryptionStatus: CSPTest.testEncryption() ? 'PASS' : 'FAIL',
  storageKeys: Object.keys(localStorage),
  storageSize: Object.keys(localStorage).reduce((s,k) => s + localStorage.getItem(k).length, 0),
  consoleErrors: getConsoleErrors(),
  cspViolations: DB.get('audit_logs').filter(l => l.action === 'CSP_VIOLATION'),
  userSession: CURRENT_AGENT ? {id: CURRENT_AGENT.user_id, role: CURRENT_AGENT.module} : null
}
```

Copy this output and include in any bug reports.

---

## 📞 Escalation Path

1. **First Response** (0-30 min): Check monitoring dashboard
2. **Investigation** (30 min-2 hours): Run diagnostics, check logs
3. **Escalate** (2+ hours): 
   - If CSP violations: Notify security team
   - If encryption failure: Notify dev team
   - If logout failure: Notify backend team
4. **Resolution**: Apply fix and re-test all 3 checks
5. **Documentation**: Add lesson learned to SECURITY.md

---

## ✅ Success Criteria

After 24-48 hours, you should see:

```
CSP Violations: 0 ✅
Console Errors: 0 ✅
Logout Cleanup: 12/12 PASS ✅
Storage Growth: < 100 KB/day ✅
Encryption Tests: PASS ✅
All Users: Unaffected ✅
```

If all green → **Deploy complete and stable!**

---

**Monitoring Status**: ACTIVE  
**Last Check**: 2026-06-23  
**Next Check**: Every 4 hours (automated)

