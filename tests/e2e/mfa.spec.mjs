// Harnais Playwright INDEPENDANT — MFA CSA Plateau.
// Aucun compte distant, aucune URL de production, client Supabase simule.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const STUB = fs.readFileSync(path.join(ICI, 'stub.js'), 'utf8');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8769';

const F = (id, st, nom) => ({ id, factor_type: 'totp', status: st, friendly_name: nom || 'CSA Plateau - SEV-CI ' + st });

async function ouvrir(page, scenario) {
  // Garde anti-production : le harnais refuse toute cible non locale.
  if (!/^http:\/\/127\.0\.0\.1:/.test(BASE)) throw new Error('REFUS : cible non locale');
  await page.addInitScript((s) => { window.__SCENARIO__ = s; }, scenario || {});
  // Le bundle CDN est remplace par le client simule -> injection avant le chargement de app.js
  await page.route('**/supabase-js@**', (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route('**/chart.umd.min.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.Chart=function(){};' }));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.__CALLS__ === 'object', null, { timeout: 15000 });
  // Attente deterministe : on attend un etat MFA stabilise ou un message d'erreur,
  // plutot qu'un delai fixe (evite les faux negatifs au demarrage a froid).
  await page.waitForFunction(() => {
    const err = document.getElementById('auth-error');
    if (err && err.textContent.trim()) return true;
    return typeof MFA_STATE !== 'undefined' && MFA_STATE !== null;
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(200);
}
const etat = (page) => page.evaluate(() => (MFA_STATE ? MFA_STATE.etat : null));
const appels = (page) => page.evaluate(() => window.__CALLS__);
const visible = (page, id) => page.evaluate((i) => { const e = document.getElementById(i); return e ? getComputedStyle(e).display : 'absent'; }, id);

test.describe('MFA — parcours simules', () => {

  test('P1 aucun facteur : un seul enrolement, QR, libelle principal', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] } });
    const c = await appels(page);
    expect(c.enroll).toBe(1);
    expect(c.unenroll).toBe(0);
    expect(c.dernierNom).toBe('CSA Plateau - SEV-CI principal');
    expect(await visible(page, 'mfa-qr-zone')).toBe('block');
    const stock = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
    expect(stock).not.toContain('SECRET-SIMULE');
  });

  test('P2 un facteur non verifie : aucun enroll, aucun unenroll, ecran de choix', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [F('F1', 'unverified')], totp: [] } });
    const c = await appels(page);
    expect(c.enroll).toBe(0);
    expect(c.unenroll).toBe(0);
    expect(await etat(page)).toBe('FACTEUR_NON_VERIFIE_REPRISE_POSSIBLE');
    expect(await visible(page, 'mfa-choice')).toBe('block');
    await expect(page.locator('#mfa-resume')).toBeVisible();
    await expect(page.locator('#mfa-restart')).toBeVisible();
  });

  test('P3 reprise : challenge du facteur existant, aucun nouvel enrolement, aal2', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [F('F1', 'unverified')], totp: [] } });
    await page.click('#mfa-resume');
    expect(await page.evaluate(() => MFA_STATE.factorId)).toBe('F1');
    expect((await appels(page)).enroll).toBe(0);
    await page.fill('#mfa-code', '123456');
    await page.click('#mfa-submit');
    await page.waitForTimeout(500);
    const c = await appels(page);
    expect(c.challengeAndVerify).toBe(1);
    expect(c.enroll).toBe(0);
    expect(c.unenroll).toBe(0);
    expect(await visible(page, 'app')).toBe('flex');
  });

  test('P4 recommencer : confirmation, suppression du seul inacheve, un seul facteur neuf', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [F('F1', 'unverified')], totp: [] } });
    page.on('dialog', (d) => d.accept());
    await page.click('#mfa-restart');
    await page.waitForTimeout(600);
    const c = await appels(page);
    expect(c.unenroll).toBe(1);
    expect(c.unenrolled).toEqual(['F1']);
    expect(c.enroll).toBe(1);
    expect(await visible(page, 'mfa-qr-zone')).toBe('block');
  });

  test('P5 un facteur verifie : challenge seul, aucun enroll ni unenroll', async ({ page }) => {
    const fv = F('FV', 'verified', 'CSA Plateau - SEV-CI principal');
    await ouvrir(page, { facteurs: { all: [fv], totp: [fv] } });
    expect(await etat(page)).toBe('FACTEUR_VERIFIE_A_CHALLENGER');
    const c = await appels(page);
    expect(c.enroll).toBe(0);
    expect(c.unenroll).toBe(0);
    await page.fill('#mfa-code', '123456');
    await page.click('#mfa-submit');
    await page.waitForTimeout(500);
    expect(await visible(page, 'app')).toBe('flex');
  });

  test('P6 deux facteurs verifies : selection explicite, aucun choix silencieux', async ({ page }) => {
    const fa = F('FA', 'verified', 'CSA Plateau - SEV-CI principal');
    const fb = F('FB', 'verified', 'CSA Plateau - SEV-CI secours');
    await ouvrir(page, { facteurs: { all: [fa, fb], totp: [fa, fb] } });
    expect(await etat(page)).toBe('CHOIX_FACTEUR_VERIFIE');
    expect(await page.evaluate(() => MFA_STATE.factorId || null)).toBeNull();
    expect(await page.locator('#mfa-select-list button').count()).toBe(2);
    expect(await visible(page, 'mfa-select-warn')).toBe('none');
    await page.locator('#mfa-select-list button', { hasText: 'secours' }).click();
    expect(await page.evaluate(() => MFA_STATE.factorId)).toBe('FB');
    const c = await appels(page);
    expect(c.enroll).toBe(0);
    expect(c.unenroll).toBe(0);
  });

  test('P7 plus de deux facteurs verifies : avertissement, choix possible, aucune suppression', async ({ page }) => {
    const f = ['FA', 'FB', 'FC'].map((id, i) => F(id, 'verified', 'CSA Plateau - SEV-CI ' + i));
    await ouvrir(page, { facteurs: { all: f, totp: f } });
    expect(await etat(page)).toBe('CHOIX_FACTEUR_VERIFIE');
    expect(await visible(page, 'mfa-select-warn')).toBe('block');
    expect(await page.locator('#mfa-select-list button').count()).toBe(3);
    const c = await appels(page);
    expect(c.unenroll).toBe(0);
    expect(c.enroll).toBe(0);
  });

  test('P8 plusieurs inacheves : aucune suppression au chargement, reprise masquee', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [F('U1', 'unverified'), F('U2', 'unverified')], totp: [] } });
    expect(await etat(page)).toBe('FACTEUR_NON_VERIFIE_REDEMARRAGE_REQUIS');
    const c = await appels(page);
    expect(c.unenroll).toBe(0);
    expect(c.enroll).toBe(0);
    expect(await visible(page, 'mfa-resume')).toBe('none');
    await expect(page.locator('#mfa-restart')).toBeVisible();
  });

  test('P9 evenements concurrents : un seul bootstrap, un seul enrolement', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] }, latence: 120, decalageAuth: 10 });
    await page.waitForTimeout(1200);
    const c = await appels(page);
    expect(c.enroll).toBe(1);
    expect(c.profil).toBe(1);          // une seule lecture du profil
    expect(c.listFactors).toBe(1);     // une seule lecture des facteurs
    expect(await visible(page, 'mfa-qr-zone')).toBe('block');
  });

  test('P10 deconnexion : verrous et DOM purges, aucune donnee MFA persistante', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] } });
    expect(await visible(page, 'mfa-qr-zone')).toBe('block');
    await page.evaluate(() => logout());
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => MFA_STATE)).toBeNull();
    expect(await page.evaluate(() => document.getElementById('mfa-secret').textContent)).toBe('');
    expect(await page.evaluate(() => document.getElementById('mfa-qr').getAttribute('src'))).toBeNull();
    const stock = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
    expect(stock).not.toContain('SECRET-SIMULE');
  });
});

test.describe('MFA — erreurs reseau et codes', () => {

  test('reseau indisponible : message, aucune deconnexion, aucun facteur touche', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] }, aalErreur: { message: 'network timeout' } });
    expect(await etat(page)).toBe('ERREUR_RECUPERABLE');
    expect(await page.textContent('#auth-error')).toContain('Réseau');
    const c = await appels(page);
    expect(c.enroll).toBe(0);
    expect(c.unenroll).toBe(0);
    expect(await page.evaluate(() => document.getElementById('auth-submit').disabled)).toBe(false);
    expect(await visible(page, 'app')).toBe('none');
  });

  test('429 : message de limitation, aucune relance automatique, facteur conserve', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [F('F1', 'unverified')], totp: [] }, listErreur: { code: 'over_request_rate_limit', message: 'rate limit' } });
    expect(await etat(page)).toBe('ERREUR_RECUPERABLE');
    const c1 = await appels(page);
    await page.waitForTimeout(1500);
    const c2 = await appels(page);
    expect(c2.listFactors).toBe(c1.listFactors);   // aucune relance automatique
    expect(c2.unenroll).toBe(0);
  });

  test('500 : erreur temporaire, aucun enroll ni unenroll', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] }, enrollErreur: { code: 'internal_error', message: 'server error 500' } });
    expect(await etat(page)).toBe('ERREUR_RECUPERABLE');
    const c = await appels(page);
    expect(c.unenroll).toBe(0);
    expect(await page.evaluate(() => document.getElementById('auth-submit').disabled)).toBe(false);
  });

  test('code incorrect puis correct : facteur conserve, aucun nouvel enrolement', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] }, verifyErreur: { code: 'mfa_verification_failed' } });
    const avant = (await appels(page)).enroll;
    await page.fill('#mfa-code', '000000');
    await page.click('#mfa-submit');
    await page.waitForTimeout(400);
    expect(await page.textContent('#mfa-error')).toContain('incorrect');
    const c = await appels(page);
    expect(c.enroll).toBe(avant);
    expect(c.unenroll).toBe(0);
    expect(await page.evaluate(() => document.getElementById('mfa-submit').disabled)).toBe(false);
  });

  test('code expire : message distinct, facteur conserve', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] }, verifyErreur: { code: 'mfa_challenge_expired' } });
    await page.fill('#mfa-code', '000000');
    await page.click('#mfa-submit');
    await page.waitForTimeout(400);
    expect(await page.textContent('#mfa-error')).toContain('xpir');
    expect((await appels(page)).unenroll).toBe(0);
  });

  test('reseau lent : un seul parcours, verrou libere', async ({ page }) => {
    await ouvrir(page, { facteurs: { all: [], totp: [] }, latence: 300 });
    await page.waitForTimeout(2500);
    const c = await appels(page);
    expect(c.enroll).toBe(1);
    expect(c.profil).toBe(1);
    expect(await page.evaluate(() => MFA_EN_COURS)).toBeFalsy();  // verrou libere
  });
});
