// Harnais Playwright INDEPENDANT — Rendu sûr XSS + neutralisation CSV (PR A).
// Aucun compte distant, aucune URL de production, client Supabase simulé.
// Aucune requête réseau réelle : les charges utilisent un MARQUEUR inerte
// (window.__XSS_TEST__) et toute cible externe est bloquée par une garde de route.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const STUB = fs.readFileSync(path.join(ICI, 'stub.js'), 'utf8');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8769';

// Corpus complet demandé (le variant fetch cible example.invalid mais n'est JAMAIS
// émis : la charge est neutralisée par l'échappement et la route externe est coupée).
const XSS_CORPUS = [
  '<img src=x onerror=window.__XSS_TEST__=1>',
  '"><svg onload=window.__XSS_TEST__=1>',
  '<details open ontoggle=window.__XSS_TEST__=1>',
  'javascript:alert(1)',
  `"><img src=x onerror=fetch('https://example.invalid')>`,
];

async function ouvrir(page) {
  if (!/^http:\/\/127\.0\.0\.1:/.test(BASE)) throw new Error('REFUS : cible non locale');
  // Client Supabase simulé + Chart stub : aucun appel réseau réel.
  await page.route('**/supabase-js@**', (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route('**/chart.umd.min.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.Chart=function(){};' }));
  // Garde réseau : toute tentative vers example.invalid est coupée (jamais atteinte en réalité).
  await page.route('**example.invalid**', (r) => r.abort());
  await page.addInitScript(() => { window.__SCENARIO__ = { sansSession: true }; });
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof VIEW !== 'undefined' && typeof csvCell === 'function', null, { timeout: 15000 });
}

// Installe un agent Chef synthétique et amorce le localStorage avec des données malveillantes.
async function amorcer(page, tables) {
  await page.evaluate((t) => {
    CURRENT_AGENT = { id: 'T', nom: 'T', role: 'Chef', module: 'chef', permissions: ['chef'], isChef: true };
    Object.keys(t).forEach((k) => localStorage.setItem('csa2_' + k, JSON.stringify(t[k])));
    delete window.__XSS_TEST__;
  }, tables);
}

test.describe('PR A — rendu sûr XSS', () => {
  test('signature caissier malveillante affichée au Chef : aucune exécution', async ({ page }) => {
    await ouvrir(page);
    await amorcer(page, {
      clotures: [{ id: 'c1', date: '2026-07-24', enc_attendu: 0, physique: 0, ecart: 0, cnam_a_facturer: 0,
        sig_caissier: '<img src=x onerror=window.__XSS_TEST__=1>', sig_resp: 'x', observations: '"><svg onload=window.__XSS_TEST__=1>' }],
    });
    const res = await page.evaluate(() => {
      let html = '';
      Object.keys(VIEW).forEach((k) => { const d = document.createElement('div'); try { VIEW[k](d); html += d.innerHTML; } catch (e) {} });
      return { html, marker: window.__XSS_TEST__ };
    });
    expect(res.marker).toBeUndefined();
    expect(res.html).not.toContain('<img src=x onerror');
    expect(res.html).not.toContain('<svg onload');
    expect(res.html).toContain('&lt;img src=x onerror'); // preuve : la charge est bien rendue, échappée
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__XSS_TEST__)).toBeUndefined();
  });

  test('recherche patient (chefSearch) : genre/batiment malveillants échappés', async ({ page }) => {
    await ouvrir(page);
    await amorcer(page, {
      patients: [{ id: 'p1', nom: 'KOUAME', genre: '<img src=x onerror=window.__XSS_TEST__=1>',
        batiment: '"><svg onload=window.__XSS_TEST__=1>', statut: 'NA', statut_simple: 'NA', created_at: new Date().toISOString() }],
    });
    const res = await page.evaluate(() => {
      const d = document.createElement('div'); document.body.appendChild(d);
      VIEW['chef-patients'](d);
      chefSearch(); // remplit #chef-pat-results
      const html = document.getElementById('chef-pat-results').innerHTML;
      return { html, marker: window.__XSS_TEST__ };
    });
    expect(res.marker).toBeUndefined();
    expect(res.html).not.toContain('<img src=x onerror');
    expect(res.html).not.toContain('<svg onload');
  });

  test('reçu avec bâtiment synthétique malveillant : échappé', async ({ page }) => {
    await ouvrir(page);
    const res = await page.evaluate(() => {
      CURRENT_AGENT = { id: 'A', nom: '<img src=x onerror=window.__XSS_TEST__=1>', role: 'Accueil', module: 'accueil', permissions: ['accueil'], isChef: false, bldg: '"><svg onload=window.__XSS_TEST__=1>' };
      const p = { id: 'x', dossier_no: 'CSA-2607-ABC', nom: 'Test', batiment: CURRENT_AGENT.bldg };
      const now = new Date();
      // Reproduit le bloc reçu d'accueil (mêmes interpolations que savePatient).
      const html = `<div>Bât. ${escHtml(p.batiment)} | Agent : ${escHtml(CURRENT_AGENT.nom)}</div>`;
      const d = document.createElement('div'); d.innerHTML = html;
      return { html: d.innerHTML, marker: window.__XSS_TEST__ };
    });
    expect(res.marker).toBeUndefined();
    expect(res.html).not.toContain('<img src=x onerror');
    expect(res.html).not.toContain('<svg onload');
  });

  test('corpus complet dans un puits de rendu : aucune balise exécutable', async ({ page }) => {
    await ouvrir(page);
    for (const payload of XSS_CORPUS) {
      const r = await page.evaluate((p) => {
        delete window.__XSS_TEST__;
        localStorage.setItem('csa2_clotures', JSON.stringify([{ id: 'c', date: '2026-07-24', enc_attendu: 0, physique: 0, ecart: 0, cnam_a_facturer: 0, sig_caissier: p, sig_resp: 'x', observations: 'y' }]));
        CURRENT_AGENT = { id: 'T', nom: 'T', role: 'Chef', module: 'chef', permissions: ['chef'], isChef: true };
        let html = '';
        Object.keys(VIEW).forEach((k) => { const d = document.createElement('div'); try { VIEW[k](d); html += d.innerHTML; } catch (e) {} });
        return { html, marker: window.__XSS_TEST__ };
      }, payload);
      expect(r.marker, `charge: ${payload}`).toBeUndefined();
      expect(r.html).not.toMatch(/<img[^>]*onerror|<svg[^>]*onload|<details[^>]*ontoggle/i);
      await page.waitForTimeout(50);
      expect(await page.evaluate(() => window.__XSS_TEST__), `déclenchement différé: ${payload}`).toBeUndefined();
    }
  });
});

test.describe('PR A — neutralisation formule CSV', () => {
  test('export CSV : préfixes de formule neutralisés, nombres préservés', async ({ page }) => {
    await ouvrir(page);
    const csv = await page.evaluate(() => {
      localStorage.setItem('csa2_transactions', JSON.stringify([
        { id: 't1', designation: '=HYPERLINK("https://example.invalid","x")', service: 'ACCUEIL', montant: -150, cnam: 0, encaisse: -150, date: '2026-07-24' },
        { id: 't2', designation: '+1+1', service: 'LABO', montant: 12.5, cnam: 0, encaisse: 12.5, date: '2026-07-24' },
        { id: 't3', designation: '@SUM(1,1)', service: 'SOINS', montant: 200, cnam: 0, encaisse: 200, date: '2026-07-24' },
      ]));
      // Capture le CSV sans télécharger réellement.
      let captured = '';
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { blob.text().then((t) => { window.__CSV_TEXT__ = t; }); return 'blob:capture'; };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      exportCSV('transactions', 'test.csv');
      URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick;
      return new Promise((r) => setTimeout(() => r(window.__CSV_TEXT__ || ''), 50));
    });
    // Chaque cellule est entourée de guillemets. Aucune cellule "brute" ne doit commencer par =,+,-,@.
    const cells = csv.split(/[\r\n,]+/).filter(Boolean);
    for (const c of cells) {
      const inner = c.replace(/^"|"$/g, ''); // contenu de cellule
      // Un nombre négatif réel (-150) reste exploitable ; une formule est préfixée d'une apostrophe.
      if (/^[=+@]/.test(inner)) throw new Error('Cellule formule non neutralisée : ' + c);
    }
    expect(csv).toContain(`'=HYPERLINK`); // =HYPERLINK neutralisé par apostrophe
    expect(csv).toContain(`'+1+1`);       // +1+1 neutralisé
    expect(csv).toContain(`'@SUM(1,1)`);  // @SUM neutralisé
    expect(csv).toContain('"-150"');       // montant négatif réel préservé (exploitable dans le tableur)
    expect(csv).toContain('"12.5"');       // décimal préservé
  });
});
