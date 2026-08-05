// Harnais Playwright INDEPENDANT — Rendu sûr XSS + neutralisation CSV (PR A).
// Aucun compte distant, aucune URL de production, client Supabase SIMULE.
// Aucune requête réseau réelle : charges à MARQUEUR inerte (window.__XSS_TEST__).
// Les assertions de puits sont DETERMINISTES (detection d'element injecte vivant,
// independante de la serialisation innerHTML — cf. divergence Chromium 1.48/1.61).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const STUB = fs.readFileSync(path.join(ICI, 'stub.js'), 'utf8');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8769';

async function ouvrir(page) {
  if (!/^http:\/\/127\.0\.0\.1:/.test(BASE)) throw new Error('REFUS : cible non locale');
  await page.route('**/supabase-js@**', (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route('**/chart.umd.min.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.Chart=function(){this.destroy=function(){}};' }));
  // Garde reseau : toute cible externe (dont example.invalid) est coupee.
  await page.route('**', (r) => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => { window.__SCENARIO__ = { sansSession: true }; });
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof VIEW !== 'undefined' && typeof csvCell === 'function' && typeof savePatient === 'function', null, { timeout: 15000 });
  // Detecteur commun injecte dans la page : compte les elements portant un handler
  // (onerror/onload/ontoggle) avec le marqueur — un puits sûr n'en produit aucun.
  await page.evaluate(() => {
    window.__countLive = (root) => {
      const m = (el) => /__XSS_TEST__/.test((el.getAttribute('onerror') || '') + (el.getAttribute('onload') || '') + (el.getAttribute('ontoggle') || ''));
      return Array.prototype.filter.call((root || document).querySelectorAll('[onerror],[onload],[ontoggle]'), m).length;
    };
  });
}

const PAYLOADS = [
  '<img src=x onerror=window.__XSS_TEST__=1>',
  '"><img src=x onerror=window.__XSS_TEST__=1>',
  '"><svg onload=window.__XSS_TEST__=1>',
  '<details open ontoggle=window.__XSS_TEST__=1>',
];

test.describe('PR A — rendu sûr XSS (deterministe)', () => {
  test('toutes les vues avec charges (dont rupture attribut) : aucun element injecte vivant', async ({ page }) => {
    await ouvrir(page);
    for (const XP of PAYLOADS) {
      const r = await page.evaluate((XP) => {
        const T = () => new Date().toISOString().slice(0, 10);
        delete window.__XSS_TEST__;
        localStorage.setItem('csa2_clotures', JSON.stringify([{ id: 'c1', date: T(), enc_attendu: 0, physique: 0, ecart: 0, cnam_a_facturer: 0, sig_caissier: XP, sig_resp: XP, observations: XP }]));
        localStorage.setItem('csa2_labo_actes', JSON.stringify([{ id: 'l1', patient_nom: 'P', statut: 'CMU', actes: [{ nom: 'Bio', cnam: 0, tm: 0 }], total: 0, resultat: XP, preleve_par: XP, date: T(), created_at: new Date().toISOString() }]));
        localStorage.setItem('csa2_soins', JSON.stringify([{ id: 's1', patient_nom: 'P', statut: 'CMU', actes: [{ nom: XP }], total: 0, cnam: 0, date: T(), created_at: new Date().toISOString() }]));
        localStorage.setItem('csa2_pharma_ventes', JSON.stringify([{ id: 'v1', patient_nom: 'P', statut: 'NA', items: [{ nom: XP, qte: 1 }], total: 0, date: T(), created_at: new Date().toISOString() }]));
        localStorage.setItem('csa2_pharma_stock', JSON.stringify([{ id: 'm1', nom: XP, dci: 'D', stock: 0, seuil: 5, catalogue_status: 'ACTIF' }]));
        localStorage.setItem('csa2_transactions', JSON.stringify([{ id: 't1', designation: XP, service: 'ACCUEIL', montant: 0, cnam: 0, encaisse: 0, date: T(), created_at: new Date().toISOString() }]));
        localStorage.setItem('csa2_patients', JSON.stringify([{ id: 'p1', nom: XP, genre: XP, batiment: XP, statut: 'NA', statut_simple: 'NA', created_at: new Date().toISOString() }]));
        CURRENT_AGENT = { id: 'T', nom: 'T', role: 'Chef', module: 'chef', permissions: ['chef'], isChef: true };
        const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-9999px'; document.body.appendChild(host);
        let live = 0;
        Object.keys(VIEW).forEach((k) => { const d = document.createElement('div'); try { VIEW[k](d); } catch (e) {} host.innerHTML = ''; host.appendChild(d); live += window.__countLive(host); });
        host.remove();
        ['csa2_clotures', 'csa2_labo_actes', 'csa2_soins', 'csa2_pharma_ventes', 'csa2_pharma_stock', 'csa2_transactions', 'csa2_patients'].forEach((k) => localStorage.removeItem(k));
        return { live, marker: window.__XSS_TEST__ };
      }, XP);
      expect(r.live, `element injecte vivant pour: ${XP}`).toBe(0);
      expect(r.marker, `marqueur declenche pour: ${XP}`).toBeUndefined();
      await page.waitForTimeout(60);
      expect(await page.evaluate(() => window.__XSS_TEST__), `declenchement differe: ${XP}`).toBeUndefined();
    }
  });

  test('VRAI PARCOURS : savePatient (valeur formulaire + agent + batiment) -> recu echappe', async ({ page }) => {
    await ouvrir(page);
    await page.evaluate(() => {
      // Agent et batiment malveillants ; on emprunte le chemin applicatif reel.
      CURRENT_AGENT = { id: 'A', nom: '"><img src=x onerror=window.__XSS_TEST__=1>', role: 'Accueil', module: 'accueil', permissions: ['accueil'], isChef: false, bldg: '"><svg onload=window.__XSS_TEST__=1>' };
      const c = document.getElementById('content'); c.innerHTML = ''; const d = document.createElement('div'); c.appendChild(d);
      VIEW['acc-reception'](d);
      document.getElementById('p-nom').value = '"><img src=x onerror=window.__XSS_TEST__=1>';
      delete window.__XSS_TEST__;
      savePatient();
    });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const zone = document.getElementById('acc-recu-zone');
      return { live: window.__countLive(zone), marker: window.__XSS_TEST__, produced: /Dossier|Re/.test(zone.textContent), visible: zone.textContent.indexOf('"><img') > -1 };
    });
    expect(r.produced, 'le vrai parcours doit produire le recu').toBe(true);
    expect(r.live, 'aucun element injecte vivant dans le recu reel').toBe(0);
    expect(r.marker).toBeUndefined();
    expect(r.visible, 'la charge doit apparaitre comme TEXTE visible (echappee)').toBe(true);
  });
});

// Parseur CSV conforme (RFC4180) : gere les champs cites, virgules internes,
// guillemets doubles. Ne PAS decouper naivement sur /[\r\n,]+/.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* ignore */ }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test.describe('PR A — neutralisation formule CSV (parseur conforme)', () => {
  test('export CSV : formules (meme derriere invisibles) neutralisees, nombres preserves, contenu conserve', async ({ page }) => {
    await ouvrir(page);
    const csvText = await page.evaluate(() => {
      const NBSP = String.fromCharCode(160);
      localStorage.setItem('csa2_transactions', JSON.stringify([
        { id: 'a', designation: '=HYPERLINK("http://x","y")', service: 'ACCUEIL', montant: -150, cnam: 0, encaisse: -150, date: '2026-07-24' },
        { id: 'b', designation: '   +1+1', service: 'LABO', montant: 12.5, cnam: 0, encaisse: 12.5, date: '2026-07-24' },
        { id: 'c', designation: NBSP + '=CMD()', service: 'SOINS', montant: 200, cnam: 0, encaisse: 200, date: '2026-07-24' },
        { id: 'd', designation: 'Vente carnet, thermometre', service: 'ACCUEIL', montant: 2000, cnam: 0, encaisse: 2000, date: '2026-07-24' },
      ]));
      let captured = '';
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { blob.text().then((t) => { window.__CSV__ = t; }); return 'blob:x'; };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      exportCSV('transactions', 't.csv');
      URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick;
      return new Promise((res) => setTimeout(() => res(window.__CSV__ || ''), 60));
    });
    const rows = parseCSV(csvText);
    const header = rows[0];
    const di = header.indexOf('designation');
    const mi = header.indexOf('montant');
    expect(di).toBeGreaterThan(-1);
    const cell = (rowIdx) => rows[rowIdx][di];
    // Chaque designation dangereuse est prefixee d'une apostrophe ET conserve son contenu.
    const NBSP = String.fromCharCode(160);
    expect(cell(1)).toBe('\'=HYPERLINK("http://x","y")');   // = neutralise, guillemets internes conserves
    expect(cell(2)).toBe('\'   +1+1');                        // + derriere espaces neutralise
    expect(cell(3)).toBe('\'' + NBSP + '=CMD()');            // = derriere NBSP neutralise
    expect(cell(4)).toBe('Vente carnet, thermometre');        // texte normal (virgule interne conservee, non prefixe)
    // Aucune cellule ne commence par un caractere de formule apres le parseur.
    for (const r of rows.slice(1)) for (const c of r) expect(/^[=+@]/.test(c)).toBe(false);
    // Les montants restent des nombres exploitables (pas de prefixe), y compris -150.
    expect(rows[1][mi]).toBe('-150');
    expect(rows[2][mi]).toBe('12.5');
  });
});
