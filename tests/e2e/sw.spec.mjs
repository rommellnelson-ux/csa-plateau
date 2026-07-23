// Test REEL du service worker : migration v16 -> v17, purge, hors-ligne.
// Copie servie separement (scratchpad) pour pouvoir permuter sw.js sans toucher au worktree.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const STUB = fs.readFileSync(path.join(ICI, 'stub.js'), 'utf8');
const SITE = path.join(ICI, 'site');
const BASE = process.env.SW_BASE_URL || 'http://127.0.0.1:8770';
const SW = path.join(SITE, 'sw.js');

const poserVersion = (v) => {
  const src = fs.readFileSync(SW, 'utf8');
  fs.writeFileSync(SW, src.replace(/const CACHE = '[^']*'/, "const CACHE = '" + v + "'"));
};
const versionPosee = () => (fs.readFileSync(SW, 'utf8').match(/const CACHE = '([^']*)'/) || [])[1];

async function prep(page) {
  if (!/^http:\/\/127\.0\.0\.1:/.test(BASE)) throw new Error('REFUS : cible non locale');
  await page.addInitScript((s) => { window.__SCENARIO__ = s; }, { facteurs: { all: [], totp: [] } });
  await page.route('**/supabase-js@**', (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route('**/chart.umd.min.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.Chart=function(){};' }));
}
const caches_ = (page) => page.evaluate(() => caches.keys());
const attendreSW = (page) => page.waitForFunction(
  () => navigator.serviceWorker.controller !== null || (navigator.serviceWorker.ready && true),
  null, { timeout: 20000 });

test.describe('Service worker — migration v16 vers v17', () => {

  test('installation v16, migration v17, purge de l ancien cache', async ({ page }) => {
    // 1) Etat initial : ancienne version v16
    poserVersion('csa-plateau-v16-app-js');
    expect(versionPosee()).toBe('csa-plateau-v16-app-js');
    await prep(page);
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await attendreSW(page);
    await page.waitForTimeout(1500);
    let clefs = await caches_(page);
    expect(clefs).toContain('csa-plateau-v16-app-js');

    // 2) Deploiement de la v17
    poserVersion('csa-plateau-v17-mfa-recovery');
    expect(versionPosee()).toBe('csa-plateau-v17-mfa-recovery');

    // 3) Mise a jour du service worker puis rechargement
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); });
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2000);

    // 4) Nouveau cache present, ancien purge
    clefs = await caches_(page);
    expect(clefs).toContain('csa-plateau-v17-mfa-recovery');
    expect(clefs).not.toContain('csa-plateau-v16-app-js');
    expect(clefs.length).toBe(1);

    // 5) app.js recharge et servi
    const contenu = await page.evaluate(async () => {
      const c = await caches.open('csa-plateau-v17-mfa-recovery');
      const r = await c.match(new Request(location.origin + '/app.js'));
      return r ? await r.text() : null;
    });
    expect(contenu).toBeTruthy();
    // C'est bien le app.js CORRIGE qui est servi depuis le nouveau cache
    expect(contenu).toContain('listerTousLesFacteursMfa');
    expect(contenu).toContain('CHOIX_FACTEUR_VERIFIE');
    // Le SDK est epingle dans le shell mis en cache
    const html = await page.evaluate(async () => {
      const c = await caches.open('csa-plateau-v17-mfa-recovery');
      const r = await c.match(new Request(location.origin + '/index.html'));
      return r ? await r.text() : null;
    });
    expect(html).toContain('supabase-js@2.110.8');

    // 6) Aucune requete Supabase mise en cache
    const supaEnCache = await page.evaluate(async () => {
      const c = await caches.open('csa-plateau-v17-mfa-recovery');
      return (await c.keys()).filter((r) => r.url.includes('supabase.co')).length;
    });
    expect(supaEnCache).toBe(0);
  });

  test('shell fonctionne hors ligne apres mise en cache', async ({ page, context }) => {
    poserVersion('csa-plateau-v17-mfa-recovery');
    await prep(page);
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await attendreSW(page);
    await page.waitForTimeout(2000);
    await context.setOffline(true);
    const rep = await page.reload({ waitUntil: 'load' }).catch(() => null);
    expect(rep).not.toBeNull();
    expect(await page.title()).toContain('CSA Plateau');
    await expect(page.locator('#auth-screen')).toBeAttached();
    await context.setOffline(false);
  });
});
