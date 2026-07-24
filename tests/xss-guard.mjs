// Garde-fou anti-régression XSS/CSV (PR A). CE N'EST PAS une preuve de sécurité
// complète : un simple contrôle de motifs qui échoue (exit 1) si un puits corrigé
// réapparaît sous sa forme vulnérable, et qui SIGNALE (sans échouer) les nouvelles
// interpolations de champs contrôlables insérées sans helper d'échappement.
// Exécuter : node tests/xss-guard.mjs
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

// 1) FORMES VULNÉRABLES INTERDITES — la réapparition de l'une d'elles casse le build.
//    (Chaque entrée est la forme AVANT correctif d'un puits confirmé de la Phase 0 / PR A.)
const FORBIDDEN = [
  { re: /\$\{c\.sig_caissier\}/, desc: 'signature caissier non échappée (liste clôtures)' },
  { re: /Caissière\s*:\s*\$\{s1\}/, desc: 'signature non échappée (bannière clôture)' },
  // L'alerte dashboard est échappée AU SITE DE RENDU (escHtml(a.titre)/escHtml(a.msg)) ;
  // c'est ce qui protège les observations de clôture agrégées dans a.msg. On garde donc
  // l'invariant sur le rendu, pas sur la construction du message.
  { re: /<strong>\$\{a\.titre\}<\/strong>\$\{a\.msg\}/, desc: 'alertes chef non échappées au rendu (titre/msg)' },
  { re: /\$\{p\.genre\|\|'—'\}/, desc: 'genre non échappé (chefSearch)' },
  { re: /\$\{p\.batiment\|\|'—'\}/, desc: 'batiment non échappé (chefSearch)' },
  { re: /Bât\.\s*\$\{p\.batiment\}/, desc: 'batiment non échappé (reçu)' },
  { re: /\$\{a\.resultat\|\|'—'\}/, desc: 'résultat labo non échappé' },
  { re: /\$\{a\.preleve_par\|\|a\.agent_nom\}/, desc: 'préleveur labo non échappé' },
  { re: /\$\{s\.actes\.map\(a=>a\.nom\)\.join\(', '\)\}/, desc: 'actes soins non échappés' },
  { re: /\$\{v\.items\.map\(i=>i\.nom\+' ×'\+i\.qte\)\.join\(', '\)\}/, desc: 'items vente non échappés' },
  { re: /\$\{alertes\.map\(m=>m\.nom\+' \('\+m\.stock\+'\)'\)\.join\(' \| '\)\}/, desc: 'alerte stock critique non échappée' },
  { re: /Agent\s*:\s*\$\{CURRENT_AGENT\.nom\}/, desc: "nom d'agent non échappé (reçu)" },
];

// 2) exportCSV DOIT passer par csvCell (neutralisation de formule).
const csvOk = /keys\.map\(csvCell\)\.join\(','\)/.test(src) && /keys\.map\(k=>csvCell\(row\[k\]\)\)/.test(src);

let failures = 0;
for (const f of FORBIDDEN) {
  if (f.re.test(src)) { console.error('❌ RÉGRESSION: ' + f.desc + '  [' + f.re + ']'); failures++; }
}
if (!csvOk) { console.error('❌ RÉGRESSION: exportCSV ne passe plus par csvCell (neutralisation formule CSV)'); failures++; }

// 3) HEURISTIQUE INFORMATIVE — interpolations de champs contrôlables sans helper.
//    Ne fait PAS échouer : liste à revoir humainement (voir §10 : un grep n'est pas une preuve).
const FIELDS = 'nom|prenom|tel|adresse|antecedents|motif|ordonnance|orientations|praticien|designation|patient_nom|agent_nom|sig_caissier|sig_resp|observations|resultat|preleve_par|statut_obs|batiment|genre|commentaire|remarque';
const reField = new RegExp('\\$\\{[^}]*\\.(?:' + FIELDS + ')[^}]*\\}', 'g');
const WRAP = /escHtml\(|escSQ\(|fmt\(|fmtD\(|fmtT\(|badge\(|csvCell\(/;
const warnings = [];
src.split('\n').forEach((line, i) => {
  // Ignore les lignes non-DOM les plus courantes (alert/throw/console/logAudit/affectation de données).
  if (/\balert\(|throw new Error|console\.|logAudit\(|numero_lot:|reference:|friendlyName|friendly_name/.test(line)) return;
  const m = line.match(reField);
  if (!m) return;
  m.forEach((tok) => { if (!WRAP.test(tok)) warnings.push((i + 1) + ': ' + tok); });
});
if (warnings.length) {
  console.log('\nℹ️  Interpolations de champs contrôlables SANS helper (à revoir manuellement, non bloquant) :');
  warnings.forEach((w) => console.log('   app.js:' + w));
}

if (failures) { console.error('\n' + failures + ' régression(s) détectée(s).'); process.exit(1); }
console.log('\n✅ Garde-fou XSS/CSV : aucune forme vulnérable connue, exportCSV neutralisé.');
