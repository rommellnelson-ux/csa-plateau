// ════════════════════════════════════════════════════════
// GARDE-FOU STOCKAGE : l'app a besoin du localStorage pour fonctionner et se
// synchroniser. Certains navigateurs (Edge « Protection contre le suivi »,
// Safari, mode privé) le bloquent. On le détecte et on prévient clairement.
// ════════════════════════════════════════════════════════
(function(){
  try{ var k='__csa_test__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); }
  catch(e){
    document.body.innerHTML =
      '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:48px auto;padding:24px;color:#1a1a2e">'
      +'<h2 style="color:#8B1A1A;margin-bottom:8px">Stockage bloqué par le navigateur</h2>'
      +'<p>Cette application a besoin du stockage local pour enregistrer les saisies et les synchroniser entre les postes. Votre navigateur le bloque actuellement (souvent la « Protection contre le suivi »).</p>'
      +'<p style="font-weight:700;margin-top:12px">Solutions :</p>'
      +'<ul style="line-height:1.7"><li>Ouvrez l\'application dans <strong>Google Chrome</strong>, ou</li>'
      +'<li>Dans Edge : cliquez sur l\'icône à gauche de l\'adresse → <strong>Protection contre le suivi</strong> → <strong>désactivez-la pour ce site</strong>, puis rechargez la page.</li>'
      +'<li>Évitez le mode navigation privée.</li></ul></div>';
    throw new Error('localStorage indisponible — message affiché à l\'utilisateur.');
  }
})();

// ════════════════════════════════════════════════════════
// CONFIG SUPABASE
// ════════════════════════════════════════════════════════
// Sélection d'environnement : ?env=staging bascule sur la base de préprod.
// (mémorisé ; ?env=prod ou ?env=production revient en prod)
const CSA_ENVS = {
  prod:    { url:'https://wsnehnempnexzxzuklbv.supabase.co', key:'sb_publishable_FKlt6IevUM0nceNw13qiMA_OxMponku' },
  staging: { url:'https://mzfrcoqjbizhgppwmjon.supabase.co', key:'sb_publishable_dgEqnrHvaA5QObM588KHsw_cN9JkUe_' }
};
(function(){
  try{
    const q=new URLSearchParams(location.search).get('env');
    if(q==='staging') localStorage.setItem('csa2_env','staging');
    else if(q==='prod'||q==='production') localStorage.removeItem('csa2_env');
  }catch(e){}
})();
const CSA_ENV = (function(){ try{ return localStorage.getItem('csa2_env')==='staging'?'staging':'prod'; }catch(e){ return 'prod'; } })();
// Isolation : si on change d'environnement, on PURGE le cache local (csa2_*)
// pour qu'aucune donnée/op d'un env ne fuite vers l'autre (ex. staging -> prod).
(function(){
  try{
    const prev=localStorage.getItem('csa2_active_env');
    // Purge UNIQUEMENT lors d'un vrai changement d'environnement (prod<->staging),
    // pas au premier chargement (sinon on viderait la file de sync en attente).
    if(prev && prev!==CSA_ENV){
      Object.keys(localStorage).filter(k=>k.indexOf('csa2_')===0 && k!=='csa2_env' && k!=='csa2_active_env')
        .forEach(k=>localStorage.removeItem(k));
    }
    localStorage.setItem('csa2_active_env', CSA_ENV);
  }catch(e){}
})();
const SUPABASE_URL = CSA_ENVS[CSA_ENV].url;
const SUPABASE_KEY = CSA_ENVS[CSA_ENV].key;
// Badge bien visible en mode staging.
if(CSA_ENV==='staging'){
  try{
    document.title='[STAGING] '+document.title;
    const sb=document.createElement('div');
    sb.textContent='● PRÉPROD / STAGING — données de test, sans impact sur la production';
    sb.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#7F3F00;color:#fff;text-align:center;font-size:12px;font-weight:700;padding:5px;z-index:3000';
    if(document.body) document.body.appendChild(sb);
    else document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(sb));
  }catch(e){}
}
const INSTITUTION_LOGO_URL = './assets/logo.png';
const CLOUD_TABLE = 'csa_events';
const SYNC_TABLES = ['patients','consultations','constantes','transactions','labo_actes','soins','observations','pharma_ventes','pharma_stock','pharma_lots','pharma_mouvements','pharma_inventaires','pharma_catalogue_historique','pharma_aliases','pharma_registre_historique','pharma_composants_historiques','clotures','audit_logs','sevci_pvvih','sevci_actions'];
let supa = null;
let IS_ONLINE = navigator.onLine;
let SYNC_Q = JSON.parse(localStorage.getItem('csa2_sq')||'[]');
let LAST_SYNC_ERROR = '';
let IS_SYNCING = false;
// Tables modifiables (concernées par le contrôle de version anti-écrasement).
const MUTABLE_TABLES = ['patients','observations','pharma_stock','pharma_lots','pharma_inventaires','sevci_pvvih'];
let CONFLICTS = JSON.parse(localStorage.getItem('csa2_conflicts')||'[]');

// ════════════════════════════════════════════════════════
// Les comptes et rôles sont gérés par Supabase Auth + public.csa_profiles.

// ════════════════════════════════════════════════════════
// TARIFS
// ════════════════════════════════════════════════════════
const TARIFS = {
  consult:{FPM:0,CMU:150,NA:1000},
  stage:5000, carnet:1000, thermo:1000,
  obs:{FPM:150,CMU:150,NA:500},  // FPM au tarif CMU pour l'observation
  B:100, AMI:100
};

// ════════════════════════════════════════════════════════
// Ancien catalogue de démonstration, conservé uniquement comme référence
// d'archivage. Il n'est jamais chargé comme stock opérationnel.
// ════════════════════════════════════════════════════════
const MEDS_DEMO_ARCHIVE = [
  {id:'M001',nom:'Artémether+Luméfantrine 20/120mg cp',dci:'AL',forme:'cp',unite:'plaquette/6',px_achat:500,px_cession:800,stock:150,seuil:30,categorie:'Antipaludéen'},
  {id:'M002',nom:'Quinine 500mg cp',dci:'Quinine',forme:'cp',unite:'cp',px_achat:50,px_cession:150,stock:500,seuil:100,categorie:'Antipaludéen'},
  {id:'M003',nom:'Artésunate injectable 60mg',dci:'Artésunate',forme:'inj',unite:'flacon',px_achat:2500,px_cession:3500,stock:30,seuil:10,categorie:'Antipaludéen'},
  {id:'M004',nom:'Paracétamol 500mg cp',dci:'Paracétamol',forme:'cp',unite:'cp',px_achat:20,px_cession:50,stock:1000,seuil:200,categorie:'Antalgique'},
  {id:'M005',nom:'Paracétamol sirop 120mg/5ml',dci:'Paracétamol',forme:'sirop',unite:'flacon',px_achat:800,px_cession:1200,stock:40,seuil:10,categorie:'Antalgique'},
  {id:'M006',nom:'Ibuprofène 400mg cp',dci:'Ibuprofène',forme:'cp',unite:'cp',px_achat:50,px_cession:150,stock:300,seuil:60,categorie:'AINS'},
  {id:'M007',nom:'Amoxicilline 500mg cp',dci:'Amoxicilline',forme:'cp',unite:'cp',px_achat:100,px_cession:200,stock:400,seuil:100,categorie:'Antibiotique'},
  {id:'M008',nom:'Amoxicilline 250mg/5ml sirop',dci:'Amoxicilline',forme:'sirop',unite:'flacon',px_achat:900,px_cession:1500,stock:50,seuil:15,categorie:'Antibiotique'},
  {id:'M009',nom:'Ceftriaxone 1g inj',dci:'Ceftriaxone',forme:'inj',unite:'flacon',px_achat:1500,px_cession:2500,stock:40,seuil:10,categorie:'Antibiotique'},
  {id:'M010',nom:'Azithromycine 250mg cp',dci:'Azithromycine',forme:'cp',unite:'cp',px_achat:200,px_cession:400,stock:200,seuil:40,categorie:'Antibiotique'},
  {id:'M011',nom:'Métronidazole 500mg cp',dci:'Métronidazole',forme:'cp',unite:'cp',px_achat:50,px_cession:150,stock:300,seuil:60,categorie:'Antibiotique'},
  {id:'M012',nom:'Métronidazole 500mg/100ml perf',dci:'Métronidazole',forme:'perf',unite:'flacon',px_achat:1200,px_cession:2000,stock:25,seuil:8,categorie:'Antibiotique'},
  {id:'M013',nom:'Doxycycline 100mg cp',dci:'Doxycycline',forme:'cp',unite:'cp',px_achat:100,px_cession:250,stock:200,seuil:40,categorie:'Antibiotique'},
  {id:'M014',nom:'Cotrimoxazole 480mg cp',dci:'Cotrimoxazole',forme:'cp',unite:'cp',px_achat:30,px_cession:80,stock:400,seuil:80,categorie:'Antibiotique'},
  {id:'M015',nom:'Gentamicine 80mg inj',dci:'Gentamicine',forme:'inj',unite:'ampoule',px_achat:300,px_cession:600,stock:50,seuil:10,categorie:'Antibiotique'},
  {id:'M016',nom:'Ringer Lactate 500ml',dci:'RL',forme:'perf',unite:'flacon',px_achat:600,px_cession:900,stock:60,seuil:20,categorie:'Soluté'},
  {id:'M017',nom:'Sérum physiologique 500ml',dci:'NaCl 0.9%',forme:'perf',unite:'flacon',px_achat:500,px_cession:800,stock:60,seuil:20,categorie:'Soluté'},
  {id:'M018',nom:'Sérum glucosé 5% 500ml',dci:'SG5%',forme:'perf',unite:'flacon',px_achat:550,px_cession:850,stock:40,seuil:15,categorie:'Soluté'},
  {id:'M019',nom:'Vitamine C 250mg amp inj',dci:'Ascorbate',forme:'inj',unite:'ampoule',px_achat:100,px_cession:200,stock:100,seuil:20,categorie:'Vitamines'},
  {id:'M020',nom:'Vitamine B complexe amp',dci:'Vit B',forme:'inj',unite:'ampoule',px_achat:150,px_cession:300,stock:80,seuil:15,categorie:'Vitamines'},
  {id:'M021',nom:'Oméprazole 20mg cp',dci:'Oméprazole',forme:'cp',unite:'cp',px_achat:80,px_cession:200,stock:200,seuil:40,categorie:'Gastro'},
  {id:'M022',nom:'Ranitidine 150mg cp',dci:'Ranitidine',forme:'cp',unite:'cp',px_achat:50,px_cession:150,stock:200,seuil:40,categorie:'Gastro'},
  {id:'M023',nom:'Métoclopramide 10mg cp',dci:'Métoclopramide',forme:'cp',unite:'cp',px_achat:30,px_cession:80,stock:150,seuil:30,categorie:'Gastro'},
  {id:'M024',nom:'SRO sachet',dci:'SRO',forme:'sachet',unite:'sachet',px_achat:50,px_cession:150,stock:200,seuil:50,categorie:'Gastro'},
  {id:'M025',nom:'Tramadol 50mg cp',dci:'Tramadol',forme:'cp',unite:'cp',px_achat:100,px_cession:300,stock:100,seuil:20,categorie:'Antalgique'},
  {id:'M026',nom:'Diclofénac 75mg inj',dci:'Diclofénac',forme:'inj',unite:'ampoule',px_achat:200,px_cession:400,stock:60,seuil:12,categorie:'AINS'},
  {id:'M027',nom:'Prednisolone 5mg cp',dci:'Prednisolone',forme:'cp',unite:'cp',px_achat:30,px_cession:100,stock:200,seuil:40,categorie:'Corticoïde'},
  {id:'M028',nom:'Dexaméthasone 4mg inj',dci:'Dexaméthasone',forme:'inj',unite:'ampoule',px_achat:300,px_cession:600,stock:40,seuil:10,categorie:'Corticoïde'},
  {id:'M029',nom:'Salbutamol inhalateur',dci:'Salbutamol',forme:'inhaler',unite:'flacon',px_achat:2000,px_cession:3000,stock:15,seuil:4,categorie:'Resp.'},
  {id:'M030',nom:'Loratadine 10mg cp',dci:'Loratadine',forme:'cp',unite:'cp',px_achat:50,px_cession:150,stock:150,seuil:30,categorie:'Antihistaminique'},
  {id:'M031',nom:'Furosémide 40mg cp',dci:'Furosémide',forme:'cp',unite:'cp',px_achat:30,px_cession:100,stock:100,seuil:20,categorie:'Diurétique'},
  {id:'M032',nom:'Amlodipine 5mg cp',dci:'Amlodipine',forme:'cp',unite:'cp',px_achat:50,px_cession:150,stock:150,seuil:30,categorie:'Cardio'},
  {id:'M033',nom:'Captopril 25mg cp',dci:'Captopril',forme:'cp',unite:'cp',px_achat:30,px_cession:100,stock:150,seuil:30,categorie:'Cardio'},
  {id:'M034',nom:'Diazépam 5mg cp',dci:'Diazépam',forme:'cp',unite:'cp',px_achat:30,px_cession:100,stock:60,seuil:12,categorie:'Psycho'},
  {id:'M035',nom:'Glibenclamide 5mg cp',dci:'Glibenclamide',forme:'cp',unite:'cp',px_achat:20,px_cession:60,stock:100,seuil:20,categorie:'Diabète'},
  {id:'M036',nom:'Alcool 90° (flacon 250ml)',dci:'—',forme:'flacon',unite:'flacon',px_achat:500,px_cession:800,stock:30,seuil:8,categorie:'Consommable'},
  {id:'M037',nom:'Eau oxygénée 10vol (250ml)',dci:'—',forme:'flacon',unite:'flacon',px_achat:400,px_cession:700,stock:25,seuil:8,categorie:'Consommable'},
  {id:'M038',nom:'Compresses stériles 10×10 (boite/10)',dci:'—',forme:'boite',unite:'boite',px_achat:500,px_cession:800,stock:50,seuil:15,categorie:'Consommable'},
  {id:'M039',nom:'Gants latex M (boite/100)',dci:'—',forme:'boite',unite:'boite',px_achat:3000,px_cession:4500,stock:20,seuil:5,categorie:'Consommable'},
  {id:'M040',nom:'Seringue 5ml (boite/100)',dci:'—',forme:'boite',unite:'boite',px_achat:4000,px_cession:6000,stock:12,seuil:4,categorie:'Consommable'},
  {id:'M041',nom:'Perfuseur (unité)',dci:'—',forme:'unité',unite:'pièce',px_achat:300,px_cession:500,stock:50,seuil:10,categorie:'Consommable'},
  {id:'M042',nom:'Sparadrap (rouleau)',dci:'—',forme:'rouleau',unite:'rouleau',px_achat:500,px_cession:800,stock:20,seuil:5,categorie:'Consommable'},
];
const isDemoMedicineId=(id)=>/^M(?:00[1-9]|0[1-3][0-9]|04[0-2])$/.test(String(id||''));

function cmuMarkup(med){ return Number.isFinite(+med?.cmu_markup_pct)?+med.cmu_markup_pct:15; }
function pxCMU(med){
  if(!med?.cmu_eligible) return 0;
  const base=+med.px_cession||0;
  return Math.round(base*(1+cmuMarkup(med)/100));
}
function pxNA(med){ return Math.round((med.px_na ?? med.px_cession) || 0); }
function productMargin(salePrice,purchasePrice){
  const sale=+salePrice||0,purchase=+purchasePrice||0;
  return {amount:sale-purchase,rate:purchase>0?((sale-purchase)/purchase*100):0};
}
const PHARMA_FORMS = [
  'Non applicable','Aérosol','Capsule','Collyre','Comprimé','Comprimé LP','Crème dermique',
  'Gel buvable','Gel dermique','Gélule','Ovule','Pommade dermique',
  'Pommade ophtalmique','Poudre pour solution injectable','Sirop',
  'Solution auriculaire','Solution buvable','Solution dermique',
  'Solution injectable','Solution nasale','Solution perfusable',
  'Solution vaginale','Spray buccal','Suppositoire','Suspension buvable'
];
const PHARMA_PACKS = [
  'Ampoule','Boîte','Comprimé / unité','Flacon','Gélule / unité','Ovule / unité',
  'Paquet','Plaquette','Poche','Rouleau','Sachet','Seringue','Suppositoire / unité',
  'Tube','Unité'
];
function catalogueKey(value){
  return String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
}
function canonicalPharmaForm(value){
  const key=catalogueKey(value);
  const map={
    'AEROSOL':'Aérosol','CAPSULE':'Capsule','COLLYRE':'Collyre',
    'COMPRIME':'Comprimé','COMPRIME LP':'Comprimé LP','CREME':'Crème dermique',
    'CREME DERMIQUE':'Crème dermique','GEL BUVABLE':'Gel buvable',
    'GEL DERMIQUE':'Gel dermique','GELULE':'Gélule','INJECTABLE':'Solution injectable',
    'INJECTABLE POUDRE':'Poudre pour solution injectable','OVULE':'Ovule',
    'POMMADE':'Pommade dermique','POMMADE DERMIQUE':'Pommade dermique',
    'POMMADE OPHTALMIQUE':'Pommade ophtalmique','SIROP':'Sirop',
    'SOLUTION':'Solution','SOLUTION AURICULAIRE':'Solution auriculaire',
    'SOLUTION BUVABLE':'Solution buvable','SOLUTION DERMIQUE':'Solution dermique',
    'SOLUTION EXTERNE':'Solution dermique','SOLUTION INJECTABLE':'Solution injectable',
    'SOLUTION NASALE':'Solution nasale','SOLUTION PERFUSABLE':'Solution perfusable',
    'SOLUTION VAGINALE':'Solution vaginale','SPRAY BUCCAL':'Spray buccal',
    'SUPPOSITOIRE':'Suppositoire','SUSPENSION':'Suspension',
    'SUSPENSION BUVABLE':'Suspension buvable',
    'SUSPENSION INJECTABLE':'Suspension injectable'
  };
  if(key.includes('/')) return key.split('/').map(part=>map[part.trim()]||part.trim()).join(' / ');
  return map[key]||String(value||'').trim()||'Non renseignée';
}
function pharmaForm(m){
  return catalogueKey(m?.type_produit)==='CONSOMMABLE'
    ? 'Non applicable'
    : canonicalPharmaForm(m?.forme);
}
function canonicalPharmaPack(value){
  const key=catalogueKey(value);
  const map={
    'AMPOULE':'Ampoule','BOITE':'Boîte','COMPRIME':'Comprimé / unité',
    'COMPRIME / UNITE':'Comprimé / unité','FLACON':'Flacon',
    'GELULE':'Gélule / unité','GELULE / UNITE':'Gélule / unité',
    'OVULE':'Ovule / unité','PAQUET':'Paquet','PLAQUETTE':'Plaquette',
    'POCHE':'Poche','ROULEAU':'Rouleau','SACHET':'Sachet',
    'SACHET / BOITE':'Sachet / boîte','SERINGUE':'Seringue',
    'SOLIDE':'Unité','SUPPOSITOIRE':'Suppositoire / unité','TUBE':'Tube',
    'U':'Unité','UNITE':'Unité'
  };
  return map[key]||String(value||'').trim()||'Non renseigné';
}
function normalizeEan(value){ return String(value||'').replace(/\D/g,'').slice(0,14); }
function isValidEan(value){
  const ean=normalizeEan(value);
  if(!ean) return true;
  if(![8,12,13,14].includes(ean.length)) return false;
  const digits=[...ean].map(Number);
  const check=digits.pop();
  const sum=digits.reverse().reduce((total,digit,index)=>total+digit*(index%2===0?3:1),0);
  return (10-(sum%10))%10===check;
}

// ════════════════════════════════════════════════════════
// CATALOGUE LABO — 40+ actes NGAMB
// ════════════════════════════════════════════════════════
const LABO_ACTES = [
  // Hématologie
  {code:'BEDA005',nom:'NFS / Hémogramme complet',cat:'Hématologie',cot:29,tube:'EDTA violet'},
  {code:'BEDA001',nom:'Numération plaquettaire',cat:'Hématologie',cot:15,tube:'EDTA violet'},
  {code:'BEDC001',nom:'Groupage ABO-Rh(D)',cat:'Hématologie',cot:35,tube:'EDTA violet'},
  {code:'BEDB004',nom:'Hémostase TP+TCA',cat:'Hématologie',cot:50,tube:'Citrate bleu'},
  {code:'BEDB003',nom:'INR (anticoagulants)',cat:'Hématologie',cot:30,tube:'Citrate bleu'},
  {code:'BEDD001',nom:'VS (vitesse sédimentation)',cat:'Hématologie',cot:10,tube:'Citrate bleu'},
  {code:'BEDB001',nom:'TP seul',cat:'Hématologie',cot:20,tube:'Citrate bleu'},
  // Biochimie
  {code:'BNDA008',nom:'Glycémie',cat:'Biochimie',cot:5,tube:'Fluorure gris'},
  {code:'BNDA009',nom:'HbA1c',cat:'Biochimie',cot:30,tube:'EDTA violet'},
  {code:'BNDA012',nom:'Urée sanguine',cat:'Biochimie',cot:7,tube:'Sec/gel jaune'},
  {code:'BNDA013',nom:'Créatinine',cat:'Biochimie',cot:7,tube:'Sec/gel jaune'},
  {code:'BNDA014',nom:'Urée + Créatinine (bilan rénal)',cat:'Biochimie',cot:14,tube:'Sec/gel jaune'},
  {code:'BLDA007',nom:'Transaminases ALAT+ASAT',cat:'Biochimie',cot:11,tube:'Sec/gel jaune'},
  {code:'BLDA005',nom:'ALAT (TGP) seul',cat:'Biochimie',cot:6,tube:'Sec/gel jaune'},
  {code:'BLDA006',nom:'ASAT (TGO) seul',cat:'Biochimie',cot:6,tube:'Sec/gel jaune'},
  {code:'BLDB003',nom:'Bilirubine totale + directe',cat:'Biochimie',cot:18,tube:'Sec/gel jaune'},
  {code:'BLDA004',nom:'Phosphatases alcalines (PAL)',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BLDA008',nom:'GGT (gamma-GT)',cat:'Biochimie',cot:10,tube:'Sec/gel jaune'},
  {code:'BMDA003',nom:'CRP',cat:'Biochimie',cot:10,tube:'Sec/gel jaune'},
  {code:'BMDA002',nom:'Protéines totales',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BMDA001',nom:'Albumine',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BNDC001',nom:'Calcium sérique',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BNDC002',nom:'Phosphore sérique',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BNDB002',nom:'Acide urique',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BNDB001',nom:'Cholestérol total',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BNDB003',nom:'Triglycérides',cat:'Biochimie',cot:8,tube:'Sec/gel jaune'},
  {code:'BNDB005',nom:'Bilan lipidique complet (CT+TG+HDL+LDL)',cat:'Biochimie',cot:40,tube:'Sec/gel jaune'},
  // Sérologie / Immunologie
  {code:'BYDZ001',nom:'TDR Paludisme (Pf/Pan)',cat:'Sérologie',cot:30,tube:'Sang total'},
  {code:'BYDZ004',nom:'TDR AgHBs (Hépatite B)',cat:'Sérologie',cot:30,tube:'Sec/gel jaune'},
  {code:'BGDE071',nom:'TDR VIH 1&2',cat:'Sérologie',cot:52,tube:'Sang total'},
  {code:'BGDC019',nom:'Widal (typhoïde)',cat:'Sérologie',cot:40,tube:'Sec/gel jaune'},
  {code:'BGDC022',nom:'VDRL (syphilis)',cat:'Sérologie',cot:20,tube:'Sec/gel jaune'},
  {code:'BGDE083',nom:'TDR COVID-19 Ag',cat:'Sérologie',cot:40,tube:'Écouvillon'},
  {code:'BGDD001',nom:'Test de grossesse (β-hCG qualitatif)',cat:'Sérologie',cot:20,tube:'Urine/sang'},
  {code:'BGDD002',nom:'Test de grossesse quantitatif (β-hCG)',cat:'Sérologie',cot:40,tube:'Sec/gel jaune'},
  // Bactériologie / Parasitologie
  {code:'BFDA001',nom:'ECBU (examen cytobactériologique urine)',cat:'Bactériologie',cot:65,tube:'Flacon ECBU'},
  {code:'BFDC011',nom:'BK microscopie directe (crachat)',cat:'Bactériologie',cot:30,tube:'Pot crachat'},
  {code:'BFDB001',nom:'Hémoculture (1 flacon)',cat:'Bactériologie',cot:80,tube:'Flacon hémo'},
  {code:'BFDB004',nom:'Coproculture',cat:'Bactériologie',cot:60,tube:'Pot selles'},
  {code:'BFDB005',nom:'Examen parasitologique selles (EPS)',cat:'Parasitologie',cot:30,tube:'Pot selles'},
  {code:'BFDB006',nom:'Goutte épaisse / frottis (paludisme)',cat:'Parasitologie',cot:25,tube:'Lame sang'},
  {code:'BFDB007',nom:'GE + frottis + TDR Palu',cat:'Parasitologie',cot:50,tube:'Lame + sang total'},
];

// SOINS INFIRMIERS (AMI)
const SOINS_ACTES = [
  {code:'TEDY001',nom:'Prélèvement veineux',cat:'Prélèvement',cot:5,amtFPM:0,unite:'AMI'},
  {code:'TETY005',nom:'Injection intramusculaire (IM)',cat:'Injection',cot:1,amtFPM:0,unite:'AMI'},
  {code:'TETY006',nom:'Injection intraveineuse directe (IVD)',cat:'Injection',cot:2,amtFPM:0,unite:'AMI'},
  {code:'TETY012',nom:'Perfusion IV (montage + surveillance)',cat:'Perfusion',cot:12,amtFPM:0,unite:'AMI'},
  {code:'TETY013',nom:'Perfusion IV 2ème flacon',cat:'Perfusion',cot:8,amtFPM:0,unite:'AMI'},
  {code:'TEZZ001',nom:'Pansement simple',cat:'Pansement',cot:5,amtFPM:0,unite:'AMI'},
  {code:'TEZZ002',nom:'Pansement complexe (plaie large/brûlure)',cat:'Pansement',cot:15,amtFPM:0,unite:'AMI'},
  {code:'TEZZ003',nom:'Suture (par point) — max 5 pts',cat:'Suture',cot:30,amtFPM:0,unite:'AMI'},
  {code:'TEZZ004',nom:'Suture (>5 points)',cat:'Suture',cot:50,amtFPM:0,unite:'AMI'},
  {code:'TEZZ005',nom:'Ablation de points de suture',cat:'Soins',cot:5,amtFPM:0,unite:'AMI'},
  {code:'TEZZ006',nom:'Nettoyage et détersion de plaie',cat:'Soins',cot:8,amtFPM:0,unite:'AMI'},
  {code:'TEZZ007',nom:'Pose d\'attelle plâtrée',cat:'Immobilisation',cot:50,amtFPM:0,unite:'AMI'},
  {code:'TEZZ008',nom:'Pose de sonde urinaire (sondage)',cat:'Sondage',cot:30,amtFPM:0,unite:'AMI'},
  {code:'TEZZ009',nom:'Lavement / évacuation intestinale',cat:'Soins',cot:15,amtFPM:0,unite:'AMI'},
  {code:'TEZZ010',nom:'Mesure constantes (TA+T°+Pouls)',cat:'Surveillance',cot:2,amtFPM:0,unite:'AMI'},
  {code:'TEZZ011',nom:'Nébulisation / aérosol',cat:'Resp.',cot:10,amtFPM:0,unite:'AMI'},
  {code:'TEZZ012',nom:'Pose de voie veineuse périphérique',cat:'Perfusion',cot:15,amtFPM:0,unite:'AMI'},
  {code:'TEZZ013',nom:'Bandelette urinaire (BU)',cat:'Analyse',cot:5,amtFPM:0,unite:'AMI'},
  {code:'TEZZ014',nom:'Glycémie capillaire (dextro)',cat:'Analyse',cot:3,amtFPM:0,unite:'AMI'},
  {code:'TEZZ015',nom:'Mise en observation / surveillance 24h',cat:'Observation',cot:0,amtFPM:0,unite:'FORFAIT'},
];

// ════════════════════════════════════════════════════════
// STOCKAGE LOCAL
// ════════════════════════════════════════════════════════
const DB = {
  get:(k)=>{ try{return JSON.parse(localStorage.getItem('csa2_'+k)||'[]');}catch{return[];} },
  set:(k,v)=>{ localStorage.setItem('csa2_'+k,JSON.stringify(v)); },
  push:(k,item)=>{
    if(!CURRENT_AGENT) throw new Error('Session authentifiée requise');
    const arr=DB.get(k);
    item.id=item.id||Date.now()+'_'+Math.random().toString(36).substr(2,5);
    item.created_at=item.created_at||new Date().toISOString();
    item.updated_at=new Date().toISOString();
    item.agent_id=CURRENT_AGENT?.id||'?';
    item.agent_nom=CURRENT_AGENT?.nom||'?';
    item.synced=false;
    arr.unshift(item);
    DB.set(k,arr.slice(0,3000));
    queueSync(k,item);
    if(IS_ONLINE&&supa) syncQueue();
    return item;
  },
  today:()=>new Date().toISOString().slice(0,10),
  todayItems:(k)=>DB.get(k).filter(i=>i.created_at&&i.created_at.startsWith(DB.today())),
  getStock:()=>{
    return DB.get('pharma_stock')
      .filter(m=>m.active!==false&&!isDemoMedicineId(m.id))
      .map(m=>({...m,px_na:(m.px_na??m.px_cession)}));
  },
  setStock:(stock)=>{
    if(!CURRENT_AGENT) throw new Error('Session authentifiée requise');
    const now=new Date().toISOString();
    const rows=stock.map(m=>({...m,updated_at:now,agent_id:CURRENT_AGENT.id,agent_nom:CURRENT_AGENT.nom,synced:false}));
    DB.set('pharma_stock',rows);
    rows.forEach(item=>queueSync('pharma_stock',item));
    if(IS_ONLINE&&supa) syncQueue();
  },
  getLots:()=>DB.get('pharma_lots').filter(l=>l.active!==false&&!isDemoMedicineId(l.med_id)),
  setLots:(lots)=>{
    if(!CURRENT_AGENT) throw new Error('Session authentifiée requise');
    const now=new Date().toISOString();
    const rows=lots.map(l=>({...l,updated_at:now,agent_id:CURRENT_AGENT.id,agent_nom:CURRENT_AGENT.nom,synced:false}));
    DB.set('pharma_lots',rows);
    rows.forEach(item=>queueSync('pharma_lots',item));
    if(IS_ONLINE&&supa) syncQueue();
  },
  setInventaires:(rows)=>{
    DB.set('pharma_inventaires',rows);
    rows.forEach(item=>queueSync('pharma_inventaires',item));
    if(IS_ONLINE&&supa) syncQueue();
  },
};

// ════════════════════════════════════════════════════════
// AUTH & SESSION
// ════════════════════════════════════════════════════════
let CURRENT_AGENT = null;
let MFA_STATE = null;
let COMPACT_MODE = localStorage.getItem('csa2_compact')==='1';

const MODULE_TABS = {
  accueil:['acc-reception','acc-constantes','acc-consultation','acc-liste'],
  soins:  ['acc-consultation','acc-constantes','soins-actes','soins-obs','soins-liste'],
  labo:   ['labo-saisie','labo-resultats','labo-feuilles'],
  pharmacie:['pha-vente','pha-stock','pha-catalogue','pha-mouvements','pha-inventaire','pha-tableau'],
  compta: ['cpt-caisse','cpt-cloture','cpt-rapports'],
  chef:   ['chef-dashboard','acc-consultation','chef-patients','chef-dossier','chef-pharmacie','chef-alertes','chef-sevci','sevci-file','sevci-actions-liste','chef-mensuel','chef-prix','chef-audit','chef-exports'],
  sevci:  ['sevci-file','sevci-cv','sevci-indicateurs','sevci-communautaire','sevci-actions-liste','sevci-supervision','sevci-dsasa'],
};
const PERMISSION_TABS = {
  accueil:MODULE_TABS.accueil,
  as:['acc-reception','acc-constantes','acc-liste'],
  soins:MODULE_TABS.soins,
  labo:MODULE_TABS.labo,
  pharmacie:MODULE_TABS.pharmacie,
  compta:MODULE_TABS.compta,
  chef:MODULE_TABS.chef,
  sevci:MODULE_TABS.sevci,
  sevci_med:['sevci-communautaire','sevci-actions-liste'],
  sevci_data:['sevci-file','sevci-cv','sevci-indicateurs'],
  sevci_sup:['sevci-supervision','sevci-actions-liste','sevci-file','sevci-dsasa'],
};
const TAB_LABELS = {
  'acc-reception':'Accueil patient','acc-constantes':'Constantes','acc-consultation':'Consultation','acc-liste':'File du jour',
  'soins-actes':'Réaliser soins','soins-obs':'Observation','soins-liste':'Soins du jour',
  'labo-saisie':'Saisie actes','labo-resultats':'Résultats','labo-feuilles':'Feuilles CMU',
  'pha-vente':'Délivrance','pha-stock':'Stock & lots','pha-catalogue':'Catalogue','pha-mouvements':'Mouvements','pha-inventaire':'Inventaire','pha-tableau':'Tableau de bord',
  'cpt-caisse':'Caisse du jour','cpt-cloture':'Clôture','cpt-rapports':'Rapports',
  'chef-dashboard':'Tableau de bord','chef-alertes':'Alertes','chef-patients':'Dossiers patients','chef-dossier':'Dossier complet','chef-pharmacie':'Pharmacie','chef-sevci':'Synthèse PVVIH','chef-mensuel':'Statistiques','chef-prix':'Gestion prix','chef-audit':'Traçabilité','chef-exports':'Exports',
  'sevci-file':'File active','sevci-cv':'Charge virale','sevci-indicateurs':'Indicateurs','sevci-communautaire':'Action communautaire','sevci-actions-liste':'Actions','sevci-supervision':'Supervision','sevci-dsasa':'Rapport DSASA',
};

async function authLogin(event){
  event.preventDefault();
  const submit=document.getElementById('auth-submit');
  const errorEl=document.getElementById('auth-error');
  submit.disabled=true;
  errorEl.textContent='';
  const email=document.getElementById('auth-email').value.trim();
  const password=document.getElementById('auth-password').value;
  const {error}=await supa.auth.signInWithPassword({email,password});
  if(error){
    errorEl.textContent='Connexion refusée. Vérifiez vos identifiants.';
    submit.disabled=false;
  }
}
async function loadAuthenticatedProfile(session){
  if(!session?.user) return false;
  const {data,error}=await supa.from('csa_profiles')
    .select('agent_code,display_name,job_title,module,permissions,building,is_chef,active')
    .eq('user_id',session.user.id).single();
  if(error||!data?.active||!MODULE_TABS[data.module]){
    await supa.auth.signOut();
    document.getElementById('auth-error').textContent='Compte non autorisé ou profil incomplet.';
    return false;
  }
  CURRENT_AGENT={
    id:data.agent_code,
    nom:data.display_name,
    role:data.job_title,
    module:data.module,
    permissions:Array.isArray(data.permissions)&&data.permissions.length?data.permissions:[data.module],
    bldg:data.building||'',
    isChef:!!data.is_chef,
    userId:session.user.id
  };
  const needsMfa=CURRENT_AGENT.isChef||['sevci_med','sevci_data','sevci_sup'].some(r=>CURRENT_AGENT.permissions.includes(r));
  if(needsMfa&&!(await requireChiefMfa())) return false;
  startApp();
  await pullFromCloud();
  await syncQueue();
  return true;
}
async function requireChiefMfa(){
  const {data:aal,error:aalError}=await supa.auth.mfa.getAuthenticatorAssuranceLevel();
  if(aalError){
    document.getElementById('auth-error').textContent='Vérification MFA indisponible.';
    return false;
  }
  if(aal.currentLevel==='aal2') return true;

  const {data:factors,error:factorsError}=await supa.auth.mfa.listFactors();
  if(factorsError){
    document.getElementById('auth-error').textContent='Impossible de charger les facteurs MFA.';
    return false;
  }
  const verified=(factors?.totp||[]).find(f=>f.status==='verified');
  if(verified){
    MFA_STATE={factorId:verified.id,mode:'challenge'};
    showMfaScreen(false);
    return false;
  }

  for(const factor of (factors?.totp||[]).filter(f=>f.status!=='verified')){
    await supa.auth.mfa.unenroll({factorId:factor.id});
  }
  const {data:enrollment,error:enrollError}=await supa.auth.mfa.enroll({
    factorType:'totp',
    friendlyName:'CSA Plateau - Médecin-Chef'
  });
  if(enrollError||!enrollment?.id){
    document.getElementById('auth-error').textContent='Impossible d’activer la MFA.';
    return false;
  }
  MFA_STATE={factorId:enrollment.id,mode:'enroll'};
  const qr=enrollment.totp?.qr_code||'';
  document.getElementById('mfa-qr').src=qr.startsWith('<svg')
    ? 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr)
    : qr;
  document.getElementById('mfa-secret').textContent=enrollment.totp?.secret
    ? 'Clé manuelle : '+enrollment.totp.secret
    : '';
  showMfaScreen(true);
  return false;
}
function showMfaScreen(enrollment){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').style.display='none';
  document.getElementById('mfa-screen').style.display='flex';
  document.getElementById('mfa-qr-zone').style.display=enrollment?'block':'none';
  document.getElementById('mfa-instructions').textContent=enrollment
    ? 'Première connexion : configurez votre application Authenticator, puis saisissez le code affiché.'
    : 'Saisissez le code actuel de votre application Authenticator.';
  document.getElementById('mfa-code').value='';
  document.getElementById('mfa-error').textContent='';
}
async function verifyChiefMfa(event){
  event.preventDefault();
  if(!MFA_STATE) return;
  const submit=document.getElementById('mfa-submit');
  const errorEl=document.getElementById('mfa-error');
  const code=document.getElementById('mfa-code').value.trim();
  submit.disabled=true;
  errorEl.textContent='';
  const {error}=await supa.auth.mfa.challengeAndVerify({
    factorId:MFA_STATE.factorId,
    code
  });
  if(error){
    errorEl.textContent='Code incorrect ou expiré. Saisissez le nouveau code affiché.';
    submit.disabled=false;
    return;
  }
  MFA_STATE=null;
  document.getElementById('mfa-screen').style.display='none';
  submit.disabled=false;
  startApp();
  await pullFromCloud();
  await syncQueue();
}
function startApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('mod-title').textContent=CURRENT_AGENT.role;
  document.getElementById('agent-chip').textContent=CURRENT_AGENT.nom;
  ensurePatientDossiers();
  const tabs=getAllowedTabs();
  buildNav(tabs);
  showView(tabs[0]);
  updateSyncStatus();
  showConflictBanner();
}
// ════════════════════════════════════════════════════════
// PRODUCTION MONITORING - Immediate Recommendations
// ════════════════════════════════════════════════════════

// 1. CSP Violation Monitoring - Log all violations to audit_logs
document.addEventListener('securitypolicyviolation', (e) => {
  try {
    logAudit('CSP_VIOLATION', {
      violatedDirective: e.violatedDirective,
      blockedURI: e.blockedURI,
      sourceFile: e.sourceFile,
      lineNumber: e.lineNumber,
      columnNumber: e.columnNumber,
      timestamp: new Date().toISOString()
    });
    console.warn('[CSP VIOLATION LOGGED TO AUDIT]', {
      directive: e.violatedDirective,
      blockedURI: e.blockedURI
    });
  } catch(err) {
    console.error('[CSP MONITORING ERROR]', err);
  }
}, true);

// 2. Logout Cleanup Verification
async function verifyLogoutCleanup() {
  const sensitiveKeys = ['csa2_sq','csa2_patients','csa2_consultations','csa2_constantes','csa2_soins','csa2_observations','csa2_labo_actes','csa2_pharma_ventes','csa2_pharma_stock','csa2_transactions','csa2_clotures','csa2_audit_logs'];
  const beforeLogout = sensitiveKeys.filter(k => localStorage.getItem(k)).length;
  console.log('[LOGOUT VERIFICATION] Starting... Keys before logout:', beforeLogout);
  await logout();
  const afterLogout = sensitiveKeys.filter(k => localStorage.getItem(k)).length;
  const passed = afterLogout === 0;
  console.log('[LOGOUT VERIFICATION] COMPLETE', {status: passed ? 'PASS' : 'FAIL', keysRemoved: beforeLogout, keysRemaining: afterLogout});
  return passed;
}

// 3. Console Error Tracking
const consoleErrors = [];
window.addEventListener('error', (e) => {
  consoleErrors.push({message: e.message, source: e.filename, lineno: e.lineno, timestamp: new Date().toISOString()});
  if(consoleErrors.length > 100) consoleErrors.shift();
  console.warn('[ERROR TRACKED]', e.message);
});
function getConsoleErrors() { return consoleErrors; }

async function logout(){
  // Clear sensitive localStorage on logout
  ['csa2_sq','csa2_patients','csa2_consultations','csa2_constantes','csa2_soins','csa2_observations','csa2_labo_actes','csa2_pharma_ventes','csa2_pharma_stock','csa2_transactions','csa2_clotures','csa2_audit_logs'].forEach(k => localStorage.removeItem(k));
  await supa.auth.signOut();
  clearLocalClinicalData();
  CURRENT_AGENT=null;
  MFA_STATE=null;
  document.getElementById('app').style.display='none';
  document.getElementById('mfa-screen').style.display='none';
  document.getElementById('auth-screen').style.display='flex';
  document.getElementById('auth-form').reset();
  document.getElementById('auth-submit').disabled=false;
}
function buildNav(tabs){
  const rejetsToday = DB.todayItems('audit_logs').filter(l=>l.action==='CLOTURE_REJETEE').length;
  const cloturesToday = DB.todayItems('clotures');
  const excedentsToday = cloturesToday.filter(c=>(c.ecart||0)>0).length;
  document.getElementById('mod-nav').innerHTML=tabs.map(t=>`
    <button class="mod-tab" data-tab="${t}" onclick="showView('${t}')">${TAB_LABELS[t]||t}${t==='chef-audit'&&rejetsToday>0?` <span class="badge b-err" style="margin-left:6px" title="Rejets clôture du jour">${rejetsToday}</span>`:''}${t==='cpt-cloture'&&excedentsToday>0?` <span class="badge b-warn" style="margin-left:6px" title="Clôtures avec excédent du jour">+${excedentsToday}</span>`:''}</button>`).join('');
}
function getAllowedTabs(){
  if(!CURRENT_AGENT) return [];
  const permissions=CURRENT_AGENT.isChef?['chef']:(CURRENT_AGENT.permissions||[CURRENT_AGENT.module]);
  return [...new Set(permissions.flatMap(permission=>PERMISSION_TABS[permission]||[]))];
}
function showView(id){
  if(!CURRENT_AGENT) return;
  const allowed=getAllowedTabs();
  if(!allowed.includes(id)){
    logAudit('ACCESS_DENIED',{view:id});
    id=allowed[0];
  }
  document.querySelectorAll('.mod-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
  const c=document.getElementById('content');
  c.dataset.view=id;
  c.innerHTML='';
  const v=document.createElement('div');
  c.appendChild(v);
  VIEW[id]?.(v);
}

// ════════════════════════════════════════════════════════
// UTILITAIRES
// ════════════════════════════════════════════════════════
const fmt=(n,d=0)=>Math.round(n||0).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtD=(d)=>new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
const fmtT=(d)=>new Date(d).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
const today=()=>new Date().toISOString().slice(0,10);
const uid=()=>Date.now()+'_'+Math.random().toString(36).substr(2,5);
const escHtml=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=(s,map={FPM:'b-fpm',CMU:'b-cmu',NA:'b-na',STAGE:'b-stage',OK:'b-ok',WARN:'b-warn',ERR:'b-err'})=>`<span class="badge ${map[s]||'b-ok'}">${escHtml(s)}</span>`;
function getCurrentYYMM(){
  const d=new Date();
  return String(d.getFullYear()).slice(-2)+String(d.getMonth()+1).padStart(2,'0');
}
function generatePatientDossier(){
  const yymm=getCurrentYYMM();
  const random=globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase()
    : Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
  return `CSA-${yymm}-${random}`;
}
function buildDossierForDate(d,seq){
  const dt=d?new Date(d):new Date();
  const yymm=String(dt.getFullYear()).slice(-2)+String(dt.getMonth()+1).padStart(2,'0');
  return `CSA-${yymm}-${String(seq).padStart(5,'0')}`;
}
function ensurePatientDossiers(){
  const patients=DB.get('patients');
  if(!patients.length) return;
  const byMonth={};
  const changed=[];
  [...patients].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))).forEach(p=>{
    if(p.dossier_no) return;
    const dt=p.created_at||new Date().toISOString();
    const m=dt.slice(2,4)+dt.slice(5,7);
    byMonth[m]=(byMonth[m]||0)+1;
    p.dossier_no=buildDossierForDate(dt,byMonth[m]);
    changed.push(p);
  });
  DB.set('patients',patients);
  changed.forEach(p=>queueSync('patients',p));
}
function getPatientById(id){
  return DB.get('patients').find(p=>p.id===id)||null;
}
function logAudit(action,details={}){
  DB.push('audit_logs',{
    action,
    details,
    module:CURRENT_AGENT?.module||'?',
    role:CURRENT_AGENT?.role||'?',
    date:today(),
    heure:new Date().toLocaleTimeString('fr-FR')
  });
}
function lotExpiryState(lot){
  if(!lot?.date_peremption) return {label:'NON RENSEIGNÉE',cls:'b-warn',days:null};
  const end=new Date(lot.date_peremption+'T23:59:59');
  const days=Math.ceil((end-new Date())/86400000);
  if(days<0) return {label:'PÉRIMÉ',cls:'b-err',days};
  if(days<=30) return {label:`${days} j`,cls:'b-err',days};
  if(days<=90) return {label:`${days} j`,cls:'b-warn',days};
  return {label:`${days} j`,cls:'b-ok',days};
}
function isOperationalStockAlert(med){
  return med?.catalogue_status!=='A_INVENTORIER' && (+med?.stock||0)<=(+med?.seuil||0);
}
function ensureLotCoverage(med,lots){
  const tracked=lots.filter(l=>l.med_id===med.id).reduce((s,l)=>s+(+l.quantite||0),0);
  const missing=Math.max(0,(+med.stock||0)-tracked);
  if(missing>0){
    lots.push({
      id:'LOT-LEGACY-'+med.id,
      med_id:med.id,
      medicament:med.nom,
      numero_lot:'HISTORIQUE',
      date_peremption:'',
      fournisseur:'Stock antérieur',
      quantite:missing,
      quantite_initiale:missing,
      created_at:new Date().toISOString()
    });
  }
  return lots;
}
function consumeLots(med,lots,qty){
  ensureLotCoverage(med,lots);
  const available=lots
    .filter(l=>l.med_id===med.id&&(+l.quantite||0)>0&&(!l.date_peremption||l.date_peremption>=today()))
    .sort((a,b)=>{
      const ad=a.date_peremption||'9999-12-31',bd=b.date_peremption||'9999-12-31';
      return ad.localeCompare(bd)||String(a.created_at||'').localeCompare(String(b.created_at||''));
    });
  let remaining=qty;
  const allocations=[];
  for(const lot of available){
    if(remaining<=0) break;
    const used=Math.min(remaining,+lot.quantite||0);
    lot.quantite=(+lot.quantite||0)-used;
    remaining-=used;
    allocations.push({lot_id:lot.id,numero_lot:lot.numero_lot||'—',date_peremption:lot.date_peremption||'',quantite:used});
  }
  if(remaining>0) throw new Error(`Lots insuffisants pour ${med.nom}`);
  return allocations;
}
function recordStockMovement(data){
  return DB.push('pharma_mouvements',{
    type:data.type,
    med_id:data.med_id,
    medicament:data.medicament,
    quantite:+data.quantite||0,
    stock_avant:+data.stock_avant||0,
    stock_apres:+data.stock_apres||0,
    lot_id:data.lot_id||'',
    numero_lot:data.numero_lot||'',
    date_peremption:data.date_peremption||'',
    motif:data.motif||'',
    reference:data.reference||'',
    date:today()
  });
}
// Identifiant unique d'événement client (UUID v4) pour la synchro idempotente.
function newClientEventId(){
  try{ if(crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16);
  });
}
function queueSync(table,item){
  if(!SYNC_TABLES.includes(table)||!item?.id) return;
  const op={table,item:{...item,updated_at:new Date().toISOString(),synced:false,client_event_id:newClientEventId()}};
  const key=table+':'+item.id;
  SYNC_Q=SYNC_Q.filter(existing=>(existing.table+':'+existing.item?.id)!==key);
  SYNC_Q.push(op);
  localStorage.setItem('csa2_sq',JSON.stringify(SYNC_Q));
}
function persistUpdatedRecord(table,rows,item){
  item.updated_at=new Date().toISOString();
  item.agent_id=CURRENT_AGENT?.id||item.agent_id||'?';
  item.agent_nom=CURRENT_AGENT?.nom||item.agent_nom||'?';
  item.synced=false;
  DB.set(table,rows);
  queueSync(table,item);
  if(IS_ONLINE&&supa) syncQueue();
}
function clearLocalClinicalData(){
  SYNC_TABLES.forEach(k=>localStorage.removeItem('csa2_'+k));
  localStorage.removeItem('csa2_sq');
  localStorage.removeItem('csa2_stock');
  SYNC_Q=[];
}
function escSQ(v){
  return String(v||'').replace(/[\\'"\n\r&<>]/g,(c)=>({'\\':'\\\\','\'':'\\\'','"':'&quot;','\n':'\\n','\r':'\\r','&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}
function getBillingStatut(patient){
  const base=(patient?.statut_simple||patient?.statut||'NA');
  const droits=String(patient?.droits_verifies??'1');
  return droits==='1'?base:'NA';
}
function getEffectiveBillingStatut(patientId,selectedStatut){
  const p=patientId?getPatientById(patientId):null;
  return p?getBillingStatut(p):(selectedStatut||'NA');
}
function getLatestConstantes(patientId){
  return DB.get('constantes').find(c=>c.patient_id===patientId)||null;
}
function getAlertFlags(c){
  if(!c) return [];
  const flags=[];
  const temp=parseFloat(c.temperature||0);
  const spo2=parseFloat(c.spo2||0);
  const imc=parseFloat(c.imc||0);
  const ta=String(c.ta||'').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if(temp>=38) flags.push({lvl:'err',msg:`T° ${temp}°C`});
  if(spo2>0&&spo2<94) flags.push({lvl:'err',msg:`SpO2 ${spo2}%`});
  if(imc>=30) flags.push({lvl:'err',msg:`IMC ${imc.toFixed(1)} (obésité)`});
  else if(imc>=25) flags.push({lvl:'warn',msg:`IMC ${imc.toFixed(1)} (surpoids)`});
  if(ta){
    const sys=+ta[1],dia=+ta[2];
    if(sys>=140||dia>=90) flags.push({lvl:'warn',msg:`TA ${sys}/${dia}`});
  }
  return flags;
}
function alertBadge(flag){
  return `<span class="badge ${flag.lvl==='err'?'b-err':'b-warn'}">${flag.msg}</span>`;
}
function getCriticalTodayPatients(){
  const pts=DB.todayItems('patients');
  return pts.map(p=>{
    const c=getLatestConstantes(p.id);
    const flags=getAlertFlags(c);
    const critical=flags.filter(f=>f.lvl==='err');
    return {patient:p,constantes:c,flags,critical};
  }).filter(x=>x.critical.length>0);
}
function renderCriticalBanner(module){
  const crit=getCriticalTodayPatients();
  if(!crit.length) return '';
  const rows=crit.slice(0,6).map(x=>`<div style="font-size:11px;padding:4px 0;border-bottom:1px dashed #f3c2c2">
    <strong>${escHtml(x.patient.nom)}</strong> — ${x.critical.map(c=>escHtml(c.msg)).join(' | ')}
  </div>`).join('');
  return `<div class="al al-err">
    <strong>🚨 Patients critiques du jour (${crit.length})</strong> — module ${escHtml(module)}
    <div style="margin-top:6px">${rows}</div>
  </div>`;
}
function renderClinicalSummary(patientId){
  const p=getPatientById(patientId);
  if(!p) return '';
  const lastConst=getLatestConstantes(patientId);
  const flags=getAlertFlags(lastConst);
  const consultations=DB.get('consultations').filter(c=>c.patient_id===patientId).slice(0,5);
  const prestataires=[...new Set(consultations.map(c=>c.agent_nom).filter(Boolean))];
  const hist=consultations.map(c=>`${fmtD(c.created_at)} - ${c.type} (${escHtml(c.agent_nom||'?')})`).join(' | ');
  return `<div class="fs" style="margin-top:8px">
    <div class="fs-title" style="color:var(--bleu)">Dossier clinique rapide</div>
    <div style="font-size:11px;margin-bottom:6px"><strong>Antécédents :</strong> ${escHtml(p.antecedents||'Non renseignés')}</div>
    <div style="font-size:11px;margin-bottom:6px"><strong>Prestataires antérieurs :</strong> ${prestataires.length?escHtml(prestataires.join(', ')):'—'}</div>
    <div style="font-size:11px;margin-bottom:6px"><strong>Anciennes consultations :</strong> ${hist?escHtml(hist):'—'}</div>
    <div style="font-size:11px;margin-bottom:6px"><strong>Dernières constantes :</strong> ${lastConst?`${lastConst.temperature||'—'}°C | TA ${escHtml(lastConst.ta||'—')} | SpO2 ${lastConst.spo2||'—'}% | IMC ${lastConst.imc||'—'}`:'Non disponibles'}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${flags.length?flags.map(alertBadge).join(''):'<span class="badge b-ok">Aucune alerte vitale</span>'}</div>
  </div>`;
}
function getOrientedPatients(serviceCode){
  const consultations=DB.get('consultations');
  const byPatient=new Map();
  consultations.forEach(c=>{
    if(!(c.orientations||[]).includes(serviceCode)) return;
    if(!byPatient.has(c.patient_id)) byPatient.set(c.patient_id,c);
  });
  return Array.from(byPatient.values());
}

let chartInst={};
function mkChart(id,type,labels,datasets,extraOptions={}){
  const ctx=document.getElementById(id);
  if(!ctx)return;
  if(typeof Chart==='undefined'){
    const host=ctx.parentElement||ctx;
    if(!host.querySelector('.chart-offline-msg')){
      host.insertAdjacentHTML('beforeend','<div class="al al-info chart-offline-msg" style="margin-top:8px">Graphique indisponible hors ligne (bibliotheque Chart.js absente).</div>');
    }
    return;
  }
  if(chartInst[id]){chartInst[id].destroy();}
  chartInst[id]=new Chart(ctx.getContext('2d'),{
    type,data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:true,
      plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:10}}},
      scales:type!=='doughnut'&&type!=='pie'?{y:{ticks:{callback:v=>fmt(v/1000)+'k',font:{size:9}},grid:{color:'#f0f0f0'}},x:{ticks:{font:{size:9}}}}:undefined,
      ...extraOptions}
  });
}

function printSection(id){
  const el=document.getElementById(id);
  if(!el)return;
  const w=window.open('','_blank');
  const logo = INSTITUTION_LOGO_URL ? `<div style="text-align:center;margin-bottom:8px"><img src="${INSTITUTION_LOGO_URL}" style="width:34px;height:34px;object-fit:contain" onerror="this.style.display='none'"></div>` : '';
  w.document.write(`<html><head><title>Impression CSA</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;} table{width:100%;border-collapse:collapse;} th{background:#0D2B45;color:white;padding:6px;} td{padding:5px;border:1px solid #ddd;} .recu{max-width:300px;margin:0 auto;} @media print{button{display:none}}</style>
    </head><body>${logo}${el.innerHTML}<script>window.print();<\/script></body></html>`);
  w.document.close();
}

// Saisie numérique tolérante : accepte la virgule décimale (pavé numérique FR)
function numFR(v){ return parseFloat(String(v==null?'':v).replace(',','.').trim())||0; }
// Taille : accepte cm (175) ou mètres (1,75 / 1.75) -> renvoie en cm
function tailleCm(v){ let t=numFR(v); if(t>0&&t<3) t=Math.round(t*100); return t; }

// IMC auto
function calcIMC(){
  const p=numFR(document.getElementById('const-poids')?.value);
  const t=tailleCm(document.getElementById('const-taille')?.value)/100||0;
  const el=document.getElementById('imc-display');
  if(!el||p<=0||t<=0){if(el)el.innerHTML='—';return;}
  const imc=p/(t*t);
  let lbl='',cl='';
  if(imc<18.5){lbl='Insuffisance pondérale';cl='background:#e3f2fd;color:#1565C0';}
  else if(imc<25){lbl='Poids normal ✓';cl='background:#e8f5e9;color:#2E7D32';}
  else if(imc<30){lbl='Surpoids';cl='background:#FFF8E1;color:#B8860B';}
  else{lbl='Obésité';cl='background:#ffebee;color:#C62828';}
  el.innerHTML=`<strong>${imc.toFixed(1)}</strong> <span class="imc-pill" style="${cl}">${lbl}</span>`;
}

// ════════════════════════════════════════════════════════
// VIEWS
// ════════════════════════════════════════════════════════
const VIEW = {};

// ── ACCUEIL — Réception patient ──────────────────────────
VIEW['acc-reception'] = (el) => {
  el.innerHTML=`
  <div class="g2">
    <div class="card">
      <div class="card-title">Nouveau patient — Bâtiment <span id="bldg-label" style="color:var(--marine)">${CURRENT_AGENT.bldg||'SOUS-PREFECTURE'}</span></div>
      <div class="fs">
        <div class="fs-title" style="color:var(--marine)">Identité</div>
        <div class="fr"><label>Nom & Prénom *</label><input type="text" id="p-nom" placeholder="Ex: KOUAME Jean"></div>
        <div class="fr"><label>Date de naissance</label><input type="date" id="p-ddn"></div>
        <div class="fr"><label>Genre</label><select id="p-genre"><option>M</option><option>F</option></select></div>
        <div class="fr"><label>Contact / Tél.</label><input type="text" id="p-tel" placeholder="07XXXXXXXX"></div>
        <div class="fr"><label>Adresse</label><input type="text" id="p-adr" placeholder="Quartier, ville"></div>
      </div>
      <div class="fs">
        <div class="fs-title" style="color:var(--fpm)">Régime & Droits</div>
        <div class="fr"><label>Statut *</label>
          <select id="p-statut" onchange="onStatutChange()">
            <option value="FPM_TIT">FPM — Titulaire militaire</option>
            <option value="FPM_AD">FPM — Ayant-droit (famille)</option>
            <option value="CMU">Assuré CMU</option>
            <option value="NA">Non-assuré</option>
          </select></div>
        <div id="fpm-section">
          <div class="fr"><label>N° carte FPM</label><input type="text" id="p-fpm" placeholder="FPM-XXXXXXXX"></div>
          <div class="fr" id="p-lien-wrap"><label>Lien avec le titulaire</label><input type="text" id="p-lien" placeholder="Ex: Épouse, enfant..."></div>
          <div class="fr"><label>Dispose d'une carte CMU ?</label><select id="p-cmu-dispo"><option value="1">Oui</option><option value="0">Non</option></select></div>
        </div>
        <div id="cmu-section" style="display:none">
          <div class="fr"><label>N° carte CMU</label><input type="text" id="p-cmu" placeholder="CMU-XXXXXXXXX"></div>
        </div>
        <div class="fr"><label>Droits vérifiés</label>
          <select id="p-droits"><option value="1">✅ Vérifiés et valides</option><option value="0">⚠️ Non vérifiés / expirés</option></select></div>
      </div>
      <div class="fs">
        <div class="fs-title" style="color:var(--or)">Ventes à l'accueil</div>
        <div class="fr"><label>Carnet de santé <span class="tb tb-na">1 000 F</span></label>
          <select id="p-carnet" onchange="updateAccueilTotal()"><option value="0">Non</option><option value="1">Oui (+1 000 F)</option></select></div>
        <div class="fr"><label>Thermomètre <span class="tb tb-na">1 000 F</span></label>
          <select id="p-thermo" onchange="updateAccueilTotal()"><option value="0">Non</option><option value="1">Oui (+1 000 F)</option></select></div>
      </div>
      <div class="tl"><span>Frais d'accueil</span><strong id="acc-total-lbl">0 FCFA</strong></div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="savePatient()">Enregistrer + Générer reçu</button>
        <button class="btn btn-danger btn-sm" onclick="clearAccueil()">Effacer</button>
      </div>
    </div>
    <div id="acc-recu-zone"></div>
  </div>`;
  onStatutChange();
};

function onStatutChange(){
  const s=document.getElementById('p-statut')?.value;
  if(!s)return;
  const isFPM=s.startsWith('FPM');
  document.getElementById('fpm-section').style.display=isFPM?'block':'none';
  document.getElementById('cmu-section').style.display=s==='CMU'?'block':'none';
  const lw=document.getElementById('p-lien-wrap');
  if(lw) lw.style.display=s==='FPM_AD'?'flex':'none';
  updateAccueilTotal();
}
function updateAccueilTotal(){
  const c=+document.getElementById('p-carnet')?.value||0;
  const t=+document.getElementById('p-thermo')?.value||0;
  const el=document.getElementById('acc-total-lbl');
  if(el) el.textContent=fmt((c+t)*1000)+' FCFA';
}

function savePatient(){
  const nom=document.getElementById('p-nom').value.trim();
  if(!nom){alert('Le nom est obligatoire');return;}
  const statut=document.getElementById('p-statut').value;
  const carnet=+document.getElementById('p-carnet').value;
  const thermo=+document.getElementById('p-thermo').value;
  const ventes=(carnet+thermo)*1000;
  const statutSimple=statut.startsWith('FPM')?'FPM':statut;
  const droitsVerifies=document.getElementById('p-droits').value;
  const statutFacturation=droitsVerifies==='1'?statutSimple:'NA';
  const dossierNo=generatePatientDossier();
  const p=DB.push('patients',{
    nom,ddn:document.getElementById('p-ddn').value,
    genre:document.getElementById('p-genre').value,
    tel:document.getElementById('p-tel').value,
    adresse:document.getElementById('p-adr').value,
    statut,statut_simple:statutSimple,
    fpm_num:document.getElementById('p-fpm')?.value||'',
    lien_titulaire:document.getElementById('p-lien')?.value||'',
    cmu_num:document.getElementById('p-cmu')?.value||'',
    droits_verifies:droitsVerifies,
    cmu_disponible:document.getElementById('p-cmu-dispo')?.value||'0',
    antecedents:'',
    dossier_no:dossierNo,
    carnet,thermo,ventes_accueil:ventes,
    batiment:CURRENT_AGENT.bldg||'SOUS-PREFECTURE',date:today()
  });
  logAudit('PATIENT_CREATE',{patient_id:p.id,dossier_no:p.dossier_no,nom:p.nom,statut:p.statut_simple||p.statut});
  if(ventes>0) DB.push('transactions',{
    patient_id:p.id,patient_nom:nom,statut:statutSimple,service:'ACCUEIL',
    designation:'Ventes accueil',montant:ventes,cnam:0,encaisse:ventes,date:today()
  });
  const now=new Date();
  // Date expiration ticket (validité 7 jours)
  const expDate=new Date(now); expDate.setDate(expDate.getDate()+7);
  const expStr=expDate.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
  // Tarif consultation selon statut
  const tarifConsult = statutFacturation==='FPM'?0 : statutFacturation==='CMU'?150 : 1000;
  const tarifConsultLabel = tarifConsult===0
    ? '<span style="color:var(--fpm);font-weight:800">GRATUIT (FPM)</span>'
    : `<span style="color:var(--marine);font-weight:800">${fmt(tarifConsult)} FCFA</span>`;
  const totalAccueil = ventes + tarifConsult;
  document.getElementById('acc-recu-zone').innerHTML=`
  <div>
    <div class="al al-ok"><strong>✅ Patient enregistré — Dossier N°${p.dossier_no}</strong> | Agent : ${CURRENT_AGENT.nom}</div>
    <div class="card" id="recu-print-${p.id}">
      <div class="card-title">Reçu d'accueil — À imprimer</div>
      <div class="recu">
        <div class="recu-title">REÇU D'ACCUEIL</div>
        <div style="text-align:center;font-size:11px;font-weight:700;color:var(--marine)">CSA — GARDE RÉPUBLICAINE DU PLATEAU</div>
        <div style="text-align:center;font-size:10px;color:#888;margin-bottom:4px">${now.toLocaleString('fr-FR')} | Bât. ${p.batiment}</div>
        <div style="text-align:center;font-size:10px;margin-bottom:6px">Dossier N° <strong>${p.dossier_no}</strong> | Agent : ${CURRENT_AGENT.nom}</div>
        <hr style="margin:6px 0">
        <div class="recu-line"><span>Patient</span><span><strong>${escHtml(nom)}</strong></span></div>
        <div class="recu-line"><span>Statut</span><span>${badge(statutSimple)}</span></div>
        <div class="recu-line"><span>Statut facturation</span><span>${badge(statutFacturation)}</span></div>
        <div class="recu-line"><span>Droits vérifiés</span><span>${p.droits_verifies==='1'?'✅ Valides':'⚠️ À vérifier'}</span></div>
        ${p.statut.startsWith('FPM')?`<div class="recu-line"><span>Carte CMU disponible</span><span>${p.cmu_disponible==='1'?'Oui':'Non'}</span></div>`:''}
        <hr style="margin:6px 0;border-style:dashed">
        <div style="font-size:10px;font-weight:700;color:var(--marine);margin-bottom:4px;text-transform:uppercase">Détail facturation</div>
        <div class="recu-line"><span>Consultation</span><span>${tarifConsultLabel}</span></div>
        ${carnet?`<div class="recu-line"><span>Carnet de santé</span><span>1 000 FCFA</span></div>`:''}
        ${thermo?`<div class="recu-line"><span>Thermomètre</span><span>1 000 FCFA</span></div>`:''}
        <hr style="margin:6px 0">
        <div class="recu-tot"><span>TOTAL À ENCAISSER</span><span style="font-size:16px">${totalAccueil===0?'<span style="color:var(--fpm)">0 FCFA</span>':fmt(totalAccueil)+' FCFA'}</span></div>
        <div style="margin-top:8px;background:#f0f4ff;border-radius:4px;padding:6px;text-align:center;border:1px dashed var(--bleu)">
          <div style="font-size:10px;color:var(--muted)">⏱ VALIDITÉ DU TICKET DE CONSULTATION</div>
          <div style="font-size:12px;font-weight:700;color:var(--bleu)">Valable jusqu'au <strong>${expStr}</strong></div>
          <div style="font-size:9px;color:var(--muted);margin-top:2px">7 jours maximum à compter de ce jour</div>
        </div>
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-print btn-sm" onclick="printSection('recu-print-${p.id}')">🖨 Imprimer ce reçu</button>
      </div>
    </div>
  </div>`;
  clearAccueil();
}
function clearAccueil(){
  ['p-nom','p-ddn','p-tel','p-adr','p-fpm','p-lien','p-cmu'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  const s=document.getElementById('p-statut');if(s)s.value='FPM_TIT';
  const c=document.getElementById('p-carnet');if(c)c.value='0';
  const t=document.getElementById('p-thermo');if(t)t.value='0';
  const cd=document.getElementById('p-cmu-dispo');if(cd)cd.value='1';
  const dr=document.getElementById('p-droits');if(dr)dr.value='1';
  onStatutChange();
  updateAccueilTotal();
}

// ── ACCUEIL — Prise de constantes ────────────────────────
VIEW['acc-constantes'] = (el) => {
  const patients=DB.get('patients');
  el.innerHTML=`
  <div class="g2">
    <div class="card">
      <div class="card-title">Prise des constantes vitales</div>
      <div class="sb"><input type="text" id="cs-search" placeholder="Rechercher patient du jour..." oninput="searchPatientCS()"></div>
      <div id="cs-results" style="max-height:150px;overflow-y:auto"></div>
      <input type="hidden" id="cs-pid"><input type="hidden" id="cs-pnom">
      <div id="cs-selected" style="display:none">
        <div class="al al-info"><strong id="cs-pnom-lbl"></strong></div>
        <div class="fs">
          <div class="fs-title">Anthropométrie</div>
          <div class="fr"><label>Poids (kg)</label><input type="text" inputmode="decimal" id="const-poids" placeholder="Ex: 72,5" oninput="calcIMC()"></div>
          <div class="fr"><label>Taille</label><input type="text" inputmode="decimal" id="const-taille" placeholder="Ex: 175 (cm) ou 1,75 (m)" oninput="calcIMC()"></div>
          <div class="fr"><label>IMC calculé</label><div id="imc-display" style="flex:1;font-size:13px">—</div></div>
        </div>
        <div class="fs">
          <div class="fs-title">Constantes vitales</div>
          <div class="fr"><label>Tension artérielle (mmHg)</label>
            <input type="text" id="const-ta" placeholder="Ex: 130/85 mmHg" style="flex:1"></div>
          <div class="fr"><label>Température (°C)</label>
            <input type="text" inputmode="decimal" id="const-temp" placeholder="Ex: 37,5" oninput="alertTemp()"></div>
          <div id="temp-alert"></div>
          <div class="fr"><label>Pouls (bpm)</label>
            <input type="text" inputmode="numeric" id="const-pouls" placeholder="Ex: 78"></div>
          <div class="fr"><label>SpO2 (%)</label>
            <input type="text" inputmode="numeric" id="const-spo2" placeholder="Ex: 98"></div>
          <div class="fr"><label>Motif de consultation</label>
            <textarea id="const-motif" placeholder="Ex: Fièvre depuis 3 jours, céphalées..."></textarea></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="saveConstantes()">Enregistrer constantes</button>
        </div>
      </div>
    </div>
    <div id="const-confirm"></div>
  </div>`;
};

function searchPatientCS(){
  const q=document.getElementById('cs-search').value.toLowerCase();
  const res=document.getElementById('cs-results');
  if(q.length<2){res.innerHTML='';return;}
  const found=DB.get('patients').filter(p=>p.nom.toLowerCase().includes(q)&&p.date===today()).slice(0,5);
  res.innerHTML=found.map(p=>`
    <div class="pat-card" onclick="selectPatientCS('${p.id}','${escSQ(p.nom)}','${p.statut_simple||p.statut}')">
      <div class="pat-av" style="background:#e3f2fd;color:var(--cmu)">${escHtml(p.nom[0]||'')}</div>
      <div style="flex:1"><div style="font-weight:700;font-size:12px">${escHtml(p.nom)}</div>
        <div style="font-size:10px;color:var(--muted)">${escHtml(p.genre||'')} — Bât. ${escHtml(p.batiment||'')}</div></div>
      ${badge(p.statut_simple||p.statut)}
    </div>`).join('')||'<p style="color:#aaa;text-align:center;padding:8px">Aucun patient trouvé aujourd\'hui</p>';
}

function selectPatientCS(id,nom,statut){
  document.getElementById('cs-pid').value=id;
  document.getElementById('cs-pnom').value=nom;
  document.getElementById('cs-pnom-lbl').textContent=nom+' ('+statut+')';
  document.getElementById('cs-selected').style.display='block';
  document.getElementById('cs-search').value='';
  document.getElementById('cs-results').innerHTML='';
}

function alertTemp(){
  const t=numFR(document.getElementById('const-temp')?.value);
  const el=document.getElementById('temp-alert');
  if(!el)return;
  if(t>=40) el.innerHTML='<div class="al al-err">⚠️ Hyperthermie sévère (≥40°C) — Signaler immédiatement au médecin</div>';
  else if(t>=38.5) el.innerHTML='<div class="al al-warn">⚠️ Fièvre importante (≥38.5°C)</div>';
  else if(t>0&&t<36) el.innerHTML='<div class="al al-warn">⚠️ Hypothermie (< 36°C)</div>';
  else el.innerHTML='';
}

function saveConstantes(){
  const pid=document.getElementById('cs-pid').value;
  const nom=document.getElementById('cs-pnom').value;
  if(!pid){alert('Sélectionnez un patient');return;}
  const poids=numFR(document.getElementById('const-poids').value);
  const taille=tailleCm(document.getElementById('const-taille').value);
  const temperature=numFR(document.getElementById('const-temp').value);
  const pouls=numFR(document.getElementById('const-pouls').value);
  const spo2=numFR(document.getElementById('const-spo2').value);
  const taValue=document.getElementById('const-ta').value.trim();
  if(poids&&(poids<1||poids>400)){alert('Poids invalide (1 à 400 kg).');return;}
  if(taille&&(taille<30||taille>250)){alert('Taille invalide (30 à 250 cm).');return;}
  if(temperature&&(temperature<30||temperature>45)){alert('Température invalide (30 à 45 °C).');return;}
  if(pouls&&(pouls<20||pouls>250)){alert('Pouls invalide (20 à 250 bpm).');return;}
  if(spo2&&(spo2<50||spo2>100)){alert('SpO2 invalide (50 à 100 %).');return;}
  if(taValue){
    const match=taValue.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if(!match||+match[1]<50||+match[1]>260||+match[2]<30||+match[2]>160){
      alert('Tension invalide. Format attendu: 120/80.');
      return;
    }
  }
  const imc=poids&&taille?poids/((taille/100)**2):0;
  const constantes=DB.push('constantes',{
    patient_id:pid,patient_nom:nom,
    poids,taille,imc:Math.round(imc*10)/10,
    ta:taValue,
    temperature:temperature||'',
    pouls:pouls||'',
    spo2:spo2||'',
    motif:document.getElementById('const-motif').value,
    date:today()
  });
  const flags=getAlertFlags(constantes);
  logAudit('CONSTANTES_CREATE',{patient_id:pid,temperature:constantes.temperature,ta:constantes.ta,spo2:constantes.spo2,imc:constantes.imc,alertes:flags.map(f=>f.msg)});
  document.getElementById('const-confirm').innerHTML=`
    <div class="card" id="const-print-${pid}">
      <div class="card-title">Fiche constantes — À imprimer</div>
      <div class="recu">
        <div class="recu-title">CONSTANTES VITALES</div>
        <div style="text-align:center;font-size:10px">${new Date().toLocaleString('fr-FR')} | Agent : ${CURRENT_AGENT.nom}</div>
        <div style="text-align:center;font-weight:700;margin:6px 0">${escHtml(nom)}</div>
        <hr style="margin:4px 0">
        ${poids?`<div class="recu-line"><span>Poids</span><span>${poids} kg</span></div>`:''}
        ${taille?`<div class="recu-line"><span>Taille</span><span>${taille} cm</span></div>`:''}
        ${imc?`<div class="recu-line"><span>IMC</span><span>${imc.toFixed(1)}</span></div>`:''}
        ${constantes.ta?`<div class="recu-line"><span>Tension</span><span>${escHtml(constantes.ta)}</span></div>`:''}
        ${constantes.temperature?`<div class="recu-line"><span>Température</span><span>${constantes.temperature}°C</span></div>`:''}
        ${constantes.pouls?`<div class="recu-line"><span>Pouls</span><span>${constantes.pouls} bpm</span></div>`:''}
        ${constantes.spo2?`<div class="recu-line"><span>SpO2</span><span>${constantes.spo2}%</span></div>`:''}
        ${constantes.motif?`<div style="margin-top:6px;font-size:10px"><strong>Motif :</strong> ${escHtml(constantes.motif)}</div>`:''}
        ${flags.length?`<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${flags.map(alertBadge).join('')}</div>`:''}
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-print btn-sm" onclick="printSection('const-print-${pid}')">Imprimer</button>
      </div>
    </div>`;
  document.getElementById('cs-selected').style.display='none';
  document.getElementById('cs-pid').value='';
}

// ── ACCUEIL — Consultation ───────────────────────────────
VIEW['acc-consultation'] = (el) => {
  el.innerHTML=`
  <div class="g2">
    <div class="card">
      ${renderCriticalBanner('Consultation')}
      <div class="card-title">Enregistrement de consultation</div>
      <div class="sb"><input type="text" id="cc-search" placeholder="Rechercher un patient existant..." oninput="searchCC()"></div>
      <div id="cc-results" style="max-height:130px;overflow-y:auto"></div>
      <div class="fr" style="margin-top:6px"><label><input type="checkbox" id="cc-new-toggle" onchange="toggleCcNew()"> Nouveau patient (non enregistré à l'accueil)</label></div>
      <div id="cc-new-wrap" style="display:none;border:1px dashed var(--vert);border-radius:8px;padding:10px;margin-bottom:8px;background:#f3fbf5">
        <div class="fr"><label>Nom du patient</label><input type="text" id="cc-new-nom" placeholder="Nom et prénoms"></div>
        <div class="fr"><label>Sexe</label><select id="cc-new-genre"><option>M</option><option>F</option></select></div>
        <div class="fr"><label>Statut</label><select id="cc-new-statut"><option value="NA">NA (non assuré)</option><option value="FPM">FPM</option><option value="CMU">CMU</option></select></div>
        <button class="btn btn-primary btn-sm" onclick="ccCreatePatient()">Créer et sélectionner</button>
      </div>
      <input type="hidden" id="cc-pid"><input type="hidden" id="cc-pnom"><input type="hidden" id="cc-pstatut"><input type="hidden" id="cc-pdroits">
      <div id="cc-selected" style="display:none">
        <div class="al al-info"><strong id="cc-pnom-lbl"></strong></div>
        <div id="cc-clinical"></div>
        <div class="fs">
          <div class="fr"><label>Vu par</label>
            <select id="cc-praticien">
              <option value="MEDECIN">Médecin-Chef</option>
              <option value="INFIRMIER">Infirmier de service</option>
            </select></div>
          <div class="fr"><label>Type</label>
            <select id="cc-type" onchange="updateConsultTarif()">
              <option value="NORMALE">Consultation normale</option>
              <option value="VISITE_FPM">Visite médicale FPM (5 000 F)</option>
              <option value="STAGE">Visite médicale de stage (5 000 F)</option>
              <option value="CONTROLE">Consultation de contrôle</option>
              <option value="URGENCE">Urgence</option>
            </select></div>
          <div class="fr"><label>Motif / Diagnostic provisoire</label>
            <textarea id="cc-motif" placeholder="Symptômes, motif de la visite..."></textarea></div>
          <div class="fr"><label>Prescription / Ordonnance</label>
            <textarea id="cc-ordo" placeholder="Médicaments, examens prescrits..."></textarea></div>
          <div class="fr"><label>Antécédents (mise à jour dossier)</label>
            <textarea id="cc-antecedents" placeholder="HTA, diabète, asthme, chirurgie antérieure, allergies..."></textarea></div>
          <div class="fr"><label>Orientation(s)</label>
            <div style="flex:1;display:flex;flex-wrap:wrap;gap:6px">
              <label><input type="checkbox" value="LABO"> Laboratoire</label>
              <label><input type="checkbox" value="PHARMACIE"> Pharmacie</label>
              <label><input type="checkbox" value="SOINS"> Soins infirmiers</label>
              <label><input type="checkbox" value="OBS"> Mise en obs.</label>
              <label><input type="checkbox" value="RDV"> Rendez-vous</label>
            </div></div>
        </div>
        <div class="tl"><span>Tarif consultation</span><strong id="cc-tarif-lbl">—</strong></div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="saveConsultation()">Valider + Imprimer facture</button>
        </div>
      </div>
    </div>
    <div id="cc-facture-zone"></div>
  </div>`;
};

function searchCC(){
  const q=document.getElementById('cc-search').value.toLowerCase();
  const res=document.getElementById('cc-results');
  if(q.length<2){res.innerHTML='';return;}
  const found=DB.get('patients').filter(p=>p.nom.toLowerCase().includes(q)).slice(0,5);
  res.innerHTML=found.map(p=>`
    <div class="pat-card" onclick="selectCC('${p.id}','${escSQ(p.nom)}','${p.statut_simple||p.statut}')">
      <div class="pat-av" style="background:#e8f5e9">${escHtml(p.nom[0]||'')}</div>
      <div style="flex:1"><div style="font-weight:700;font-size:12px">${escHtml(p.nom)}</div>
        <div style="font-size:10px;color:var(--muted)">${fmtD(p.created_at)} ${p.droits_verifies==='1'?'':'• droits non vérifiés'}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${(getAlertFlags(getLatestConstantes(p.id))).map(alertBadge).join('')}</div></div>
      ${badge(p.statut_simple||p.statut)}
    </div>`).join('')||'<p style="color:#aaa;text-align:center;padding:8px">Aucun patient trouvé</p>';
}
function selectCC(id,nom,statut){
  const patient=getPatientById(id);
  document.getElementById('cc-pid').value=id;
  document.getElementById('cc-pnom').value=nom;
  document.getElementById('cc-pstatut').value=statut;
  document.getElementById('cc-pdroits').value=patient?.droits_verifies||'1';
  document.getElementById('cc-pnom-lbl').textContent=nom+' ('+statut+')';
  document.getElementById('cc-clinical').innerHTML=renderClinicalSummary(id);
  document.getElementById('cc-antecedents').value=patient?.antecedents||'';
  document.getElementById('cc-selected').style.display='block';
  document.getElementById('cc-search').value='';
  document.getElementById('cc-results').innerHTML='';
  updateConsultTarif();
}
function toggleCcNew(){
  const on=document.getElementById('cc-new-toggle')?.checked;
  const w=document.getElementById('cc-new-wrap'); if(w) w.style.display=on?'block':'none';
}
// Création d'un patient directement depuis la Consultation (comme l'accueil),
// puis sélection automatique pour enchaîner la consultation. Synchronisé partout.
function ccCreatePatient(){
  const nom=document.getElementById('cc-new-nom').value.trim();
  if(!nom){alert('Le nom du patient est obligatoire');return;}
  const statut=document.getElementById('cc-new-statut').value;
  const statutSimple=statut.startsWith('FPM')?'FPM':statut;
  const p=DB.push('patients',{
    nom, ddn:'', genre:document.getElementById('cc-new-genre').value,
    tel:'', adresse:'', statut, statut_simple:statutSimple,
    droits_verifies:'1', cmu_disponible:'0', antecedents:'',
    dossier_no:generatePatientDossier(),
    batiment:CURRENT_AGENT.bldg||'SOUS-PREFECTURE', date:today(), cree_par:'consultation'
  });
  logAudit('PATIENT_CREATE',{patient_id:p.id,dossier_no:p.dossier_no,nom:p.nom,statut:statutSimple,via:'consultation'});
  document.getElementById('cc-new-nom').value='';
  const tog=document.getElementById('cc-new-toggle'); if(tog) tog.checked=false; toggleCcNew();
  selectCC(p.id, p.nom, p.statut_simple||p.statut);
}
function updateConsultTarif(){
  const type=document.getElementById('cc-type')?.value;
  const statut=document.getElementById('cc-pstatut')?.value||'FPM';
  const droits=document.getElementById('cc-pdroits')?.value||'1';
  const statutFacturation=droits==='1'?statut:'NA';
  const el=document.getElementById('cc-tarif-lbl');
  if(!el||!type)return;
  let tarif=0;
  if(type==='STAGE') tarif=TARIFS.stage;
  else if(type==='VISITE_FPM') tarif=TARIFS.stage;
  else if(type==='NORMALE'||type==='URGENCE'||type==='CONTROLE'){
    if(statutFacturation==='FPM') tarif=0;
    else if(statutFacturation==='CMU') tarif=150;
    else tarif=1000;
  }
  el.textContent=tarif===0?'GRATUIT (FPM)':fmt(tarif)+' FCFA';
  if(droits!=='1'&&type!=='STAGE'&&type!=='VISITE_FPM') el.textContent+=' (droits non vérifiés)';
  el.style.color=tarif===0?'var(--fpm)':'var(--marine)';
  return tarif;
}
function saveConsultation(){
  const pid=document.getElementById('cc-pid').value;
  const nom=document.getElementById('cc-pnom').value;
  const statut=document.getElementById('cc-pstatut').value;
  const droits=document.getElementById('cc-pdroits').value||'1';
  const statutFacturation=droits==='1'?statut:'NA';
  if(!pid){alert('Sélectionnez un patient');return;}
  const type=document.getElementById('cc-type').value;
  const praticien=document.getElementById('cc-praticien').value;
  if(type==='VISITE_FPM'&&statut!=='FPM'){
    alert('La visite médicale FPM est réservée au statut FPM.');
    return;
  }
  let tarif=0;
  if(type==='STAGE') tarif=TARIFS.stage;
  else if(type==='VISITE_FPM') tarif=TARIFS.stage;
  else if(statutFacturation==='CMU') tarif=150;
  else if(statutFacturation==='NA') tarif=1000;
  // FPM : consultation gratuite
  const motif=document.getElementById('cc-motif').value;
  const ordo=document.getElementById('cc-ordo').value;
  const antecedents=document.getElementById('cc-antecedents').value.trim();
  const orients=[...document.querySelectorAll('#cc-selected input[type=checkbox]:checked')].map(c=>c.value);
  const c=DB.push('consultations',{
    patient_id:pid,patient_nom:nom,statut,statut_facturation:statutFacturation,droits_verifies:droits,type,praticien,motif,ordonnance:ordo,orientations:orients,tarif,date:today()
  });
  if(antecedents){
    const pts=DB.get('patients');const i=pts.findIndex(p=>p.id===pid);
    if(i>=0){pts[i].antecedents=antecedents;persistUpdatedRecord('patients',pts,pts[i]);}
  }
  logAudit('CONSULTATION_CREATE',{patient_id:pid,nom,statut,statut_facturation:statutFacturation,type,orientations:orients,tarif});
  if(tarif>0) DB.push('transactions',{
    patient_id:pid,patient_nom:nom,statut:statutFacturation,service:'ACCUEIL',
    designation:type==='STAGE'?'Visite médicale de stage':type==='VISITE_FPM'?'Visite médicale FPM':'Consultation '+statutFacturation,
    montant:tarif,cnam:0,encaisse:tarif,date:today()
  });
  const now=new Date();
  // Calcul date d'expiration (validité 7 jours)
  const expDate=new Date(now);expDate.setDate(expDate.getDate()+7);
  const expStr=expDate.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
  // Libellé tarifaire selon statut
  let tarifLabel='', tarifDetail='';
  if(type==='STAGE'){
    tarifLabel=fmt(tarif)+' FCFA'; tarifDetail='Visite médicale de stage — Tous statuts';
  } else if(type==='VISITE_FPM'){
    tarifLabel=fmt(tarif)+' FCFA'; tarifDetail='Visite médicale FPM — Titulaires et ayants-droit FPM';
  } else if(statutFacturation==='FPM'){
    tarifLabel='GRATUIT'; tarifDetail='Militaire / Ayant-droit FPM — Consultation prise en charge';
  } else if(statutFacturation==='CMU'){
    tarifLabel=fmt(tarif)+' FCFA'; tarifDetail='Assuré CMU — Ticket modérateur consultation';
  } else {
    tarifLabel=fmt(tarif)+' FCFA'; tarifDetail='Patient non-assuré — Tarif plein';
  }
  const patient=getPatientById(pid);
  const dossierAffiche=patient?.dossier_no||'NON ATTRIBUE';
  document.getElementById('cc-facture-zone').innerHTML=`
    <div class="card" id="fact-consult-${pid}">
      <div class="card-title">Ticket de consultation — Imprimable</div>
      <div class="recu">
        <div class="recu-title">TICKET DE CONSULTATION</div>
        <div style="text-align:center;font-size:11px;font-weight:700;color:var(--marine)">CSA — GARDE RÉPUBLICAINE DU PLATEAU</div>
        <div style="text-align:center;font-size:10px;color:#888;margin-bottom:6px">${now.toLocaleString('fr-FR')} | ${CURRENT_AGENT.nom}</div>
        <hr style="margin:4px 0">
        <div class="recu-line"><span>N° Dossier</span><span style="font-weight:700">${dossierAffiche}</span></div>
        <div class="recu-line"><span>Patient</span><span><strong>${escHtml(nom)}</strong></span></div>
        <div class="recu-line"><span>Statut</span><span style="font-weight:700;color:${statut==='FPM'?'var(--fpm)':statut==='CMU'?'var(--cmu)':'var(--na)'}">${statut}</span></div>
        <div class="recu-line"><span>Facturation</span><span style="font-weight:700">${statutFacturation}</span></div>
        <div class="recu-line"><span>Type</span><span>${escHtml(type)}</span></div>
        <div class="recu-line"><span>Praticien</span><span>${escHtml(praticien)}</span></div>
        ${motif?`<div class="recu-line"><span>Motif</span><span style="font-size:10px">${escHtml(motif)}</span></div>`:''}
        ${orients.length?`<div class="recu-line"><span>Orienté vers</span><span style="font-weight:700;color:var(--bleu)">${orients.join(', ')}</span></div>`:''}
        <hr style="margin:6px 0">
        <div class="recu-tot" style="background:${statut==='FPM'?'#e8f5e9':'#fff8e1'};padding:6px;border-radius:4px">
          <span style="font-size:11px">${tarifDetail}</span>
          <span style="font-size:16px;font-weight:800;color:${statut==='FPM'?'var(--fpm)':'var(--marine)'}">${tarifLabel}</span>
        </div>
        <div style="margin-top:8px;background:#f0f4ff;border-radius:4px;padding:6px;text-align:center;border:1px dashed var(--bleu)">
          <div style="font-size:10px;color:var(--muted)">VALIDITÉ DU TICKET</div>
          <div style="font-size:12px;font-weight:700;color:var(--bleu)">Ce ticket est valable jusqu'au <strong>${expStr}</strong></div>
          <div style="font-size:9px;color:var(--muted);margin-top:2px">Durée maximale : 7 jours à compter de la date de consultation</div>
        </div>
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-print btn-sm" onclick="printSection('fact-consult-${pid}')">🖨 Imprimer ticket</button>
      </div>
      ${ordo?`<div class="card" style="margin-top:8px" id="ordo-${c.id}"><div class="card-title">Ordonnance</div><div class="recu"><div class="recu-title">ORDONNANCE</div><div style="font-size:11px">${escHtml(ordo).replace(/\n/g,'<br>')}</div><hr style="margin:6px 0"><div style="font-size:10px">Prescrite par : <strong>${escHtml(praticien)}</strong> — ${escHtml(CURRENT_AGENT.nom)}</div></div><div class="btn-row no-print"><button class="btn btn-print btn-sm" onclick="printSection('ordo-${c.id}')">🖨 Imprimer ordonnance</button></div></div>`:''}
      ${orients.length?`<div class="al al-info" style="margin-top:8px"><strong>Orientations :</strong> ${orients.join(' → ')}</div>`:''}
    </div>`;
  document.getElementById('cc-selected').style.display='none';
}

// ── ACCUEIL — File du jour ───────────────────────────────
VIEW['acc-liste'] = (el) => {
  const consults=DB.todayItems('consultations');
  const patients=DB.todayItems('patients');
  const totalEnc=consults.reduce((s,c)=>s+c.tarif,0);
  el.innerHTML=`
  <div class="g3 no-print" style="margin-bottom:12px">
    <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-ico">👥</div><div class="kpi-lbl">Patients</div><div class="kpi-val">${patients.length}</div></div>
    <div class="kpi" style="border-left-color:var(--vert)"><div class="kpi-ico">🩺</div><div class="kpi-lbl">Consultations</div><div class="kpi-val">${consults.length}</div></div>
    <div class="kpi" style="border-left-color:var(--or)"><div class="kpi-ico">💵</div><div class="kpi-lbl">Encaissé</div><div class="kpi-val">${fmt(totalEnc)} F</div></div>
  </div>
  <div class="card" id="file-print">
    <div class="card-title">File du jour — ${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</div>
    <div class="tw"><table>
      <tr><th>Heure</th><th>Patient</th><th>Statut</th><th>Type</th><th>Praticien</th><th>Orientation</th><th>Tarif</th><th>Agent</th></tr>
      ${consults.map(c=>`<tr>
        <td>${fmtT(c.created_at)}</td>
        <td style="font-weight:700;font-size:12px">${escHtml(c.patient_nom)}</td>
        <td>${badge(c.statut)}</td>
        <td style="font-size:11px">${escHtml(c.type)}</td>
        <td style="font-size:11px">${escHtml(c.praticien||'—')}</td>
        <td style="font-size:11px;color:var(--bleu);font-weight:700">${escHtml((c.orientations||[]).join(', ')||'—')}</td>
        <td style="font-weight:700;color:var(--vert)">${c.tarif===0?'Gratuit':fmt(c.tarif)+' F'}</td>
        <td style="font-size:10px;color:var(--muted)">${escHtml(c.agent_nom||'')}</td>
      </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:#aaa;padding:16px">Aucune consultation</td></tr>'}
      ${consults.length?`<tr class="tr-tot"><td colspan="6">TOTAL</td><td>${fmt(totalEnc)} FCFA</td><td></td></tr>`:''}
    </table></div>
  </div>
  <div class="btn-row no-print"><button class="btn btn-print btn-sm" onclick="printSection('file-print')">Imprimer la liste</button></div>`;
};

// ── SOINS — Réaliser des soins ───────────────────────────
VIEW['soins-actes'] = (el) => {
  const incoming=DB.todayItems('patients').slice(0,8);
  el.innerHTML=`
  <div class="g2">
    <div class="card">
      ${renderCriticalBanner('Soins')}
      <div class="card-title">Saisie des soins infirmiers</div>
      ${incoming.length?`<div class="al al-warn"><strong>Arrivées du jour :</strong> ${incoming.map(p=>{const n=getAlertFlags(getLatestConstantes(p.id)).length;return `${escHtml(p.nom)}${n?` <span class="badge b-err">${n} alerte(s)</span>`:''}`;}).join(' | ')}</div>`:''}
      <div class="al al-info" style="margin-bottom:8px">
        Entrée externe possible : cochez "Entrée directe" si le patient n'a pas d'orientation consultation.
      </div>
      <div class="fr">
        <label><input type="checkbox" id="si-direct" onchange="toggleSiDirect()"> Entrée directe (sans orientation)</label>
      </div>
      <div class="fr" id="si-direct-motif-wrap" style="display:none">
        <label>Motif d'entrée directe (obligatoire)</label><input type="text" id="si-direct-motif" placeholder="Ex: soin pansement externe, urgence mineure...">
      </div>
      <div id="si-direct-new-wrap" style="display:none;border:1px dashed var(--bleu);border-radius:8px;padding:10px;margin-bottom:8px;background:#f4f8ff">
        <div style="font-size:11px;font-weight:700;color:var(--bleu);margin-bottom:6px">Patient non enregistré à l'accueil ? Créez-le ici :</div>
        <div class="fr"><label>Nom du patient</label><input type="text" id="si-new-nom" placeholder="Nom et prénoms"></div>
        <div class="fr"><label>Sexe</label><select id="si-new-genre"><option>M</option><option>F</option></select></div>
        <div class="fr"><label>Statut</label><select id="si-new-statut"><option value="NA">NA (non assuré)</option><option value="FPM">FPM</option><option value="CMU">CMU</option></select></div>
        <button class="btn btn-primary btn-sm" onclick="siCreateDirectPatient()">Créer et sélectionner</button>
      </div>
      <div class="sb"><input type="text" id="si-search" placeholder="Rechercher un patient existant..." oninput="searchSI()"></div>
      <div id="si-results" style="max-height:100px;overflow-y:auto"></div>
      <input type="hidden" id="si-pid"><input type="hidden" id="si-pnom"><input type="hidden" id="si-pstatut">
      <div id="si-form" style="display:none">
        <div class="al al-info"><strong id="si-pnom-lbl"></strong></div>
        <div id="si-clinical"></div>
        <div class="fs">
          <div class="fs-title" style="color:var(--vert)">Actes réalisés</div>
          <div style="max-height:260px;overflow-y:auto">
          ${SOINS_ACTES.map(a=>`
            <div class="fr" style="padding:3px 0;border-bottom:1px solid #f5f5f5">
              <label style="font-size:11px"><strong style="color:var(--cyan)">${a.code}</strong> — ${a.nom}</label>
              <span style="font-size:9px;color:#aaa">${a.cot>0?'AMI×'+a.cot+' = '+fmt(a.cot*TARIFS.AMI)+'F':'Forfait'}</span>
              <input type="number" class="si-qty" data-code="${a.code}" data-nom="${escHtml(a.nom)}" data-cot="${a.cot}" min="0" value="0" onchange="updateSoinsTotal()" style="width:55px">
            </div>`).join('')}
          </div>
        </div>
        <div class="fs">
          <div class="fr"><label>Observations soins</label><textarea id="si-obs" placeholder="Notes infirmier..."></textarea></div>
        </div>
        <div class="tl"><span>Total actes AMI</span><strong id="si-tot-lbl">0 FCFA</strong></div>
        <div class="tl sub"><span>Part CNAM (70%)</span><span id="si-cnam-lbl" style="font-weight:700;color:var(--cmu)">0 FCFA</span></div>
        <div class="tl sub"><span>Ticket modérateur</span><span id="si-tm-lbl" style="font-weight:700;color:var(--or)">0 FCFA</span></div>
        <div class="btn-row">
          <button class="btn btn-success" onclick="saveSoins()">Enregistrer + Facture</button>
        </div>
      </div>
    </div>
    <div id="si-facture-zone"></div>
  </div>`;
};

function searchSI(){
  const q=document.getElementById('si-search').value.toLowerCase();
  const res=document.getElementById('si-results');
  if(q.length<2){res.innerHTML='';return;}
  const direct=document.getElementById('si-direct')?.checked;
  if(direct){
    const found=DB.get('patients').filter(p=>p.nom.toLowerCase().includes(q)).slice(0,8);
    res.innerHTML=found.map(p=>`
    <div class="pat-card" onclick="selectSI('${p.id}','${escSQ(p.nom)}','${p.statut_simple||p.statut}')">
      <div class="pat-av" style="background:#ffe9d6">${escHtml(p.nom[0]||'')}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:12px">${escHtml(p.nom)}</div>
        <div style="font-size:10px;color:var(--muted)">${escHtml(p.statut_simple||p.statut)} • entrée directe</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${(getAlertFlags(getLatestConstantes(p.id))).map(alertBadge).join('')}</div>
      </div>
      <span class="badge b-warn">DIRECT</span>
    </div>`).join('')||'<p style="color:#aaa;text-align:center;padding:8px">Aucun patient trouvé</p>';
    return;
  }
  const oriented=getOrientedPatients('SOINS');
  const found=oriented.filter(c=>c.patient_nom.toLowerCase().includes(q)).slice(0,8);
  res.innerHTML=found.map(p=>`
    <div class="pat-card" onclick="selectSI('${p.patient_id}','${escSQ(p.patient_nom)}','${p.statut}')">
      <div class="pat-av" style="background:#e3f2fd">${escHtml(p.patient_nom[0]||'')}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:12px">${escHtml(p.patient_nom)}</div>
        <div style="font-size:10px;color:var(--muted)">${escHtml(p.statut)} • orienté depuis consultation ${fmtT(p.created_at)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${(getAlertFlags(getLatestConstantes(p.patient_id))).map(alertBadge).join('')}</div>
      </div>
      <span class="badge b-ok">SOINS</span>
    </div>`).join('')||'<div style="color:#667084;text-align:center;padding:10px;font-size:12px">Aucun patient <strong>orienté SOINS</strong> pour cette recherche.<br>Si le patient vient d\'être enregistré à l\'accueil, cochez <strong>« entrée directe »</strong> ci-dessus pour le retrouver par son nom (l\'orientation depuis une consultation n\'est alors pas requise).</div>';
}
function toggleSiDirect(){
  const isDirect=document.getElementById('si-direct')?.checked;
  const wrap=document.getElementById('si-direct-motif-wrap');
  if(wrap) wrap.style.display=isDirect?'flex':'none';
  const nw=document.getElementById('si-direct-new-wrap');
  if(nw) nw.style.display=isDirect?'block':'none';
  document.getElementById('si-results').innerHTML='';
  document.getElementById('si-search').value='';
}
// Création d'un patient directement depuis l'interface infirmier (entrée directe),
// exactement comme à l'accueil. Le patient est enregistré et synchronisé partout.
function siCreateDirectPatient(){
  const nom=document.getElementById('si-new-nom').value.trim();
  if(!nom){alert('Le nom du patient est obligatoire');return;}
  const statut=document.getElementById('si-new-statut').value;
  const statutSimple=statut.startsWith('FPM')?'FPM':statut;
  const p=DB.push('patients',{
    nom, ddn:'', genre:document.getElementById('si-new-genre').value,
    tel:'', adresse:'',
    statut, statut_simple:statutSimple,
    droits_verifies:'1', cmu_disponible:'0', antecedents:'',
    dossier_no:generatePatientDossier(),
    batiment:CURRENT_AGENT.bldg||'SOUS-PREFECTURE', date:today(),
    cree_par:'soins'
  });
  logAudit('PATIENT_CREATE',{patient_id:p.id,dossier_no:p.dossier_no,nom:p.nom,statut:statutSimple,via:'soins-entree-directe'});
  document.getElementById('si-new-nom').value='';
  selectSI(p.id, p.nom, p.statut_simple||p.statut);
}
function selectSI(id,nom,statut){
  document.getElementById('si-pid').value=id;
  document.getElementById('si-pnom').value=nom;
  document.getElementById('si-pstatut').value=statut;
  document.getElementById('si-pnom-lbl').textContent=nom+' ('+statut+')';
  document.getElementById('si-clinical').innerHTML=renderClinicalSummary(id);
  document.getElementById('si-form').style.display='block';
  document.getElementById('si-search').value='';
  document.getElementById('si-results').innerHTML='';
  updateSoinsTotal();
}
function updateSoinsTotal(){
  const pid=document.getElementById('si-pid')?.value||'';
  const patient=getPatientById(pid);
  const statutBase=document.getElementById('si-pstatut')?.value||'FPM';
  const statut=patient?getBillingStatut(patient):statutBase;
  let tot=0;
  document.querySelectorAll('.si-qty').forEach(inp=>{
    const q=+inp.value||0,cot=+inp.dataset.cot||0;
    tot+=q*cot*TARIFS.AMI;
  });
  // FPM paye au forfait CMU pour les soins : CNAM 70%, TM 30% (seule la consultation est gratuite FPM)
  const isFPMouCMU = statut==='FPM'||statut==='CMU';
  const cnam=isFPMouCMU?Math.round(tot*0.7):0;
  const tm=isFPMouCMU?Math.round(tot*0.3):tot;
  document.getElementById('si-tot-lbl').textContent=fmt(tot)+' FCFA';
  document.getElementById('si-cnam-lbl').textContent=fmt(cnam)+' FCFA';
  document.getElementById('si-tm-lbl').textContent=fmt(tm)+' FCFA'+(statut==='FPM'?' (forfait CMU)':'');
}
function saveSoins(){
  const pid=document.getElementById('si-pid').value;
  const nom=document.getElementById('si-pnom').value;
  const patient=getPatientById(pid);
  const statut=document.getElementById('si-pstatut').value;
  const statutFacturation=getBillingStatut(patient||{statut_simple:statut,droits_verifies:'1'});
  if(!pid){alert('Sélectionnez un patient');return;}
  let actes=[],tot=0;
  document.querySelectorAll('.si-qty').forEach(inp=>{
    const q=+inp.value||0;
    if(q>0){const cot=+inp.dataset.cot,m=q*cot*TARIFS.AMI;actes.push({code:inp.dataset.code,nom:inp.dataset.nom,cot,qte:q,montant:m});tot+=m;}
  });
  if(!actes.length){alert('Sélectionnez au moins un acte');return;}
  const direct=document.getElementById('si-direct')?.checked;
  const directMotif=(document.getElementById('si-direct-motif')?.value||'').trim();
  if(direct&&!directMotif){alert('Motif obligatoire pour une entrée directe');return;}
  // FPM paye au forfait CMU pour les soins (TM 30%) — seule la consultation est gratuite FPM
  const isFPMouCMU = statutFacturation==='FPM'||statutFacturation==='CMU';
  const cnam=isFPMouCMU?Math.round(tot*0.7):0;
  const tm=isFPMouCMU?Math.round(tot*0.3):tot;
  const obs=document.getElementById('si-obs').value;
  const s=DB.push('soins',{patient_id:pid,patient_nom:nom,statut,statut_facturation:statutFacturation,actes,total:tot,cnam,tm,observations:obs,date:today(),entree_directe:!!direct,motif_entree_directe:direct?directMotif:''});
  DB.push('transactions',{patient_id:pid,patient_nom:nom,statut:statutFacturation,service:'SOINS',
    designation:'Soins: '+actes.map(a=>a.nom).join(', '),montant:tot,cnam,encaisse:tm,date:today()});
  logAudit('SOINS_CREATE',{patient_id:pid,patient_nom:nom,statut,statut_facturation:statutFacturation,total:tot,entree_directe:!!direct,motif_entree_directe:direct?directMotif:''});
  const now=new Date();
  document.getElementById('si-facture-zone').innerHTML=`
    <div class="card" id="fact-soins-${pid}">
      <div class="card-title">Facture soins infirmiers — Imprimable</div>
      <div class="recu">
        <div class="recu-title">SOINS INFIRMIERS — CSA PLATEAU</div>
        <div style="text-align:center;font-size:10px">${now.toLocaleString('fr-FR')} | ${CURRENT_AGENT.nom}</div>
        <hr style="margin:4px 0">
        <div class="recu-line"><span>Patient</span><span><strong>${escHtml(nom)}</strong></span></div>
        <div class="recu-line"><span>Statut</span><span>${statut}</span></div>
        <div class="recu-line"><span>Facturation</span><span>${statutFacturation}</span></div>
        ${actes.map(a=>`<div class="recu-line"><span>${escHtml(a.nom)} ×${a.qte}</span><span>${fmt(a.montant)} F</span></div>`).join('')}
        <div class="recu-tot"><span>TOTAL</span><span>${fmt(tot)} FCFA</span></div>
        ${statutFacturation==='NA'?`<div style="font-size:10px;margin-top:4px">Tarif plein (droits non vérifiés ou non-assuré)</div>`:`<div style="font-size:10px;color:#666;margin-top:4px">CNAM 70%: ${fmt(cnam)} F | TM patient${statutFacturation==='FPM'?' (forfait CMU)':''}: ${fmt(tm)} F</div>`}
        ${obs?`<div style="font-size:10px;margin-top:6px"><strong>Obs. :</strong> ${obs}</div>`:''}
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-print btn-sm" onclick="printSection('fact-soins-${pid}')">Imprimer</button>
      </div>
    </div>`;
  document.querySelectorAll('.si-qty').forEach(i=>i.value=0);
  document.getElementById('si-form').style.display='none';
  const siDirect=document.getElementById('si-direct'); if(siDirect) siDirect.checked=false;
  const siDirectMotif=document.getElementById('si-direct-motif'); if(siDirectMotif) siDirectMotif.value='';
  toggleSiDirect();
}

// ── SOINS — Mise en observation ─────────────────────────
VIEW['soins-obs'] = (el) => {
  const obs_liste=DB.get('observations');
  const actifs=obs_liste.filter(o=>o.statut_obs!=='SORTI');
  el.innerHTML=`
  <div class="g2">
    <div class="card">
      <div class="card-title">Admettre en observation</div>
      <div class="sb"><input type="text" id="obs-search" placeholder="Rechercher patient..." oninput="searchObsPatient()"></div>
      <div id="obs-results" style="max-height:120px;overflow-y:auto"></div>
      <input type="hidden" id="obs-pid">
      <div class="fr"><label>Patient</label><input type="text" id="obs-nom" placeholder="Nom du patient"></div>
      <div class="fr"><label>Statut</label>
        <select id="obs-statut" onchange="updateObsTarif()">
          <option value="FPM">FPM — 150 F/j (forfait CMU)</option>
          <option value="CMU">CMU — 150 F/j</option>
          <option value="NA">Non-assuré — 500 F/j</option>
        </select></div>
      <div class="fr"><label>Motif d'observation</label><textarea id="obs-motif" placeholder="Diagnostic, motif..."></textarea></div>
      <div class="fr"><label>Date d'admission</label><input type="date" id="obs-date-in" value="${today()}"></div>
      <div class="tl"><span>Tarif / jour</span><strong id="obs-tarif-lbl">Gratuit (FPM)</strong></div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="admettreObs()">Admettre en observation</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Patients en observation (${actifs.length})</div>
      ${actifs.map(o=>`<div style="background:#f8f9fb;border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-weight:700;font-size:12px">${escHtml(o.patient_nom)}</span>
          ${badge(o.statut_facturation||o.statut)}
        </div>
        <div style="font-size:11px;color:var(--muted)">Admis le ${fmtD(o.date_admission)} | Tarif : ${o.tarif_j===0?'Gratuit':fmt(o.tarif_j)+' F/j'} | Facturation: ${o.statut_facturation||o.statut}</div>
        <div style="font-size:11px">${escHtml(o.motif)}</div>
        <div style="margin-top:6px;padding:6px;border:1px dashed var(--border);border-radius:6px">
          <div style="font-size:10px;font-weight:700;color:var(--marine)">Protocole de soins (Médecin-Chef)</div>
          ${CURRENT_AGENT?.isChef?`<textarea id="obs-proto-${o.id}" style="width:100%;min-height:60px" placeholder="Un item par ligne (ex: T°/TA/SpO2 toutes les 4h)">${escHtml((o.protocole_items||[]).join('\n'))}</textarea><div class="btn-row"><button class="btn btn-sm btn-primary" onclick="saveObsProtocole('${o.id}')">Enregistrer protocole</button></div>`:''}
          ${(o.protocole_items||[]).length?`<div style="display:flex;flex-direction:column;gap:4px;margin-top:6px">${(o.protocole_items||[]).map((it,ix)=>`<label style="font-size:11px"><input type="checkbox" id="obs-chk-${o.id}-${ix}" ${(o.protocole_done||{})[ix]?'checked':''}> ${escHtml(it)}</label>`).join('')}</div><div class="btn-row"><button class="btn btn-sm btn-success" onclick="saveObsChecklist('${o.id}')">Valider items faits</button></div>`:'<div style="font-size:10px;color:var(--muted);margin-top:4px">Aucun protocole défini.</div>'}
        </div>
        <div style="margin-top:6px;padding:6px;border:1px solid #e0e0e0;border-radius:6px">
          <div style="font-size:10px;font-weight:700;color:var(--bleu)">Surveillance clinique (traçabilité interne)</div>
          <div class="fr"><label>Constantes surveillées</label><input type="text" id="obs-const-${o.id}" placeholder="Ex: TA 145/95, T° 38.2, SpO2 92%"></div>
          <div class="fr"><label>Médicaments administrés</label><input type="text" id="obs-med-${o.id}" placeholder="Ex: Paracétamol 1g IV 14h"></div>
          <div class="fr"><label>Note</label><input type="text" id="obs-note-${o.id}" placeholder="Observations complémentaires"></div>
          <div class="btn-row"><button class="btn btn-sm btn-primary" onclick="addObsSurveillance('${o.id}')">Ajouter surveillance</button></div>
          ${(o.surveillance_logs||[]).length?`<div style="font-size:10px;max-height:120px;overflow-y:auto">${o.surveillance_logs.slice(-6).map(s=>`<div style="padding:4px 0;border-bottom:1px dashed #eee"><strong>${escHtml(s.ts||'')}</strong> — ${escHtml(s.agent||'')}<br>${escHtml(s.constantes||'—')} | ${escHtml(s.medicaments||'—')}<br>${escHtml(s.note||'')}</div>`).join('')}</div>`:'<div style="font-size:10px;color:var(--muted)">Aucune entrée de surveillance.</div>'}
        </div>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn btn-success btn-sm" onclick="sortirObs('${o.id}')">Sortir</button>
          <button class="btn btn-sm btn-print" onclick="factureObs('${o.id}')">Facture</button>
        </div>
      </div>`).join('')||'<p style="color:#aaa;text-align:center">Aucun patient en observation</p>'}
    </div>
  </div>`;
  if(!document.getElementById('obs-doc-zone')){
    const z=document.createElement('div');
    z.id='obs-doc-zone';
    el.appendChild(z);
  }
  updateObsTarif();
};

function searchObsPatient(){
  const q=(document.getElementById('obs-search')?.value||'').toLowerCase();
  const res=document.getElementById('obs-results');
  if(q.length<2){res.innerHTML='';return;}
  const pts=DB.get('patients').filter(p=>p.nom.toLowerCase().includes(q)).slice(0,8);
  res.innerHTML=pts.map(p=>`<div class="pat-card" onclick="selectObsPatient('${p.id}','${escSQ(p.nom)}','${p.statut_simple||p.statut}')"><div class="pat-av">${escHtml(p.nom[0]||'')}</div><div style="flex:1"><div style="font-weight:700">${escHtml(p.nom)}</div><div style="font-size:10px;color:var(--muted)">${escHtml(p.dossier_no||'—')}</div></div>${badge(getBillingStatut(p))}</div>`).join('')||'<p style="color:#aaa;text-align:center">Aucun patient</p>';
}
function selectObsPatient(pid,nom,statut){
  document.getElementById('obs-pid').value=pid;
  document.getElementById('obs-nom').value=nom;
  document.getElementById('obs-statut').value=statut||'FPM';
  document.getElementById('obs-search').value='';
  document.getElementById('obs-results').innerHTML='';
  updateObsTarif();
}
function updateObsTarif(){
  const s=document.getElementById('obs-statut')?.value;
  const pid=document.getElementById('obs-pid')?.value||'';
  const sb=getEffectiveBillingStatut(pid,s);
  const el=document.getElementById('obs-tarif-lbl');
  if(!el||!s)return;
  const t=TARIFS.obs[sb]||0;
  el.textContent=fmt(t)+' F/jour'+(sb==='FPM'?' (forfait CMU)':'')+(sb!==s?' (droits non vérifiés)':'');
}
function admettreObs(){
  const nom=document.getElementById('obs-nom').value.trim();
  const statut=document.getElementById('obs-statut').value;
  const pid=document.getElementById('obs-pid')?.value||'';
  const statutFacturation=getEffectiveBillingStatut(pid,statut);
  if(!nom){alert('Saisissez le nom du patient');return;}
  const tarif=TARIFS.obs[statutFacturation]||0;
  DB.push('observations',{patient_id:pid||'',patient_nom:nom,statut,statut_facturation:statutFacturation,motif:document.getElementById('obs-motif').value,
    date_admission:document.getElementById('obs-date-in').value,tarif_j:tarif,statut_obs:'EN COURS',protocole_items:[],protocole_done:{},surveillance_logs:[],date:today()});
  logAudit('OBS_ADMISSION',{patient:nom,statut,statut_facturation:statutFacturation,tarif_j:tarif});
  showView('soins-obs');
}
function saveObsProtocole(id){
  if(!CURRENT_AGENT?.isChef){alert('Action réservée au Médecin-Chef');return;}
  const obs=DB.get('observations'); const idx=obs.findIndex(o=>o.id===id); if(idx<0) return;
  const raw=(document.getElementById('obs-proto-'+id)?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  obs[idx].protocole_items=raw;
  const keep={}; raw.forEach((_,i)=>{if(obs[idx].protocole_done?.[i]) keep[i]=true;});
  obs[idx].protocole_done=keep;
  persistUpdatedRecord('observations',obs,obs[idx]);
  logAudit('OBS_PROTOCOLE_UPDATE',{patient:obs[idx].patient_nom,items:raw.length});
  showView('soins-obs');
}
function saveObsChecklist(id){
  const obs=DB.get('observations'); const idx=obs.findIndex(o=>o.id===id); if(idx<0) return;
  const done={};
  (obs[idx].protocole_items||[]).forEach((_,i)=>{const ck=document.getElementById(`obs-chk-${id}-${i}`); if(ck?.checked) done[i]=true;});
  obs[idx].protocole_done=done;
  persistUpdatedRecord('observations',obs,obs[idx]);
  logAudit('OBS_PROTOCOLE_CHECK',{patient:obs[idx].patient_nom,done:Object.keys(done).length});
}
function addObsSurveillance(id){
  const obs=DB.get('observations'); const idx=obs.findIndex(o=>o.id===id); if(idx<0) return;
  const entry={
    ts:new Date().toLocaleString('fr-FR'),
    agent:CURRENT_AGENT?.nom||'?',
    constantes:document.getElementById(`obs-const-${id}`)?.value||'',
    medicaments:document.getElementById(`obs-med-${id}`)?.value||'',
    note:document.getElementById(`obs-note-${id}`)?.value||''
  };
  if(!entry.constantes&&!entry.medicaments&&!entry.note){alert('Renseignez au moins une information de surveillance');return;}
  obs[idx].surveillance_logs=obs[idx].surveillance_logs||[];
  obs[idx].surveillance_logs.push(entry);
  persistUpdatedRecord('observations',obs,obs[idx]);
  logAudit('OBS_SURVEILLANCE_ADD',{patient:obs[idx].patient_nom,agent:entry.agent});
  showView('soins-obs');
}
function sortirObs(id){
  const obs=DB.get('observations');
  const idx=obs.findIndex(o=>o.id===id);
  if(idx>=0){
    const o=obs[idx];
    const dateIn=new Date(o.date_admission);
    const dateOut=new Date();
    const jours=Math.max(1,Math.ceil((dateOut-dateIn)/(1000*60*60*24)));
    const montant=o.tarif_j*jours;
    obs[idx].statut_obs='SORTI';
    obs[idx].date_sortie=today();
    obs[idx].nb_jours=jours;
    obs[idx].montant_total=montant;
    persistUpdatedRecord('observations',obs,obs[idx]);
    if(montant>0) DB.push('transactions',{
      patient_nom:o.patient_nom,statut:o.statut_facturation||o.statut,service:'SOINS',
      designation:`Observation ${jours}j × ${fmt(o.tarif_j)} F`,
      montant,cnam:0,encaisse:montant,date:today()
    });
    logAudit('OBS_SORTIE',{patient:o.patient_nom,jours,montant});
    alert(`Patient sorti après ${jours} jour(s). Montant : ${fmt(montant)} FCFA`);
    showView('soins-obs');
    setTimeout(()=>renderBilletHospitalisation(obs[idx]),80);
    return;
  }
  showView('soins-obs');
}
function factureObs(id){
  const o=DB.get('observations').find(x=>x.id===id);
  if(!o)return;
  const jours=Math.max(1,Math.ceil((new Date()-new Date(o.date_admission))/(1000*60*60*24)));
  alert(`Observation de ${jours} jour(s)\nTarif : ${fmt(o.tarif_j)} F/j\nTotal estimé : ${fmt(o.tarif_j*jours)} FCFA`);
}
function renderBilletHospitalisation(o){
  const zone=document.getElementById('obs-doc-zone');
  if(!zone||!o) return;
  zone.innerHTML=`
  <div class="card" id="billet-hosp-${o.id}">
    <div class="card-title">Billet de sortie d'hospitalisation</div>
    <div class="recu">
      <div class="recu-title">BILLET DE SORTIE</div>
      <div style="text-align:center;font-size:10px">${new Date().toLocaleString('fr-FR')} | ${CURRENT_AGENT.nom}</div>
      <div class="recu-line"><span>Patient</span><span><strong>${escHtml(o.patient_nom)}</strong></span></div>
      <div class="recu-line"><span>Statut</span><span>${escHtml(o.statut)}</span></div>
      <div class="recu-line"><span>Admission</span><span>${fmtD(o.date_admission)}</span></div>
      <div class="recu-line"><span>Sortie</span><span>${fmtD(o.date_sortie||today())}</span></div>
      <div class="recu-line"><span>Durée</span><span>${o.nb_jours||1} jour(s)</span></div>
      <div class="recu-line"><span>Montant</span><span>${fmt(o.montant_total||0)} FCFA</span></div>
      <div style="font-size:10px;margin-top:6px"><strong>Motif:</strong> ${escHtml(o.motif||'—')}</div>
    </div>
    <div class="btn-row no-print"><button class="btn btn-print btn-sm" onclick="printSection('billet-hosp-${o.id}')">🖨 Imprimer billet</button></div>
  </div>`;
}

VIEW['soins-liste'] = (el) => {
  const soins=DB.todayItems('soins');
  const tot=soins.reduce((s,a)=>s+a.total,0);
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Soins réalisés aujourd'hui — Total ${fmt(tot)} FCFA</div>
    <div class="tw"><table>
      <tr><th>Heure</th><th>Patient</th><th>Statut</th><th>Actes</th><th>Total</th><th>CNAM</th><th>TM</th><th>Agent</th></tr>
      ${soins.map(s=>`<tr>
        <td>${fmtT(s.created_at)}</td><td style="font-weight:700">${escHtml(s.patient_nom)}</td>
        <td>${badge(s.statut)}</td>
        <td style="font-size:10px">${s.actes.map(a=>a.nom).join(', ')}</td>
        <td>${fmt(s.total)} F</td>
        <td style="color:var(--cmu)">${fmt(s.cnam)} F</td>
        <td style="color:var(--or)">${fmt(s.tm)} F</td>
        <td style="font-size:10px;color:var(--muted)">${escHtml(s.agent_nom)}</td>
      </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:#aaa;padding:16px">Aucun soin</td></tr>'}
      ${soins.length?`<tr class="tr-tot"><td colspan="4">TOTAL</td><td>${fmt(tot)}</td><td>${fmt(soins.reduce((s,a)=>s+a.cnam,0))}</td><td>${fmt(soins.reduce((s,a)=>s+a.tm,0))}</td><td></td></tr>`:''}
    </table></div>
  </div>`;
};

// ── SEVCI / PVVIH ───────────────────────────────────────
const SEVCI_ARV=['TDF/3TC/DTG','ABC/3TC/DTG','TDF/3TC/EFV','AZT/3TC/NVP','Autre'];
const SEVCI_IIT=['actif','interrompu','perdu'];
const SEVCI_IVSA=['non_applicable','stade1','stade2','stade3','stade4'];
const SEVCI_ACTIONS=['Visite à domicile','Appel téléphonique','Recherche perdu de vue','Rappel de RDV','Soutien à l\'observance','Causerie éducative','Autre'];

function sevciUpdateFile(id,updates){
  const arr=DB.get('sevci_pvvih');
  const i=arr.findIndex(p=>p.id===id); if(i<0) return false;
  arr[i]={...arr[i],...updates,updated_at:new Date().toISOString()};
  DB.set('sevci_pvvih',arr); queueSync('sevci_pvvih',arr[i]); if(IS_ONLINE&&supa) syncQueue();
  return true;
}
function sevciIndic(){
  const p=DB.get('sevci_pvvih');
  const cvFaite=p.filter(x=>x.charge_virale_val!=null&&x.charge_virale_val!=='');
  const supp=cvFaite.filter(x=>+x.charge_virale_val<1000).length;
  const onARV=p.filter(x=>x.regime_arv).length;
  return {
    total:p.length,
    actif:p.filter(x=>x.iit_status==='actif').length,
    iit:p.filter(x=>x.iit_status==='interrompu').length,
    ivsa:p.filter(x=>x.ivsa_stade&&x.ivsa_stade!=='non_applicable').length,
    onARV, cvFaite:cvFaite.length, supp,
    pctARV:p.length?Math.round(onARV/p.length*100):0,
    pctSupp:onARV?Math.round(supp/onARV*100):0
  };
}
function sevciSynthHTML(){
  const k=sevciIndic();
  return `
  <div class="g4">
    <div class="kpi"><div class="kpi-lbl">File active</div><div class="kpi-val">${k.actif}</div><div class="kpi-sub">sur ${k.total} dossiers</div></div>
    <div class="kpi"><div class="kpi-lbl">CV supprimée</div><div class="kpi-val">${k.supp}</div><div class="kpi-sub">${k.pctSupp}% des sous ARV</div></div>
    <div class="kpi"><div class="kpi-lbl">IIT (interrompus)</div><div class="kpi-val">${k.iit}</div><div class="kpi-sub">à relancer</div></div>
    <div class="kpi"><div class="kpi-lbl">IVSA</div><div class="kpi-val">${k.ivsa}</div><div class="kpi-sub">stade avancé</div></div>
  </div>
  <div class="card"><div class="card-title">Cascade 95-95-95</div>
    <p style="font-size:12px">Sous ARV : <strong>${k.pctARV}%</strong> (${k.onARV}/${k.total}) — CV documentée : <strong>${k.cvFaite}</strong> — CV supprimée : <strong>${k.pctSupp}%</strong> (${k.supp}/${k.onARV})</p>
  </div>
  <div class="card"><div class="card-title">Activité communautaire</div>
    <p style="font-size:12px">${DB.get('sevci_actions').length} action(s) au total — aujourd'hui : <strong>${DB.todayItems('sevci_actions').length}</strong></p>
  </div>`;
}
function sevciAgentTableHTML(){
  const byAgent={};
  DB.get('sevci_pvvih').forEach(p=>{const a=p.agent_nom||'—';(byAgent[a]=byAgent[a]||{files:0,actions:0}).files++;});
  DB.get('sevci_actions').forEach(x=>{const a=x.agent_nom||'—';(byAgent[a]=byAgent[a]||{files:0,actions:0}).actions++;});
  const rows=Object.entries(byAgent);
  return `<div class="card"><div class="card-title">Activité par agent</div><div class="tw"><table>
    <tr><th>Agent</th><th>Dossiers saisis</th><th>Actions communautaires</th></tr>
    ${rows.map(([a,v])=>`<tr><td>${escHtml(a)}</td><td>${v.files}</td><td>${v.actions}</td></tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:#aaa;padding:16px">Aucune donnée</td></tr>'}
  </table></div></div>`;
}

VIEW['sevci-file'] = (el) => {
  const list=DB.get('sevci_pvvih');
  el.innerHTML=`
  <div class="card"><div class="card-title">Nouveau dossier PVVIH</div>
    <div class="alert-box" style="background:#fdf3e2;border-left:4px solid var(--or);padding:8px 12px;font-size:11px;margin-bottom:10px">⚠️ Confidentialité : ne jamais saisir le nom du patient. Le N° de dossier suffit à l'identifier.</div>
    <div class="fs">
      <div class="fr"><label>N° dossier</label><input id="sv-dossier" placeholder="Ex : PVVIH-2026-001"></div>
      <div class="fr"><label>Catégorie</label><select id="sv-cat"><option>Militaire</option><option>Civil</option></select></div>
      <div class="fr"><label>Sexe</label><select id="sv-sexe"><option>F</option><option>M</option></select></div>
      <div class="fr"><label>Date d'inclusion</label><input type="date" id="sv-incl" value="${today()}"></div>
      <div class="fr"><label>Régime ARV</label><select id="sv-arv">${SEVCI_ARV.map(a=>`<option>${a}</option>`).join('')}</select></div>
      <div class="fr"><label>CD4 initial</label><input type="number" id="sv-cd4"></div>
      <div class="fr"><label>Statut traitement</label><select id="sv-iit">${SEVCI_IIT.map(s=>`<option>${s}</option>`).join('')}</select></div>
      <div class="fr"><label>Stade IVSA</label><select id="sv-ivsa">${SEVCI_IVSA.map(s=>`<option>${s}</option>`).join('')}</select></div>
      <button class="btn btn-primary" onclick="sevciSaveFile()">Enregistrer le dossier</button>
    </div>
  </div>
  <div class="card"><div class="card-title">File active PVVIH (${list.length})</div>
    <div class="tw"><table>
      <tr><th>Dossier</th><th>Catégorie</th><th>Sexe</th><th>Régime ARV</th><th>Dernière CV</th><th>Statut</th><th>IVSA</th><th>Agent</th><th>Actions</th></tr>
      ${list.map(p=>`<tr>
        <td style="font-weight:700">${escHtml(p.num_dossier||'—')}</td>
        <td>${escHtml(p.categorie||'—')}</td>
        <td style="font-size:10px">${escHtml(p.sexe||'—')}</td>
        <td style="font-size:10px">${escHtml(p.regime_arv||'—')}</td>
        <td>${(p.charge_virale_val!=null&&p.charge_virale_val!=='')?escHtml(String(p.charge_virale_val)):'—'}</td>
        <td>${badge(p.iit_status==='actif'?'OK':(p.iit_status==='interrompu'?'ERR':'WARN'))} <span style="font-size:10px">${escHtml(p.iit_status||'')}</span></td>
        <td style="font-size:10px">${escHtml(p.ivsa_stade||'')}</td>
        <td style="font-size:10px;color:var(--muted)">${escHtml(p.agent_nom||'')}</td>
        <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="sevciEditFile('${p.id}')">Éditer</button> <button class="btn btn-ghost btn-sm" onclick="sevciCvHistory('${p.id}')">Hist. CV</button></td>
      </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:#aaa;padding:16px">Aucun dossier</td></tr>'}
    </table></div>
  </div>`;
};
function sevciSaveFile(){
  const dossier=document.getElementById('sv-dossier').value.trim();
  if(!dossier){alert('N° dossier requis');return;}
  DB.push('sevci_pvvih',{
    num_dossier:dossier, categorie:document.getElementById('sv-cat').value,
    sexe:document.getElementById('sv-sexe').value,
    date_inclusion:document.getElementById('sv-incl').value,
    regime_arv:document.getElementById('sv-arv').value,
    cd4_initial:+document.getElementById('sv-cd4').value||null,
    iit_status:document.getElementById('sv-iit').value,
    ivsa_stade:document.getElementById('sv-ivsa').value,
    charge_virale_val:null, charge_virale_date:null, cv_supprimee_date:null
  });
  logAudit('SEVCI_FILE_ADD',{dossier});
  showView('sevci-file');
}
function sevciGet(id){ return DB.get('sevci_pvvih').find(p=>p.id===id); }
function sevciRender(html){
  const c=document.getElementById('content'); c.innerHTML='';
  const el=document.createElement('div'); c.appendChild(el); el.innerHTML=html;
}
function sevciEditFile(id){
  const p=sevciGet(id); if(!p){alert('Dossier introuvable');return;}
  const sel=(opts,val)=>opts.map(o=>`<option${o===val?' selected':''}>${o}</option>`).join('');
  sevciRender(`
  <div class="card"><div class="card-title">Éditer le dossier ${escHtml(p.num_dossier||'')}</div>
    <div class="fs">
      <div class="fr"><label>N° dossier</label><input value="${escHtml(p.num_dossier||'')}" disabled style="flex:1;background:#f0f0f0"></div>
      <div class="fr"><label>Catégorie</label><select id="ed-cat">${sel(['Militaire','Civil'],p.categorie)}</select></div>
      <div class="fr"><label>Sexe</label><select id="ed-sexe">${sel(['F','M'],p.sexe)}</select></div>
      <div class="fr"><label>Régime ARV</label><select id="ed-arv">${sel(SEVCI_ARV,p.regime_arv)}</select></div>
      <div class="fr"><label>CD4 initial</label><input type="number" id="ed-cd4" value="${p.cd4_initial!=null?p.cd4_initial:''}"></div>
      <div class="fr"><label>Statut traitement</label><select id="ed-iit">${sel(SEVCI_IIT,p.iit_status)}</select></div>
      <div class="fr"><label>Stade IVSA</label><select id="ed-ivsa">${sel(SEVCI_IVSA,p.ivsa_stade)}</select></div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="sevciSaveEdit('${id}')">Enregistrer les modifications</button>
        <button class="btn btn-ghost" onclick="showView('sevci-file')">Annuler</button>
      </div>
    </div>
  </div>`);
}
function sevciSaveEdit(id){
  const ok=sevciUpdateFile(id,{
    categorie:document.getElementById('ed-cat').value,
    sexe:document.getElementById('ed-sexe').value,
    regime_arv:document.getElementById('ed-arv').value,
    cd4_initial:+document.getElementById('ed-cd4').value||null,
    iit_status:document.getElementById('ed-iit').value,
    ivsa_stade:document.getElementById('ed-ivsa').value
  });
  if(ok) logAudit('SEVCI_FILE_EDIT',{id});
  showView('sevci-file');
}
function sevciCvHistory(id){
  const p=sevciGet(id); if(!p){alert('Dossier introuvable');return;}
  const hist=Array.isArray(p.cv_history)?p.cv_history:[];
  sevciRender(`
  <div class="card"><div class="card-title">Historique des charges virales — ${escHtml(p.num_dossier||'')}</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Résultat (cp/mL)</th><th>Suppression</th><th>Agent</th></tr>
      ${hist.map(h=>`<tr>
        <td>${escHtml(h.date||'—')}</td>
        <td class="num">${escHtml(String(h.val))}</td>
        <td>${(+h.val<1000)?badge('OK')+' <span style="font-size:10px">supprimée</span>':badge('ERR')+' <span style="font-size:10px">non supprimée</span>'}</td>
        <td style="font-size:10px;color:var(--muted)">${escHtml(h.agent||'')}</td>
      </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#aaa;padding:16px">Aucune charge virale enregistrée</td></tr>'}
    </table></div>
    <div class="btn-row" style="margin-top:10px"><button class="btn btn-ghost" onclick="showView('sevci-file')">Retour</button></div>
  </div>`);
}

VIEW['sevci-cv'] = (el) => {
  const list=DB.get('sevci_pvvih');
  el.innerHTML=`
  <div class="card"><div class="card-title">Saisie d'une charge virale</div>
    <div class="fs">
      <div class="fr"><label>Dossier</label><select id="cv-pid">${list.map(p=>`<option value="${p.id}">${escHtml(p.num_dossier||'')} (${escHtml(p.categorie||'—')})</option>`).join('')}</select></div>
      <div class="fr"><label>Date de prélèvement</label><input type="date" id="cv-date" value="${today()}"></div>
      <div class="fr"><label>Résultat (cp/mL)</label><input type="number" id="cv-val"></div>
      <button class="btn btn-primary" onclick="sevciSaveCV()">Enregistrer la CV</button>
    </div>
    <p style="font-size:11px;color:var(--muted)">Suppression virologique si résultat &lt; 1000 cp/mL.</p>
  </div>`;
};
function sevciSaveCV(){
  const id=document.getElementById('cv-pid').value;
  const val=+document.getElementById('cv-val').value;
  const date=document.getElementById('cv-date').value;
  if(!id||!val){alert('Dossier et résultat requis');return;}
  const supp=val<1000;
  const rec=sevciGet(id);
  const hist=Array.isArray(rec&&rec.cv_history)?rec.cv_history.slice():[];
  hist.unshift({date,val,agent:CURRENT_AGENT&&CURRENT_AGENT.nom||''});
  const upd={charge_virale_val:val,charge_virale_date:date,cv_history:hist};
  if(supp) upd.cv_supprimee_date=date;
  sevciUpdateFile(id,upd);
  logAudit('SEVCI_CV_ADD',{patient:id,val});
  alert(supp?'Charge virale supprimée enregistrée.':'CV non supprimée (≥ 1000) — patient à suivre.');
  showView('sevci-cv');
}

VIEW['sevci-indicateurs'] = (el) => { el.innerHTML=sevciSynthHTML(); };

VIEW['sevci-communautaire'] = (el) => {
  el.innerHTML=`
  <div class="card"><div class="card-title">Enregistrer une action communautaire</div>
    <div class="fs">
      <div class="fr"><label>Type d'action</label><select id="ac-type">${SEVCI_ACTIONS.map(a=>`<option>${a}</option>`).join('')}</select></div>
      <div class="fr"><label>N° dossier PVVIH</label><input id="ac-dossier" placeholder="Ex : PVVIH-2026-001"></div>
      <div class="fr"><label>Catégorie</label><select id="ac-cat"><option>Militaire</option><option>Civil</option></select></div>
      <div class="fr"><label>Résultat</label><select id="ac-res"><option>Réalisé</option><option>Tentative sans succès</option><option>Reprogrammé</option></select></div>
      <div class="fr"><label>Notes</label><textarea id="ac-notes" placeholder="Sans nom ni donnée identifiante"></textarea></div>
      <button class="btn btn-primary" onclick="sevciSaveAction()">Enregistrer l'action</button>
    </div>
    <div class="alert-box" style="background:#fdf3e2;border-left:4px solid var(--or);padding:8px 12px;font-size:11px;margin-top:8px">⚠️ Confidentialité : identifier le bénéficiaire par son N° de dossier, jamais par son nom.</div>
  </div>`;
};
function sevciSaveAction(){
  const dossier=document.getElementById('ac-dossier').value.trim();
  if(!dossier){alert('N° dossier requis');return;}
  DB.push('sevci_actions',{
    type:document.getElementById('ac-type').value,
    num_dossier:dossier,
    categorie:document.getElementById('ac-cat').value,
    resultat:document.getElementById('ac-res').value,
    notes:document.getElementById('ac-notes').value.trim()
  });
  logAudit('SEVCI_ACTION_ADD',{type:document.getElementById('ac-type').value});
  showView('sevci-actions-liste');
}

VIEW['sevci-actions-liste'] = (el) => {
  const acts=DB.get('sevci_actions').slice(0,200);
  el.innerHTML=`<div class="card"><div class="card-title">Actions communautaires récentes (${acts.length})</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Type</th><th>N° dossier</th><th>Catégorie</th><th>Résultat</th><th>Notes</th><th>Agent</th></tr>
      ${acts.map(a=>`<tr>
        <td>${fmtD(a.created_at)}</td>
        <td>${escHtml(a.type||'')}</td>
        <td style="font-weight:700">${escHtml(a.num_dossier||'—')}</td>
        <td>${escHtml(a.categorie||'—')}</td>
        <td>${escHtml(a.resultat||'')}</td>
        <td style="font-size:10px">${escHtml(a.notes||'')}</td>
        <td style="font-size:10px;color:var(--muted)">${escHtml(a.agent_nom||'')}</td>
      </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:#aaa;padding:16px">Aucune action</td></tr>'}
    </table></div>
  </div>`;
};

VIEW['sevci-supervision'] = (el) => {
  el.innerHTML=`<div class="card"><div class="card-title">Supervision SEV-CI</div>
    <p style="font-size:12px;color:var(--muted)">Synthèse consolidée du travail de l'équipe (moniteur de données + médiatrice communautaire).</p>
  </div>`+sevciSynthHTML()+sevciAgentTableHTML();
};

VIEW['sevci-dsasa'] = (el) => {
  el.innerHTML=`<div class="card"><div class="card-title">Rapport DSASA — PVVIH</div>${sevciSynthHTML()}
    <button class="btn btn-primary" onclick="sevciExportDSASA()">Exporter le rapport (JSON)</button>
  </div>`;
};
function sevciExportDSASA(){
  const data={date:new Date().toISOString(),site:'01649',indicateurs:sevciIndic(),file_active:DB.get('sevci_pvvih'),actions:DB.get('sevci_actions')};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='DSASA_PVVIH_'+today()+'.json'; a.click();
  logAudit('SEVCI_DSASA_EXPORT',{count:DB.get('sevci_pvvih').length});
}

VIEW['chef-sevci'] = (el) => {
  el.innerHTML=`<div class="card"><div class="card-title">Synthèse SEV-CI / PVVIH</div>
    <p style="font-size:12px;color:var(--muted)">Vue consolidée du programme PVVIH — travail des médiatrices, moniteurs de données et superviseurs.</p>
  </div>`+sevciSynthHTML()+sevciAgentTableHTML();
};

// ── LABO — Saisie ───────────────────────────────────────
VIEW['labo-saisie'] = (el) => {
  const cats=[...new Set(LABO_ACTES.map(a=>a.cat))];
  el.innerHTML=`
  <div class="g2">
    <div class="card" style="max-height:85vh;overflow-y:auto">
      <div class="card-title">Saisie des actes biologiques</div>
      <div class="sb"><input type="text" id="lb-search" placeholder="Rechercher patient orienté LABO..." oninput="searchLaboPatient()"></div>
      <div id="lb-results" style="max-height:120px;overflow-y:auto"></div>
      <div class="fr" style="margin-top:4px"><label><input type="checkbox" id="lb-new-toggle" onchange="toggleLbNew()"> Nouveau patient (non enregistré à l'accueil)</label></div>
      <div id="lb-new-wrap" style="display:none;border:1px dashed var(--bleu);border-radius:8px;padding:10px;margin-bottom:8px;background:#eff5fc">
        <div class="fr"><label>Nom du patient</label><input type="text" id="lb-new-nom" placeholder="Nom et prénoms"></div>
        <div class="fr"><label>Sexe</label><select id="lb-new-genre"><option>M</option><option>F</option></select></div>
        <div class="fr"><label>Statut</label><select id="lb-new-statut"><option value="NA">NA (non assuré)</option><option value="FPM">FPM</option><option value="CMU">CMU</option></select></div>
        <button class="btn btn-primary btn-sm" onclick="lbCreatePatient()">Créer et sélectionner</button>
      </div>
      <input type="hidden" id="lb-pid">
      <div class="fr"><label>Patient *</label><input type="text" id="lb-nom" placeholder="Nom du patient"></div>
      <div class="fr"><label>N° dossier</label><input type="text" id="lb-dossier" placeholder="CSA-AAMM-NNNNN"></div>
      <div class="fr"><label>Statut</label>
        <select id="lb-statut" onchange="updateLaboTotal()">
          <option value="FPM">FPM (forfait CMU — TM 30%)</option>
          <option value="CMU">CMU (TM 30%)</option>
          <option value="NA">Non-assuré (100%)</option>
        </select></div>
      <div class="fr"><label>Prélevé par</label><input type="text" id="lb-prel" placeholder="Initiales tech."></div>
      ${cats.map(cat=>`
        <div class="fs">
          <div class="fs-title" style="color:var(--bleu)">${cat}</div>
          ${LABO_ACTES.filter(a=>a.cat===cat).map(a=>`
            <div class="fr" style="padding:3px 0;border-bottom:1px solid #f8f8f8">
              <label style="font-size:11px"><strong style="color:var(--bleu);font-size:10px">${a.code}</strong> ${escHtml(a.nom)}<br><span style="font-size:9px;color:#aaa">${a.tube}</span></label>
              <span style="font-size:9px;color:#999">B${a.cot}=${fmt(a.cot*TARIFS.B)}F</span>
              <input type="number" class="lb-qty" data-code="${a.code}" data-nom="${escHtml(a.nom)}" data-cot="${a.cot}" data-tube="${a.tube}" min="0" value="0" onchange="updateLaboTotal()" style="width:50px">
            </div>`).join('')}
        </div>`).join('')}
      <div class="tl"><span>Total actes</span><strong id="lb-tot-lbl">0 FCFA</strong></div>
      <div class="tl sub"><span>Part CNAM (70%)</span><span id="lb-cnam-lbl" style="font-weight:700;color:var(--cmu)">0</span></div>
      <div class="tl sub"><span>Ticket modérateur</span><span id="lb-tm-lbl" style="font-weight:700;color:var(--or)">0</span></div>
      <div class="fr"><label>Résultat / Commentaire</label><textarea id="lb-result" placeholder="Résultats, commentaires..."></textarea></div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="saveLabo()">Enregistrer + Facture</button>
        <button class="btn btn-danger btn-sm" onclick="resetLabo()">Effacer</button>
      </div>
    </div>
    <div id="lb-facture-zone"></div>
  </div>`;
};
function searchLaboPatient(){
  const q=document.getElementById('lb-search').value.toLowerCase();
  const res=document.getElementById('lb-results');
  if(q.length<2){res.innerHTML='';return;}
  const oriented=getOrientedPatients('LABO');
  const found=oriented.filter(c=>c.patient_nom.toLowerCase().includes(q)).slice(0,8);
  res.innerHTML=found.map(c=>{
    const patient=getPatientById(c.patient_id);
    const dossier=patient?.dossier_no||'NON ATTRIBUE';
    return `<div class="pat-card" onclick="selectLaboPatient('${c.patient_id}','${escSQ(c.patient_nom)}','${escSQ(dossier)}','${escSQ(c.statut)}')">
      <div class="pat-av" style="background:#e8f0ff">${escHtml(c.patient_nom[0]||'')}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:12px">${escHtml(c.patient_nom)}</div>
        <div style="font-size:10px;color:var(--muted)">${escHtml(dossier)} • ${escHtml(c.statut)}</div>
      </div>
      <span class="badge b-ok">LABO</span>
    </div>`;
  }).join('')||'<p style="color:#aaa;text-align:center;padding:8px">Aucun patient orienté LABO</p>';
}
function selectLaboPatient(pid,nom,dossier,statut){
  document.getElementById('lb-pid').value=pid||'';
  document.getElementById('lb-nom').value=nom;
  document.getElementById('lb-dossier').value=dossier;
  document.getElementById('lb-statut').value=statut||'FPM';
  document.getElementById('lb-search').value='';
  document.getElementById('lb-results').innerHTML='';
  updateLaboTotal();
}
function toggleLbNew(){ const on=document.getElementById('lb-new-toggle')?.checked; const w=document.getElementById('lb-new-wrap'); if(w) w.style.display=on?'block':'none'; }
function lbCreatePatient(){
  const nom=document.getElementById('lb-new-nom').value.trim();
  if(!nom){alert('Le nom du patient est obligatoire');return;}
  const statut=document.getElementById('lb-new-statut').value;
  const p=DB.push('patients',{ nom, ddn:'', genre:document.getElementById('lb-new-genre').value, tel:'', adresse:'', statut, statut_simple:statut, droits_verifies:'1', cmu_disponible:'0', antecedents:'', dossier_no:generatePatientDossier(), batiment:CURRENT_AGENT.bldg||'SOUS-PREFECTURE', date:today(), cree_par:'labo' });
  logAudit('PATIENT_CREATE',{patient_id:p.id,dossier_no:p.dossier_no,nom:p.nom,statut,via:'labo'});
  document.getElementById('lb-new-nom').value='';
  const t=document.getElementById('lb-new-toggle'); if(t) t.checked=false; toggleLbNew();
  selectLaboPatient(p.id, p.nom, p.dossier_no, p.statut_simple||p.statut);
}
function updateLaboTotal(){
  const s=document.getElementById('lb-statut')?.value||'FPM';
  const pid=document.getElementById('lb-pid')?.value||'';
  const sf=getEffectiveBillingStatut(pid,s);
  let tot=0;
  document.querySelectorAll('.lb-qty').forEach(i=>{const q=+i.value||0,c=+i.dataset.cot||0;tot+=q*c*TARIFS.B;});
  // FPM paye au forfait CMU pour la biologie (TM 30%) — seule la consultation est gratuite FPM
  const isFPMouCMU = sf==='FPM'||sf==='CMU';
  const cnam=isFPMouCMU?Math.round(tot*0.7):0;
  const tm=isFPMouCMU?Math.round(tot*0.3):tot;
  document.getElementById('lb-tot-lbl').textContent=fmt(tot)+' FCFA';
  document.getElementById('lb-cnam-lbl').textContent=fmt(cnam)+' FCFA';
  document.getElementById('lb-tm-lbl').textContent=fmt(tm)+' FCFA'+(sf==='FPM'?' (forfait CMU)':'')+(sf!==s?' (droits non vérifiés)':'');
}
function saveLabo(){
  const nom=document.getElementById('lb-nom').value.trim();
  const s=document.getElementById('lb-statut').value;
  const pid=document.getElementById('lb-pid')?.value||'';
  const sf=getEffectiveBillingStatut(pid,s);
  if(!nom){alert('Saisissez le nom du patient');return;}
  let actes=[],tot=0;
  document.querySelectorAll('.lb-qty').forEach(i=>{
    const q=+i.value||0;
    if(q>0){const c=+i.dataset.cot,m=q*c*TARIFS.B;actes.push({code:i.dataset.code,nom:i.dataset.nom,tube:i.dataset.tube,cot:c,qte:q,montant:m});tot+=m;}
  });
  if(!actes.length){alert('Sélectionnez au moins un acte');return;}
  // FPM paye au forfait CMU pour la biologie (TM 30%) — seule la consultation est gratuite FPM
  const isFPMouCMU = sf==='FPM'||sf==='CMU';
  const cnam=isFPMouCMU?Math.round(tot*0.7):0;
  const tm=isFPMouCMU?Math.round(tot*0.3):tot;
  const result=document.getElementById('lb-result').value;
  const r=DB.push('labo_actes',{patient_nom:nom,dossier:document.getElementById('lb-dossier').value,
    patient_id:pid||'',statut:s,statut_facturation:sf,actes,total:tot,cnam,tm,resultat:result,preleve_par:document.getElementById('lb-prel').value,date:today()});
  logAudit('LABO_CREATE',{patient_nom:nom,statut:s,statut_facturation:sf,total:tot,dossier:r.dossier||''});
  DB.push('transactions',{patient_nom:nom,statut:sf,service:'LABO',
    designation:'Bio: '+actes.map(a=>a.nom).join(', '),montant:tot,cnam,encaisse:tm,date:today()});
  const now=new Date();
  document.getElementById('lb-facture-zone').innerHTML=`
    <div class="card" id="fact-labo-${r.id}">
      <div class="card-title">Facture biologie — Imprimable</div>
      <div class="recu">
        <div class="recu-title">LABORATOIRE — CSA PLATEAU</div>
        <div style="text-align:center;font-size:10px">${now.toLocaleString('fr-FR')} | ${escHtml(CURRENT_AGENT.nom)}</div>
        <div style="text-align:center;font-weight:700;margin:4px 0">${escHtml(nom)} — ${escHtml(s)} / Facturation ${escHtml(sf)}</div>
        <hr style="margin:4px 0">
        ${actes.map(a=>`<div class="recu-line"><span>${escHtml(a.code)} — ${escHtml(a.nom)} ×${fmt(a.qte)}</span><span>${fmt(a.montant)} F</span></div>`).join('')}
        <div class="recu-tot"><span>TOTAL</span><span>${fmt(tot)} FCFA</span></div>
        ${sf==='NA'?`<div style="font-size:10px;margin-top:4px">Tarif plein (droits non vérifiés ou non-assuré)</div>`:`<div style="font-size:10px;color:#666;margin-top:4px">CNAM 70%: ${fmt(cnam)} F | TM${sf==='FPM'?' (forfait CMU)':''}: ${fmt(tm)} F</div>`}
        <div style="font-size:10px;margin-top:6px;color:#555">Tubes requis : ${escHtml([...new Set(actes.map(a=>a.tube))].join(', '))}</div>
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-print btn-sm" onclick="printSection('fact-labo-${r.id}')">Imprimer</button>
      </div>
    </div>`;
  resetLabo();
}
function resetLabo(){
  const p=document.getElementById('lb-pid'); if(p)p.value='';
  document.getElementById('lb-nom').value='';
  document.getElementById('lb-dossier').value='';
  document.getElementById('lb-result').value='';
  document.getElementById('lb-prel').value='';
  document.querySelectorAll('.lb-qty').forEach(i=>i.value=0);
  updateLaboTotal();
}

VIEW['labo-resultats'] = (el) => {
  const actes=DB.todayItems('labo_actes');
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Résultats biologie du jour (${actes.length} dossiers)</div>
    <div class="tw"><table>
      <tr><th>Heure</th><th>Patient</th><th>Statut</th><th>Actes</th><th>Total</th><th>CNAM</th><th>TM</th><th>Résultat</th><th>Tech.</th></tr>
      ${actes.map(a=>`<tr>
        <td>${fmtT(a.created_at)}</td><td style="font-weight:700">${escHtml(a.patient_nom)}</td>
        <td>${badge(a.statut)}</td>
        <td style="font-size:10px">${a.actes.map(x=>x.code).join(', ')}</td>
        <td>${fmt(a.total)} F</td>
        <td style="color:var(--cmu)">${fmt(a.cnam)} F</td>
        <td style="color:var(--or)">${fmt(a.tm)} F</td>
        <td style="font-size:10px;color:var(--rouge)">${a.resultat||'—'}</td>
        <td style="font-size:10px;color:var(--muted)">${a.preleve_par||a.agent_nom}</td>
      </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:#aaa;padding:16px">Aucun acte</td></tr>'}
    </table></div>
  </div>`;
};

VIEW['labo-feuilles'] = (el) => {
  const actes=DB.get('labo_actes').filter(a=>a.statut==='CMU'||a.statut==='FPM');
  const totCnam=actes.reduce((s,a)=>s+a.cnam,0);
  el.innerHTML=`
  <div class="al al-warn" style="margin-bottom:12px">
    <strong>⏰ Rappel CNAM</strong>Feuilles de soins à transmettre avant le 5 du mois suivant. Total à facturer : <strong>${fmt(totCnam)} FCFA</strong>
  </div>
  <div class="card" id="feuilles-print">
    <div class="card-title">Feuilles de soins CMU/FPM — ${actes.length} dossiers</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Patient</th><th>Statut</th><th>Codes actes</th><th>Total</th><th>Part CNAM</th><th>TM</th></tr>
      ${actes.slice(0,60).map(a=>`<tr>
        <td>${fmtD(a.created_at)}</td><td style="font-weight:700">${escHtml(a.patient_nom)}</td>
        <td>${badge(a.statut)}</td>
        <td style="font-size:10px">${a.actes.map(x=>x.code+' B'+x.cot).join(', ')}</td>
        <td>${fmt(a.total)} F</td>
        <td style="color:var(--cmu);font-weight:700">${fmt(a.cnam)} F</td>
        <td style="color:var(--or)">${fmt(a.tm)} F</td>
      </tr>`).join('')}
      ${actes.length?`<tr class="tr-tot"><td colspan="4">TOTAL (${actes.length} dossiers)</td><td>${fmt(actes.reduce((s,a)=>s+a.total,0))} F</td><td style="color:var(--cmu)">${fmt(totCnam)} F</td><td>${fmt(actes.reduce((s,a)=>s+a.tm,0))} F</td></tr>`:''}
    </table></div>
    <div class="btn-row no-print"><button class="btn btn-print btn-sm" onclick="printSection('feuilles-print')">Imprimer pour CNAM</button></div>
  </div>`;
};

// ── PHARMACIE — Délivrance ───────────────────────────────
VIEW['pha-vente'] = (el) => {
  const stock=DB.getStock();
  const cataloguePending=stock.filter(m=>m.catalogue_status==='A_INVENTORIER'||(+m.px_cession||0)<=0);
  el.innerHTML=`
  ${!stock.length?`<div class="al al-warn"><strong>Catalogue pharmacie non initialisé</strong>Le Médecin-Chef doit exécuter la migration du catalogue V4 avant toute délivrance.</div>`:
    cataloguePending.length?`<div class="al al-info"><strong>Catalogue réel en cours d'initialisation</strong>${cataloguePending.length} référence(s) attendent un inventaire physique ou un tarif validé. Une délivrance reste impossible tant que le stock correspondant est nul.</div>`:''}
  <div class="g2">
    <div class="card">
      <div class="card-title">Délivrance de médicaments</div>
      <div class="fr"><label>Origine</label>
        <select id="ph-origine" onchange="togglePhDirectReason()">
          <option value="ORIENTATION">Orientation consultation</option>
          <option value="DIRECTE">Entrée directe pharmacie</option>
        </select></div>
      <div class="sb"><input type="text" id="ph-search" placeholder="Rechercher patient..." oninput="searchPharmaPatient()"></div>
      <div id="ph-results" style="max-height:120px;overflow-y:auto"></div>
      <div class="fr" style="margin-top:4px"><label><input type="checkbox" id="ph-new-toggle" onchange="togglePhNew()"> Nouveau patient (non enregistré à l'accueil)</label></div>
      <div id="ph-new-wrap" style="display:none;border:1px dashed var(--violet);border-radius:8px;padding:10px;margin-bottom:8px;background:#f5f0fb">
        <div class="fr"><label>Nom du patient</label><input type="text" id="ph-new-nom" placeholder="Nom et prénoms"></div>
        <div class="fr"><label>Sexe</label><select id="ph-new-genre"><option>M</option><option>F</option></select></div>
        <div class="fr"><label>Statut</label><select id="ph-new-statut"><option value="NA">NA (non assuré)</option><option value="FPM">FPM</option><option value="CMU">CMU</option></select></div>
        <button class="btn btn-primary btn-sm" onclick="phCreatePatient()">Créer et sélectionner</button>
      </div>
      <input type="hidden" id="ph-pid">
      <div class="fr" id="ph-direct-motif-wrap" style="display:none"><label>Motif entrée directe (obligatoire)</label><input type="text" id="ph-direct-motif" placeholder="Ex: achat direct médicament chronique"></div>
      <div class="fr"><label>Patient *</label><input type="text" id="ph-nom" placeholder="Nom du patient"></div>
      <div class="fr"><label>Statut</label>
        <select id="ph-statut" onchange="updatePhaTotal()">
          <option value="FPM">FPM (0% à charge)</option>
          <option value="CMU">CMU (tarif officiel si produit éligible)</option>
          <option value="NA">Non-assuré (prix fixé Médecin-Chef)</option>
        </select></div>
      <div class="fr"><label>N° ordonnance</label><input type="text" id="ph-ord" placeholder="ORD-XXXXX"></div>
      <div class="fs">
        <div class="fs-title" style="color:var(--orang)">Médicaments délivrés</div>
        <div style="max-height:220px;overflow-y:auto" id="pha-items-wrap">
          ${stock.map(m=>`
            <div class="fr" style="padding:3px 0;border-bottom:1px solid #f5f5f5;align-items:flex-start">
              <div style="flex:1">
                <div style="font-size:11px;font-weight:700">${escHtml(m.nom)}</div>
                <div style="font-size:9px;color:#aaa">${escHtml(m.dci||'—')} | ${escHtml(m.dosage||'Non renseigné')} | ${escHtml(pharmaForm(m))} | ${escHtml(canonicalPharmaPack(m.conditionnement||m.unite))}</div>
                <div style="font-size:9px;color:#aaa">EAN: ${escHtml(m.code_ean||'non renseigné')} | Stock: <span style="color:${m.catalogue_status==='A_INVENTORIER'?'var(--orang)':isOperationalStockAlert(m)?'var(--rouge)':'var(--vert)'};font-weight:700">${m.stock}</span></div>
                <div style="font-size:9px;color:var(--muted)">FPM: ${fmt(m.px_cession)}F | CMU: ${m.cmu_eligible?fmt(pxCMU(m))+'F':'non éligible'} | Hors CMU: ${fmt(pxNA(m))}F</div>
              </div>
              <div style="text-align:right;min-width:100px">
                <input type="number" class="ph-qty" data-id="${m.id}" data-nom="${escHtml(m.nom)}" data-px-fpm="${m.px_cession}" data-px-cmu="${pxCMU(m)}" data-px-na="${pxNA(m)}" min="0" value="0" onchange="updatePhaTotal()" style="width:60px;padding:4px">
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="tl"><span>Total à payer</span><strong id="ph-tot-lbl">0 FCFA</strong></div>
      <div class="tl sub"><span>Part CNAM</span><span id="ph-cnam-lbl" style="color:var(--cmu);font-weight:700">0</span></div>
      <div class="btn-row">
        <button class="btn btn-success" onclick="savePharmaVente()">Valider délivrance + Reçu</button>
      </div>
    </div>
    <div id="ph-recu-zone"></div>
  </div>`;
};
function togglePhDirectReason(){
  const o=document.getElementById('ph-origine')?.value;
  const w=document.getElementById('ph-direct-motif-wrap');
  if(w) w.style.display=o==='DIRECTE'?'flex':'none';
}
function searchPharmaPatient(){
  const q=(document.getElementById('ph-search')?.value||'').toLowerCase();
  const res=document.getElementById('ph-results');
  if(q.length<2){res.innerHTML='';return;}
  const pts=DB.get('patients').filter(p=>p.nom.toLowerCase().includes(q)).slice(0,8);
  res.innerHTML=pts.map(p=>`<div class="pat-card" onclick="selectPharmaPatient('${p.id}','${escSQ(p.nom)}','${p.statut_simple||p.statut}')"><div class="pat-av">${escHtml(p.nom[0]||'')}</div><div style="flex:1"><div style="font-weight:700">${escHtml(p.nom)}</div><div style="font-size:10px;color:var(--muted)">${escHtml(p.dossier_no||'—')}</div></div>${badge(getBillingStatut(p))}</div>`).join('')||'<p style="color:#aaa;text-align:center">Aucun patient</p>';
}
function selectPharmaPatient(pid,nom,statut){
  document.getElementById('ph-pid').value=pid||'';
  document.getElementById('ph-nom').value=nom;
  document.getElementById('ph-statut').value=statut||'FPM';
  document.getElementById('ph-search').value='';
  document.getElementById('ph-results').innerHTML='';
  updatePhaTotal();
}
function togglePhNew(){ const on=document.getElementById('ph-new-toggle')?.checked; const w=document.getElementById('ph-new-wrap'); if(w) w.style.display=on?'block':'none'; }
function phCreatePatient(){
  const nom=document.getElementById('ph-new-nom').value.trim();
  if(!nom){alert('Le nom du patient est obligatoire');return;}
  const statut=document.getElementById('ph-new-statut').value;
  const p=DB.push('patients',{ nom, ddn:'', genre:document.getElementById('ph-new-genre').value, tel:'', adresse:'', statut, statut_simple:statut, droits_verifies:'1', cmu_disponible:'0', antecedents:'', dossier_no:generatePatientDossier(), batiment:CURRENT_AGENT.bldg||'SOUS-PREFECTURE', date:today(), cree_par:'pharmacie' });
  logAudit('PATIENT_CREATE',{patient_id:p.id,dossier_no:p.dossier_no,nom:p.nom,statut,via:'pharmacie'});
  document.getElementById('ph-new-nom').value='';
  const t=document.getElementById('ph-new-toggle'); if(t) t.checked=false; togglePhNew();
  selectPharmaPatient(p.id, p.nom, p.statut_simple||p.statut);
}
function updatePhaTotal(){
  const s=document.getElementById('ph-statut')?.value||'FPM';
  const pid=document.getElementById('ph-pid')?.value||'';
  const sf=getEffectiveBillingStatut(pid,s);
  const stock=DB.getStock();
  let tot=0;
  document.querySelectorAll('.ph-qty').forEach(i=>{
    const q=+i.value||0;
    if(q>0){
      const med=stock.find(m=>m.id===i.dataset.id);
      const px=sf==='CMU'?(med?.cmu_eligible?pxCMU(med):pxNA(med)):sf==='NA'?pxNA(med):(+med?.px_cession||0);
      tot+=q*px;
    }
  });
  const cnam=sf==='FPM'?tot:sf==='CMU'?Math.round(tot*0.7):0;
  const encaisse=sf==='FPM'?0:tot;
  document.getElementById('ph-tot-lbl').textContent=fmt(tot)+' FCFA';
  document.getElementById('ph-cnam-lbl').textContent=sf==='FPM'?fmt(tot)+' F (couvert)':sf==='CMU'?fmt(cnam)+' F':'—';
}
function savePharmaVente(){
  const nom=document.getElementById('ph-nom').value.trim();
  const s=document.getElementById('ph-statut').value;
  const pid=document.getElementById('ph-pid')?.value||'';
  const sf=getEffectiveBillingStatut(pid,s);
  const origine=document.getElementById('ph-origine').value;
  const motifDirect=(document.getElementById('ph-direct-motif')?.value||'').trim();
  if(!nom){alert('Saisissez le nom du patient');return;}
  if(origine==='DIRECTE'&&!motifDirect){alert('Motif obligatoire pour une entrée directe pharmacie');return;}
  const stock=DB.getStock();
  const lots=DB.getLots();
  const requested=[...document.querySelectorAll('.ph-qty')]
    .map(i=>({input:i,q:+i.value||0,stock:stock.find(m=>m.id===i.dataset.id)}))
    .filter(x=>x.q>0);
  const insufficient=requested.find(x=>!x.stock||x.q>x.stock.stock);
  if(insufficient){
    alert(`Stock insuffisant pour ${insufficient.input.dataset.nom}. Disponible: ${insufficient.stock?.stock||0}.`);
    return;
  }
  requested.forEach(x=>ensureLotCoverage(x.stock,lots));
  const insufficientLots=requested.find(x=>{
    const usable=lots.filter(l=>l.med_id===x.stock.id&&(+l.quantite||0)>0&&(!l.date_peremption||l.date_peremption>=today()))
      .reduce((sum,l)=>sum+(+l.quantite||0),0);
    return usable<x.q;
  });
  if(insufficientLots){
    alert(`Aucun lot valide suffisant pour ${insufficientLots.input.dataset.nom}. Vérifiez les péremptions.`);
    return;
  }
  let items=[],tot=0;
  document.querySelectorAll('.ph-qty').forEach(i=>{
    const q=+i.value||0;
    if(q>0){
      const idx=stock.findIndex(m=>m.id===i.dataset.id);
      if(idx>=0){
        const px=sf==='CMU'?(stock[idx].cmu_eligible?pxCMU(stock[idx]):pxNA(stock[idx])):sf==='NA'?pxNA(stock[idx]):(+stock[idx].px_cession||0);
        const allocations=consumeLots(stock[idx],lots,q);
        const montant=Math.round(q*px); // encaissement entier (le prix unitaire peut être décimal)
        items.push({id:i.dataset.id,nom:i.dataset.nom,qte:q,pu:px,montant,lots:allocations});
        tot+=montant;
        stock[idx].stock=Math.max(0,stock[idx].stock-q);
      }
    }
  });
  if(!items.length){alert('Sélectionnez au moins un médicament');return;}
  DB.setLots(lots);
  DB.setStock(stock);
  const cnam=sf==='FPM'?tot:sf==='CMU'?Math.round(tot*0.7):0;
  const encaisse=sf==='FPM'?0:tot;
  const tm=sf==='CMU'?Math.round(tot*0.3):sf==='NA'?tot:0;
  const v=DB.push('pharma_ventes',{patient_id:pid||'',patient_nom:nom,statut:s,statut_facturation:sf,ordonnance:document.getElementById('ph-ord').value,items,total:tot,cnam,tm,date:today(),origine,motif_entree_directe:origine==='DIRECTE'?motifDirect:''});
  items.forEach(item=>{
    const med=stock.find(m=>m.id===item.id);
    (item.lots||[]).forEach(allocation=>recordStockMovement({
      type:'SORTIE_DELIVRANCE',
      med_id:item.id,
      medicament:item.nom,
      quantite:-allocation.quantite,
      stock_avant:(+med.stock||0)+item.qte,
      stock_apres:+med.stock||0,
      lot_id:allocation.lot_id,
      numero_lot:allocation.numero_lot,
      date_peremption:allocation.date_peremption,
      motif:`Délivrance à ${nom}`,
      reference:v.id
    }));
  });
  DB.push('transactions',{patient_nom:nom,statut:sf,service:'PHARMACIE',
    designation:'Pharmacie: '+items.map(i=>i.nom).join(', '),montant:tot,cnam,encaisse,date:today()});
  logAudit('PHARMACIE_VENTE',{patient_nom:nom,statut:s,statut_facturation:sf,total:tot,origine,motif_entree_directe:origine==='DIRECTE'?motifDirect:''});
  const now=new Date();
  document.getElementById('ph-recu-zone').innerHTML=`
    <div class="card" id="ph-recu-${v.id}">
      <div class="card-title">Reçu pharmacie — Imprimable</div>
      <div class="recu">
        <div class="recu-title">PHARMACIE — CSA PLATEAU</div>
        <div style="text-align:center;font-size:10px">${now.toLocaleString('fr-FR')} | ${escHtml(CURRENT_AGENT.nom)}</div>
        <div style="text-align:center;font-weight:700;margin:4px 0">${escHtml(nom)} — ${escHtml(s)} / Facturation ${escHtml(sf)}</div>
        <hr style="margin:4px 0">
        ${items.map(i=>`<div class="recu-line"><span>${escHtml(i.nom)} ×${fmt(i.qte)}</span><span>${fmt(i.montant)} F</span></div>`).join('')}
        <div class="recu-tot"><span>${sf==='FPM'?'TOTAL (FPM)':'TOTAL'}</span><span>${fmt(tot)} FCFA</span></div>
        ${sf==='FPM'?'<div style="font-size:10px;color:var(--fpm);margin-top:4px;text-align:center">100% couvert — Aucun paiement patient</div>':''}
        ${sf==='CMU'?`<div style="font-size:10px;color:#666;margin-top:4px">CNAM (70%): ${fmt(cnam)} F | TM patient (30%): ${fmt(tm)} F</div>`:''}
        ${sf==='NA'?`<div style="font-size:10px;margin-top:4px">Prix non-assuré — Tarif plein / Chef</div>`:''}
      </div>
      <div class="btn-row no-print">
        <button class="btn btn-print btn-sm" onclick="printSection('ph-recu-${v.id}')">Imprimer reçu</button>
      </div>
    </div>`;
  document.getElementById('ph-nom').value='';
  document.getElementById('ph-pid').value='';
  document.getElementById('ph-search').value='';
  document.getElementById('ph-results').innerHTML='';
  document.getElementById('ph-ord').value='';
  document.getElementById('ph-origine').value='ORIENTATION';
  document.getElementById('ph-direct-motif').value='';
  togglePhDirectReason();
  document.querySelectorAll('.ph-qty').forEach(i=>i.value=0);
  updatePhaTotal();
}

// ── PHARMACIE — Stock ───────────────────────────────────
VIEW['pha-stock'] = (el) => {
  const stock=DB.getStock();
  const lots=DB.getLots();
  const alertes=stock.filter(isOperationalStockAlert);
  const toInventory=stock.filter(m=>m.catalogue_status==='A_INVENTORIER'&&(+m.stock||0)===0);
  const toPrice=stock.filter(m=>(+m.px_cession||0)<=0);
  const cats=[...new Set(stock.map(m=>m.categorie))];
  const catFilter=localStorage.getItem('pha-cat-filter')||'Tous';
  const search=(localStorage.getItem('pha-stock-search')||'').trim().toLowerCase();
  const formFilter=localStorage.getItem('pha-form-filter')||'Toutes';
  const packFilter=localStorage.getItem('pha-pack-filter')||'Tous';
  const cmuFilter=localStorage.getItem('pha-cmu-filter')||'Tous';
  const forms=[...new Set(stock.map(pharmaForm).filter(Boolean))].sort();
  const packs=[...new Set(stock.map(m=>canonicalPharmaPack(m.conditionnement||m.unite)).filter(Boolean))].sort();
  const displayed=stock.filter(m=>{
    if(catFilter!=='Tous'&&m.categorie!==catFilter) return false;
    if(formFilter!=='Toutes'&&pharmaForm(m)!==formFilter) return false;
    if(packFilter!=='Tous'&&canonicalPharmaPack(m.conditionnement||m.unite)!==packFilter) return false;
    if(cmuFilter==='CMU'&&!m.cmu_eligible) return false;
    if(cmuFilter==='HORS_CMU'&&m.cmu_eligible) return false;
    return !search||[
      m.code_produit,m.code_ean,m.code_atc,m.nom,m.dci,m.noms_commerciaux,m.dosage,
      m.forme,m.conditionnement,m.categorie
    ].some(value=>String(value||'').toLowerCase().includes(search));
  });
  el.innerHTML=`
  <div class="g2 no-print" style="margin-bottom:12px">
    <div class="kpi" style="border-left-color:var(--vert)"><div class="kpi-ico">📦</div><div class="kpi-lbl">Références</div><div class="kpi-val" style="color:var(--vert)">${stock.length}</div></div>
    <div class="kpi" style="border-left-color:${alertes.length?'var(--rouge)':'var(--vert)'}"><div class="kpi-ico">⚠️</div><div class="kpi-lbl">Alertes stock</div><div class="kpi-val" style="color:${alertes.length?'var(--rouge)':'var(--vert)'}">${alertes.length}</div></div>
  </div>
  ${(toInventory.length||toPrice.length)?`<div class="al al-info no-print"><strong>Initialisation du catalogue réel</strong>${toInventory.length} référence(s) restent à inventorier et ${toPrice.length} tarif(s) de cession restent à valider par le Médecin-Chef. Les anciennes quantités de démonstration ne sont pas utilisées.</div>`:''}
  ${alertes.length?`<div class="al al-err no-print"><strong>⚠️ ${alertes.length} article(s) en alerte de stock :</strong> ${alertes.map(m=>`${escHtml(m.nom)} (${m.stock} restants, seuil ${m.seuil})`).join(' | ')}</div>`:''}
  <div class="card">
    <div class="card-title">Catalogue et état des stocks — Pharmacie</div>
    <div class="fr no-print" style="margin-bottom:10px">
      <input type="text" value="${escHtml(localStorage.getItem('pha-stock-search')||'')}" placeholder="Code, EAN, médicament, DCI, dosage..."
        onchange="localStorage.setItem('pha-stock-search',this.value);showView('pha-stock')" style="flex:1;min-width:220px">
      <label>Forme</label><select onchange="localStorage.setItem('pha-form-filter',this.value);showView('pha-stock')">
        <option>Toutes</option>${forms.map(value=>`<option ${formFilter===value?'selected':''}>${escHtml(value)}</option>`).join('')}
      </select>
      <label>Conditionnement</label><select onchange="localStorage.setItem('pha-pack-filter',this.value);showView('pha-stock')">
        <option>Tous</option>${packs.map(value=>`<option ${packFilter===value?'selected':''}>${escHtml(value)}</option>`).join('')}
      </select>
      <label>CMU</label><select onchange="localStorage.setItem('pha-cmu-filter',this.value);showView('pha-stock')">
        <option value="Tous">Tous</option><option value="CMU" ${cmuFilter==='CMU'?'selected':''}>Produits CMU</option>
        <option value="HORS_CMU" ${cmuFilter==='HORS_CMU'?'selected':''}>Hors CMU</option>
      </select>
    </div>
    <div class="fr no-print" style="margin-bottom:10px">
      <label>Catégorie</label>
      <select onchange="localStorage.setItem('pha-cat-filter',this.value);showView('pha-stock')">
        <option ${catFilter==='Tous'?'selected':''}>Tous</option>
        ${cats.map(c=>`<option ${catFilter===c?'selected':''}>${c}</option>`).join('')}
      </select>
      <label style="margin-left:12px">Entrée de lot :</label>
      <select id="sk-add-med" style="flex:1">${stock.map(m=>`<option value="${m.id}">${escHtml(m.nom)}</option>`).join('')}</select>
      <input type="number" id="sk-add-qty" placeholder="Qté" style="width:70px" min="1">
      <input type="text" id="sk-add-lot" placeholder="N° lot" style="width:110px">
      <input type="date" id="sk-add-exp" title="Date de péremption">
      <input type="text" id="sk-add-fournisseur" placeholder="Fournisseur" style="width:130px">
      <button class="btn btn-success btn-sm" onclick="addStockEntry()">+ Entrée</button>
      <button class="btn btn-out btn-sm" onclick="['pha-stock-search','pha-form-filter','pha-pack-filter','pha-cmu-filter','pha-cat-filter'].forEach(k=>localStorage.removeItem(k));showView('pha-stock')">Réinitialiser</button>
    </div>
    <div id="stock-table-wrap" class="tw">
    <table>
      <tr><th>N°</th><th>Code interne</th><th>Code EAN</th><th>Nom commercial / produit</th><th>DCI</th><th>Dosage</th><th>Forme galénique</th><th>Conditionnement</th><th>CMU</th><th>Vente CMU</th><th>Vente hors CMU</th><th>Qté théorique de référence</th><th>Stock disponible</th><th>État</th></tr>
      ${displayed.map((m,index)=>{
        const pending=m.catalogue_status==='A_INVENTORIER';
        const pct=Math.min(100,m.seuil>0?Math.round(m.stock/m.seuil*50):100);
        const col=pending?'#7F3F00':isOperationalStockAlert(m)?'#E24B4A':m.stock<=m.seuil*2?'#EF9F27':'#639922';
        const etat=pending?'b-warn':isOperationalStockAlert(m)?'b-err':m.stock<=m.seuil*2?'b-warn':'b-ok';
        const etatLbl=pending?'À INVENTORIER':isOperationalStockAlert(m)?'CRITIQUE':m.stock<=m.seuil*2?'FAIBLE':'OK';
        return `<tr>
          <td>${index+1}</td><td style="font-weight:700">${escHtml(m.code_produit||m.source_product_id||'—')}</td>
          <td style="font-family:monospace">${escHtml(m.code_ean||'—')}</td>
          <td style="font-weight:700;min-width:210px">${escHtml(m.nom||'—')}<div style="font-size:9px;color:var(--muted)">${escHtml(m.noms_commerciaux||'')}</div></td>
          <td>${escHtml(m.dci||'—')}</td><td>${escHtml(m.dosage||'Non renseigné')}</td><td>${escHtml(pharmaForm(m))}</td>
          <td>${escHtml(canonicalPharmaPack(m.conditionnement||m.unite))}</td>
          <td><span class="badge ${m.cmu_eligible?'b-cmu':'b-na'}">${m.cmu_eligible?'OUI':'NON'}</span></td>
          <td>${m.cmu_eligible?fmt(pxCMU(m))+' F':'—'}</td>
          <td>${fmt(pxNA(m))} F</td>
          <td title="Sorties historiques documentées, pas le stock physique actuel">${fmt(+m.quantite_theorique||+m.historique_quantite||0)}</td>
          <td style="font-weight:700;color:${col}">${fmt(+m.stock||0)} ${escHtml(canonicalPharmaPack(m.conditionnement||m.unite))}</td>
          <td><span class="badge ${etat}">${etatLbl}</span></td>
        </tr>`;
      }).join('')}
    </table>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Lots et péremptions</div>
    <div class="tw"><table>
      <tr><th>Médicament</th><th>N° lot</th><th>Péremption</th><th>État</th><th>Quantité</th><th>Fournisseur</th><th>Entrée par</th></tr>
      ${lots.slice().sort((a,b)=>(a.date_peremption||'9999').localeCompare(b.date_peremption||'9999')).map(l=>{
        const state=lotExpiryState(l);
        return `<tr><td style="font-weight:700">${escHtml(l.medicament||'—')}</td><td>${escHtml(l.numero_lot||'—')}</td>
          <td>${l.date_peremption?fmtD(l.date_peremption):'—'}</td><td><span class="badge ${state.cls}">${state.label}</span></td>
          <td style="font-weight:700">${fmt(+l.quantite||0)}</td><td>${escHtml(l.fournisseur||'—')}</td><td style="font-size:10px">${escHtml(l.agent_nom||'—')}</td></tr>`;
      }).join('')||'<tr><td colspan="7" style="text-align:center;color:#aaa">Aucun lot enregistré</td></tr>'}
    </table></div>
  </div>`;
};

// ── PHARMACIE — Paramétrage technique du catalogue ─────
VIEW['pha-catalogue'] = (el) => {
  const stock=DB.getStock();
  const query=(localStorage.getItem('pha-catalogue-search')||'').trim().toLowerCase();
  const displayed=stock.filter(m=>!query||[
    m.code_produit,m.code_ean,m.nom,m.dci,m.dosage,m.forme,m.conditionnement
  ].some(value=>String(value||'').toLowerCase().includes(query)));
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Référentiel technique du catalogue</div>
    <div class="fr no-print" style="margin-bottom:10px">
      <input type="text" value="${escHtml(localStorage.getItem('pha-catalogue-search')||'')}"
        placeholder="Rechercher code, EAN, produit, dosage..."
        onchange="localStorage.setItem('pha-catalogue-search',this.value);showView('pha-catalogue')"
        style="flex:1;min-width:260px">
      <button class="btn btn-out btn-sm" onclick="localStorage.removeItem('pha-catalogue-search');showView('pha-catalogue')">Réinitialiser</button>
    </div>
    <div class="tw"><table>
      <tr><th>Code interne</th><th>Produit</th><th>EAN</th><th>Dosage</th><th>Forme</th><th>Conditionnement</th><th>Action</th></tr>
      ${displayed.map(m=>`<tr>
        <td><input type="text" id="pha-code-${m.id}" value="${escHtml(m.code_produit||m.source_product_id||'')}" style="width:110px"></td>
        <td><input type="text" id="pha-nom-${m.id}" value="${escHtml(m.nom||'')}" style="min-width:190px;width:100%"></td>
        <td><input type="text" id="pha-ean-${m.id}" value="${escHtml(m.code_ean||'')}" inputmode="numeric" maxlength="14"
          placeholder="8, 12, 13 ou 14 chiffres" style="width:125px" oninput="this.value=normalizeEan(this.value)"></td>
        <td><input type="text" id="pha-dosage-${m.id}" value="${escHtml(m.dosage||'')}" placeholder="Ex. 500 mg" style="width:105px"></td>
        <td><select id="pha-forme-${m.id}" style="width:155px">${[pharmaForm(m),...PHARMA_FORMS].filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option ${pharmaForm(m)===v?'selected':''}>${escHtml(v)}</option>`).join('')}</select></td>
        <td><select id="pha-pack-${m.id}" style="width:145px">${[canonicalPharmaPack(m.conditionnement||m.unite),...PHARMA_PACKS].filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option ${canonicalPharmaPack(m.conditionnement||m.unite)===v?'selected':''}>${escHtml(v)}</option>`).join('')}</select></td>
        <td><button class="btn btn-success btn-sm" onclick="savePharmaCatalogueItem('${m.id}')">Sauver</button></td>
      </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--muted)">Aucun produit trouvé</td></tr>'}
    </table></div>
    ${!query?`<div class="btn-row"><button class="btn btn-warn" onclick="saveAllPharmaCatalogue()">Sauvegarder tout le catalogue</button></div>`:''}
  </div>`;
};
function readPharmaCatalogueItem(id){
  return {
    code_produit:document.getElementById('pha-code-'+id)?.value.trim()||'',
    nom:document.getElementById('pha-nom-'+id)?.value.trim()||'',
    code_ean:normalizeEan(document.getElementById('pha-ean-'+id)?.value),
    dosage:document.getElementById('pha-dosage-'+id)?.value.trim()||'',
    forme:canonicalPharmaForm(document.getElementById('pha-forme-'+id)?.value),
    conditionnement:canonicalPharmaPack(document.getElementById('pha-pack-'+id)?.value)
  };
}
function validatePharmaCatalogueItem(item,stock,currentId){
  if(!item.code_produit)return 'Le code interne est obligatoire.';
  if(!item.nom)return 'Le nom du produit est obligatoire.';
  if(!isValidEan(item.code_ean))return 'Le code EAN est invalide.';
  if(stock.some(m=>m.id!==currentId&&catalogueKey(m.code_produit)===catalogueKey(item.code_produit)))
    return 'Ce code interne est déjà affecté à un autre produit.';
  if(item.code_ean&&stock.some(m=>m.id!==currentId&&normalizeEan(m.code_ean)===item.code_ean))
    return 'Ce code EAN est déjà affecté à un autre produit.';
  return '';
}
function savePharmaCatalogueItem(id){
  const stock=DB.getStock();
  const idx=stock.findIndex(m=>m.id===id);
  if(idx<0)return;
  const item=readPharmaCatalogueItem(id);
  const error=validatePharmaCatalogueItem(item,stock,id);
  if(error){alert(error);return;}
  const before={
    code_produit:stock[idx].code_produit,nom:stock[idx].nom,code_ean:stock[idx].code_ean,
    dosage:stock[idx].dosage,forme:stock[idx].forme,conditionnement:stock[idx].conditionnement
  };
  Object.assign(stock[idx],item,{unite:item.conditionnement});
  DB.setStock(stock);
  logAudit('CATALOGUE_TECHNIQUE_UPDATE',{med_id:id,medicament:item.nom,before,after:item});
  alert('Produit mis à jour.');
  showView('pha-catalogue');
}
function saveAllPharmaCatalogue(){
  const stock=DB.getStock();
  const items=stock.map(m=>({id:m.id,item:readPharmaCatalogueItem(m.id)}));
  const codes=new Set(),eans=new Set();
  for(const {item} of items){
    if(!item.code_produit||!item.nom){alert('Chaque produit doit avoir un code interne et un nom.');return;}
    if(!isValidEan(item.code_ean)){alert(`EAN invalide pour ${item.nom}.`);return;}
    const codeKey=catalogueKey(item.code_produit);
    if(codes.has(codeKey)){alert(`Code interne dupliqué : ${item.code_produit}.`);return;}
    codes.add(codeKey);
    if(item.code_ean&&eans.has(item.code_ean)){alert(`EAN dupliqué : ${item.code_ean}.`);return;}
    if(item.code_ean)eans.add(item.code_ean);
  }
  items.forEach(({id,item})=>{
    const med=stock.find(m=>m.id===id);
    Object.assign(med,item,{unite:item.conditionnement});
  });
  DB.setStock(stock);
  logAudit('CATALOGUE_TECHNIQUE_UPDATE_BULK',{items:stock.length});
  alert('Catalogue technique sauvegardé.');
  showView('pha-catalogue');
}
function addStockEntry(){
  const medId=document.getElementById('sk-add-med').value;
  const qty=+document.getElementById('sk-add-qty').value||0;
  const numeroLot=document.getElementById('sk-add-lot').value.trim();
  const datePeremption=document.getElementById('sk-add-exp').value;
  const fournisseur=document.getElementById('sk-add-fournisseur').value.trim();
  if(!medId||qty<=0||!numeroLot||!datePeremption){alert('Médicament, quantité, numéro de lot et péremption sont obligatoires.');return;}
  if(datePeremption<today()){alert('Impossible d’enregistrer un lot déjà périmé.');return;}
  const stock=DB.getStock();
  const idx=stock.findIndex(m=>m.id===medId);
  if(idx>=0){
    const before=stock[idx].stock;
    stock[idx].stock+=qty;
    stock[idx].catalogue_status='OPERATIONNEL';
    const lots=DB.getLots();
    const lotId='LOT-'+medId+'-'+numeroLot.toUpperCase().replace(/[^A-Z0-9]/g,'');
    const existing=lots.find(l=>l.id===lotId);
    if(existing){
      existing.quantite=(+existing.quantite||0)+qty;
      existing.quantite_initiale=(+existing.quantite_initiale||0)+qty;
      existing.date_peremption=datePeremption;
      existing.fournisseur=fournisseur||existing.fournisseur||'';
    }else{
      lots.unshift({id:lotId,med_id:medId,medicament:stock[idx].nom,numero_lot:numeroLot,date_peremption:datePeremption,
        fournisseur,quantite:qty,quantite_initiale:qty,created_at:new Date().toISOString()});
    }
    DB.setLots(lots);
    DB.setStock(stock);
    recordStockMovement({type:'ENTREE_LOT',med_id:stock[idx].id,medicament:stock[idx].nom,quantite:qty,
      stock_avant:before,stock_apres:stock[idx].stock,lot_id:lotId,numero_lot:numeroLot,date_peremption:datePeremption,
      motif:fournisseur?`Réception fournisseur : ${fournisseur}`:'Réception de stock',reference:lotId});
    logAudit('STOCK_ENTRY',{medicament:stock[idx].nom,med_id:stock[idx].id,before,added:qty,after:stock[idx].stock,numero_lot:numeroLot,date_peremption:datePeremption});
    alert(`${stock[idx].nom} : +${qty} → ${stock[idx].stock} en stock`);
  }
  else alert('Médicament non trouvé.');
  showView('pha-stock');
}

// ── PHARMACIE — Mouvements de stock ────────────────────
VIEW['pha-mouvements'] = (el) => {
  const dateFilter=localStorage.getItem('pha-mvt-date')||today();
  const rows=DB.get('pharma_mouvements').filter(m=>!dateFilter||(m.created_at||m.date||'').startsWith(dateFilter));
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Journal inaltérable des mouvements</div>
    <div class="fr no-print"><label>Date</label><input type="date" value="${escHtml(dateFilter)}"
      onchange="localStorage.setItem('pha-mvt-date',this.value);showView('pha-mouvements')">
      <button class="btn btn-out btn-sm" onclick="localStorage.removeItem('pha-mvt-date');showView('pha-mouvements')">Tout afficher</button></div>
    <div class="tw"><table>
      <tr><th>Date/heure</th><th>Type</th><th>Médicament</th><th>Lot</th><th>Péremption</th><th>Mouvement</th><th>Avant</th><th>Après</th><th>Motif/référence</th><th>Agent</th></tr>
      ${rows.map(m=>`<tr><td style="white-space:nowrap">${fmtD(m.created_at)} ${fmtT(m.created_at)}</td>
        <td><span class="badge ${(+m.quantite||0)>=0?'b-ok':'b-warn'}">${escHtml(m.type||'—')}</span></td>
        <td style="font-weight:700">${escHtml(m.medicament||'—')}</td><td>${escHtml(m.numero_lot||'—')}</td>
        <td>${m.date_peremption?fmtD(m.date_peremption):'—'}</td>
        <td style="font-weight:700;color:${(+m.quantite||0)>=0?'var(--vert)':'var(--rouge)'}">${(+m.quantite||0)>0?'+':''}${fmt(+m.quantite||0)}</td>
        <td>${fmt(+m.stock_avant||0)}</td><td>${fmt(+m.stock_apres||0)}</td>
        <td style="font-size:10px">${escHtml(m.motif||'—')}<div style="color:var(--muted)">${escHtml(m.reference||'')}</div></td>
        <td style="font-size:10px">${escHtml(m.agent_nom||'—')}</td></tr>`).join('')||'<tr><td colspan="10" style="text-align:center;color:#aaa">Aucun mouvement</td></tr>'}
    </table></div>
  </div>`;
};

// ── PHARMACIE — Inventaire physique ────────────────────
VIEW['pha-inventaire'] = (el) => {
  const stock=DB.getStock();
  const inventaires=DB.get('pharma_inventaires');
  el.innerHTML=`
  <div class="al al-info"><strong>Principe de contrôle</strong>Le stock théorique n’est pas modifié lors de la saisie. Tout inventaire est transmis au Médecin-Chef, qui approuve ou rejette les écarts.</div>
  <div class="card">
    <div class="card-title">Nouvel inventaire physique</div>
    <div class="fr"><label>Référence</label><input id="inv-reference" value="INV-${today()}" style="max-width:180px">
      <label>Observation générale</label><input id="inv-observation" placeholder="Contexte, équipe, emplacement..." style="flex:1"></div>
    <div class="tw"><table>
      <tr><th>Médicament</th><th>Sorties historiques<br><small>(non stock)</small></th><th>Théorique système</th><th>Compté</th><th>Justification si écart</th></tr>
      ${stock.map(m=>`<tr><td style="font-weight:700">${escHtml(m.nom)}</td>
        <td title="Quantités sorties sur la période historique">${fmt(+m.quantite_theorique||+m.historique_quantite||0)} ${escHtml(canonicalPharmaPack(m.conditionnement||m.unite))}</td>
        <td>${fmt(+m.stock||0)} ${escHtml(canonicalPharmaPack(m.conditionnement||m.unite))}</td>
        <td><input type="number" class="inv-physique" data-id="${m.id}" data-theorique="${+m.stock||0}" min="0" value="${+m.stock||0}" style="width:85px"></td>
        <td><input type="text" class="inv-motif" data-id="${m.id}" placeholder="Perte, casse, erreur de saisie..." style="width:100%"></td></tr>`).join('')}
    </table></div>
    <div class="fs no-print" style="margin-top:12px">
      <div class="fs-title">Produits trouvés pendant l'inventaire mais absents du catalogue</div>
      <div id="inv-new-products"></div>
      <button class="btn btn-out btn-sm" type="button" onclick="addInventoryProductRow()">+ Ajouter un nouveau produit</button>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">Ces produits et leurs quantités ne seront créés qu'après validation du Médecin-Chef.</div>
    </div>
    <div class="btn-row"><button class="btn btn-primary" onclick="submitPharmaInventory()">Transmettre au Médecin-Chef</button></div>
  </div>
  <div class="card">
    <div class="card-title">Inventaires transmis</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Référence</th><th>Écarts</th><th>Statut</th><th>Décision chef</th><th>Agent</th></tr>
      ${inventaires.map(inv=>{
        const ecarts=(inv.lignes||[]).filter(l=>(+l.ecart||0)!==0);
        return `<tr><td>${fmtD(inv.created_at)}</td><td style="font-weight:700">${escHtml(inv.reference||'—')}</td>
          <td>${ecarts.length}${ecarts.length?`<div style="font-size:9px">${ecarts.slice(0,4).map(l=>`${escHtml(l.medicament)}: ${l.ecart>0?'+':''}${fmt(l.ecart)}`).join(' | ')}</div>`:''}</td>
          <td><span class="badge ${inv.statut==='APPROUVE'?'b-ok':inv.statut==='REJETE'?'b-err':'b-warn'}">${escHtml(inv.statut||'EN_ATTENTE_CHEF')}</span></td>
          <td style="font-size:10px">${escHtml(inv.decision_motif||'—')}</td><td style="font-size:10px">${escHtml(inv.agent_nom||'—')}</td></tr>`;
      }).join('')||'<tr><td colspan="6" style="text-align:center;color:#aaa">Aucun inventaire</td></tr>'}
    </table></div>
  </div>`;
};
function addInventoryProductRow(){
  const host=document.getElementById('inv-new-products');
  if(!host)return;
  const rowId='NEW-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  const row=document.createElement('div');
  row.className='inv-new-row fr';
  row.dataset.id=rowId;
  row.style.cssText='padding:7px;border:1px solid var(--border);border-radius:7px;margin-bottom:7px;align-items:flex-end';
  row.innerHTML=`
    <div><label>Code interne *</label><input class="inv-new-code" placeholder="PRD-NOUVEAU" style="width:115px"></div>
    <div style="flex:1"><label>Produit *</label><input class="inv-new-name" placeholder="Nom du produit" style="width:100%"></div>
    <div><label>EAN</label><input class="inv-new-ean" inputmode="numeric" maxlength="14" style="width:125px" oninput="this.value=normalizeEan(this.value)"></div>
    <div><label>Dosage</label><input class="inv-new-dosage" placeholder="500 mg" style="width:90px"></div>
    <div><label>Forme</label><select class="inv-new-form" style="width:145px">${PHARMA_FORMS.map(v=>`<option>${escHtml(v)}</option>`).join('')}</select></div>
    <div><label>Conditionnement</label><select class="inv-new-pack" style="width:135px">${PHARMA_PACKS.map(v=>`<option>${escHtml(v)}</option>`).join('')}</select></div>
    <div><label>Quantité *</label><input type="number" class="inv-new-qty" min="0" value="0" style="width:75px"></div>
    <button class="btn btn-danger btn-sm" type="button" onclick="this.closest('.inv-new-row').remove()">Retirer</button>`;
  host.appendChild(row);
}
function submitPharmaInventory(){
  const stock=DB.getStock();
  const lignes=stock.map(m=>{
    const input=document.querySelector(`.inv-physique[data-id="${m.id}"]`);
    const motif=document.querySelector(`.inv-motif[data-id="${m.id}"]`)?.value.trim()||'';
    const physique=+input?.value||0;
    return {med_id:m.id,medicament:m.nom,unite:canonicalPharmaPack(m.conditionnement||m.unite),theorique:+m.stock||0,physique,ecart:physique-(+m.stock||0),motif};
  });
  const newLines=[...document.querySelectorAll('.inv-new-row')].map(row=>({
    med_id:row.dataset.id,
    is_new:true,
    code_produit:row.querySelector('.inv-new-code').value.trim(),
    medicament:row.querySelector('.inv-new-name').value.trim(),
    code_ean:normalizeEan(row.querySelector('.inv-new-ean').value),
    dosage:row.querySelector('.inv-new-dosage').value.trim(),
    forme:canonicalPharmaForm(row.querySelector('.inv-new-form').value),
    conditionnement:canonicalPharmaPack(row.querySelector('.inv-new-pack').value),
    unite:canonicalPharmaPack(row.querySelector('.inv-new-pack').value),
    theorique:0,
    physique:+row.querySelector('.inv-new-qty').value||0,
    ecart:+row.querySelector('.inv-new-qty').value||0,
    motif:'Nouveau produit constaté pendant l’inventaire'
  }));
  const stockCodes=new Set(stock.map(m=>catalogueKey(m.code_produit)));
  const stockEans=new Set(stock.map(m=>normalizeEan(m.code_ean)).filter(Boolean));
  const newCodes=new Set(),newEans=new Set();
  for(const line of newLines){
    if(!line.code_produit||!line.medicament){alert('Code interne et nom obligatoires pour chaque nouveau produit.');return;}
    if(line.physique<=0){alert(`La quantité de ${line.medicament} doit être supérieure à zéro.`);return;}
    if(!isValidEan(line.code_ean)){alert(`EAN invalide pour ${line.medicament}.`);return;}
    const codeKey=catalogueKey(line.code_produit);
    if(stockCodes.has(codeKey)||newCodes.has(codeKey)){alert(`Code interne déjà utilisé : ${line.code_produit}.`);return;}
    newCodes.add(codeKey);
    if(line.code_ean&&(stockEans.has(line.code_ean)||newEans.has(line.code_ean))){alert(`EAN déjà utilisé : ${line.code_ean}.`);return;}
    if(line.code_ean)newEans.add(line.code_ean);
  }
  lignes.push(...newLines);
  const unjustified=lignes.find(l=>!l.is_new&&l.ecart!==0&&!l.motif);
  if(unjustified){alert(`Justification obligatoire pour l’écart de ${unjustified.medicament}.`);return;}
  const reference=document.getElementById('inv-reference').value.trim()||('INV-'+today());
  DB.push('pharma_inventaires',{reference,observation:document.getElementById('inv-observation').value.trim(),
    lignes,statut:'EN_ATTENTE_CHEF',date:today()});
  logAudit('PHARMACIE_INVENTAIRE_SOUMIS',{reference,ecarts:lignes.filter(l=>l.ecart!==0).length,nouveaux_produits:newLines.length});
  alert('Inventaire transmis au Médecin-Chef. Aucun stock n’a encore été modifié.');
  showView('pha-inventaire');
}

function pharmaHistoryData(){
  return DB.get('pharma_registre_historique').slice()
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
}
function updatePharmaHistoryFilter(prefix,key,value,view){
  localStorage.setItem(`${prefix}-${key}`,value);
  showView(view);
}
function resetPharmaHistoryFilters(prefix,view){
  ['from','to','search','financing','detail-open','detail-kind','detail-value'].forEach(key=>localStorage.removeItem(`${prefix}-${key}`));
  showView(view);
}
function showPharmaHistoryDetail(prefix,kind,value,view){
  localStorage.setItem(`${prefix}-detail-open`,'1');
  localStorage.setItem(`${prefix}-detail-kind`,kind||'all');
  localStorage.setItem(`${prefix}-detail-value`,value||'');
  showView(view);
}
function hidePharmaHistoryDetail(prefix,view){
  ['detail-open','detail-kind','detail-value'].forEach(key=>localStorage.removeItem(`${prefix}-${key}`));
  showView(view);
}
function renderPharmaHistory(prefix,view){
  const rows=pharmaHistoryData();
  const components=DB.get('pharma_composants_historiques');
  const catalogue=DB.get('pharma_catalogue_historique');
  const catalogueById=Object.fromEntries(catalogue.map(product=>[product.id,product]));
  const from=localStorage.getItem(`${prefix}-from`)||'';
  const to=localStorage.getItem(`${prefix}-to`)||'';
  const search=(localStorage.getItem(`${prefix}-search`)||'').trim().toLowerCase();
  const financing=localStorage.getItem(`${prefix}-financing`)||'TOUS';
  const filtered=rows.filter(row=>{
    const date=String(row.date||'');
    if(from&&date<from) return false;
    if(to&&date>to) return false;
    if(financing!=='TOUS'&&String(row.financing||'')!==financing) return false;
    if(search&&![
      row.original_label,row.normalized_source_label,row.canonical_name,row.product_id,
      row.record_type,row.source_observation
    ].some(value=>String(value||'').toLowerCase().includes(search))) return false;
    return true;
  });
  const total=filtered.reduce((sum,row)=>sum+(+row.amount||0),0);
  const quantity=filtered.reduce((sum,row)=>sum+(+row.quantity||0),0);
  const kitRows=filtered.filter(row=>row.record_type==='KIT_FINANCIER');
  const financingValues=[...new Set(rows.map(row=>row.financing).filter(Boolean))].sort();
  const byProduct={};
  const productRows=filtered.filter(row=>{
    const product=catalogueById[row.product_id];
    return row.record_type!=='KIT_FINANCIER'&&(!product||product.product_type==='Médicament');
  });
  productRows.forEach(row=>{
    const key=row.product_id||row.canonical_name||row.normalized_source_label||'Non rapproché';
    if(!byProduct[key]) byProduct[key]={key,name:row.canonical_name||row.normalized_source_label||key,quantity:0,amount:0,lines:0};
    byProduct[key].quantity+=+row.quantity||0;
    byProduct[key].amount+=+row.amount||0;
    byProduct[key].lines++;
  });
  const topProducts=Object.values(byProduct).sort((a,b)=>b.quantity-a.quantity||b.amount-a.amount).slice(0,10);
  const monthKeys=[...new Set(filtered.map(row=>String(row.date||'').slice(0,7)).filter(month=>month.length===7))].sort();
  const monthLabels=monthKeys.map(month=>{
    const [year,number]=month.split('-');
    return new Date(+year,+number-1,1).toLocaleDateString('fr-FR',{month:'short',year:'2-digit'});
  });
  const byMonth=Object.fromEntries(monthKeys.map(month=>[month,{amount:0,quantity:0,lines:0}]));
  filtered.forEach(row=>{
    const month=String(row.date||'').slice(0,7);
    if(!byMonth[month]) return;
    byMonth[month].amount+=+row.amount||0;
    byMonth[month].quantity+=+row.quantity||0;
    byMonth[month].lines++;
  });
  const byClass={};
  productRows.forEach(row=>{
    const therapeuticClass=catalogueById[row.product_id]?.therapeutic_class||'Classe non renseignée';
    if(!byClass[therapeuticClass]) byClass[therapeuticClass]={name:therapeuticClass,quantity:0,amount:0,months:{}};
    const item=byClass[therapeuticClass];
    const month=String(row.date||'').slice(0,7);
    item.quantity+=+row.quantity||0;
    item.amount+=+row.amount||0;
    item.months[month]=(item.months[month]||0)+(+row.quantity||0);
  });
  const topClasses=Object.values(byClass).sort((a,b)=>b.quantity-a.quantity).slice(0,6);
  const detailOpen=localStorage.getItem(`${prefix}-detail-open`)==='1';
  const detailKind=localStorage.getItem(`${prefix}-detail-kind`)||'all';
  const detailValue=localStorage.getItem(`${prefix}-detail-value`)||'';
  const detailRows=filtered.filter(row=>{
    if(detailKind==='product') return (row.product_id||row.canonical_name||row.normalized_source_label||'Non rapproché')===detailValue;
    if(detailKind==='class') return (catalogueById[row.product_id]?.therapeutic_class||'Classe non renseignée')===detailValue;
    if(detailKind==='month') return String(row.date||'').slice(0,7)===detailValue;
    return true;
  });
  const detailTitle=detailKind==='product'?`Produit : ${byProduct[detailValue]?.name||detailValue}`
    :detailKind==='class'?`Classe thérapeutique : ${detailValue}`
    :detailKind==='month'?`Mois : ${monthLabels[monthKeys.indexOf(detailValue)]||detailValue}`
    :'Toutes les lignes filtrées';
  setTimeout(()=>{
    if(topProducts.length) mkChart(`${prefix}-products`,'bar',topProducts.map(row=>row.name),[
      {label:'Quantité sortie',data:topProducts.map(row=>row.quantity),backgroundColor:'rgba(13,43,69,.82)',borderRadius:4}
    ],{
      indexAxis:'y',
      onClick:(_,elements)=>{
        if(elements.length) showPharmaHistoryDetail(prefix,'product',topProducts[elements[0].index].key,view);
      },
      plugins:{legend:{display:false},tooltip:{callbacks:{afterLabel:context=>`${fmt(topProducts[context.dataIndex].amount)} F documentés`}}},
      scales:{x:{beginAtZero:true,ticks:{font:{size:9}},grid:{color:'#f0f0f0'}},y:{ticks:{font:{size:9}}}}
    });
    if(monthKeys.length&&topClasses.length) mkChart(`${prefix}-classes`,'line',monthLabels,
      topClasses.map((item,index)=>({
        label:item.name,data:monthKeys.map(month=>item.months[month]||0),
        borderColor:['#0D2B45','#1A6B3C','#B8860B','#7F3F00','#285F8F','#7A2E55'][index],
        backgroundColor:'transparent',tension:.35,pointRadius:3,borderWidth:2
      })),{
        onClick:(_,elements)=>{
          if(elements.length) showPharmaHistoryDetail(prefix,'class',topClasses[elements[0].datasetIndex].name,view);
        },
        scales:{y:{beginAtZero:true,ticks:{font:{size:9}},grid:{color:'#f0f0f0'}},x:{ticks:{font:{size:9}}}}
      });
    if(monthKeys.length) mkChart(`${prefix}-finance`,'line',monthLabels,[
      {label:'Montant documenté',data:monthKeys.map(month=>byMonth[month].amount),borderColor:'#B8860B',backgroundColor:'rgba(184,134,11,.12)',fill:true,tension:.35,pointRadius:4,borderWidth:2}
    ],{
      onClick:(_,elements)=>{
        if(elements.length) showPharmaHistoryDetail(prefix,'month',monthKeys[elements[0].index],view);
      },
      plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:10}},tooltip:{callbacks:{label:context=>`${fmt(context.raw)} F`}}},
      scales:{y:{beginAtZero:true,ticks:{callback:value=>fmt(value/1000)+'k F',font:{size:9}},grid:{color:'#f0f0f0'}},x:{ticks:{font:{size:9}}}}
    });
  },100);
  return `
  <div class="al al-info"><strong>Historique documentaire, février à juin 2026</strong>Ces données servent à l'analyse des sorties passées. Elles ne modifient ni le stock courant, ni les lots, ni les ventes, ni les dossiers patients.</div>
  <div class="g4" style="margin-bottom:12px">
    <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-ico">📚</div><div class="kpi-lbl">Lignes filtrées</div><div class="kpi-val">${filtered.length}</div></div>
    <div class="kpi" style="border-left-color:var(--orang)"><div class="kpi-ico">💰</div><div class="kpi-lbl">Montant documenté</div><div class="kpi-val" style="font-size:15px;color:var(--orang)">${fmt(total)} F</div></div>
    <div class="kpi" style="border-left-color:var(--vert)"><div class="kpi-ico">📦</div><div class="kpi-lbl">Quantité enregistrée</div><div class="kpi-val" style="color:var(--vert)">${fmt(quantity)}</div></div>
    <div class="kpi" style="border-left-color:var(--or)"><div class="kpi-ico">🧰</div><div class="kpi-lbl">Kits financiers</div><div class="kpi-val" style="color:var(--or)">${kitRows.length}</div><div class="kpi-sub">${components.length} composants séparés</div></div>
  </div>
  <div class="card no-print">
    <div class="card-title">Filtres de consultation</div>
    <div class="fr">
      <label>Du</label><input type="date" value="${escHtml(from)}" onchange="updatePharmaHistoryFilter('${prefix}','from',this.value,'${view}')">
      <label>Au</label><input type="date" value="${escHtml(to)}" onchange="updatePharmaHistoryFilter('${prefix}','to',this.value,'${view}')">
      <label>Financement</label><select onchange="updatePharmaHistoryFilter('${prefix}','financing',this.value,'${view}')">
        <option value="TOUS">Tous</option>${financingValues.map(value=>`<option value="${escHtml(value)}" ${financing===value?'selected':''}>${escHtml(value)}</option>`).join('')}
      </select>
    </div>
    <div class="fr"><label>Recherche</label><input type="text" value="${escHtml(localStorage.getItem(`${prefix}-search`)||'')}"
      placeholder="Produit, ancien libellé, référence..." onchange="updatePharmaHistoryFilter('${prefix}','search',this.value,'${view}')" style="flex:1">
      <button class="btn btn-out btn-sm" onclick="resetPharmaHistoryFilters('${prefix}','${view}')">Réinitialiser</button></div>
  </div>
  <div class="g2">
    <div class="card"><div class="card-title">Top 10 produits par quantité sortie</div><canvas id="${prefix}-products" style="max-height:310px"></canvas><div style="font-size:9px;color:var(--muted);margin-top:6px">Cliquez sur une barre pour afficher les lignes du produit.</div></div>
    <div class="card"><div class="card-title">Évolution des principales classes thérapeutiques</div><canvas id="${prefix}-classes" style="max-height:310px"></canvas><div style="font-size:9px;color:var(--muted);margin-top:6px">Cliquez sur une courbe ou un point pour afficher la classe.</div></div>
  </div>
  <div class="card"><div class="card-title">Évolution financière pharmacie</div><canvas id="${prefix}-finance" style="max-height:260px"></canvas><div style="font-size:9px;color:var(--muted);margin-top:6px">Cliquez sur un mois pour afficher son registre détaillé.</div></div>
  <div class="card no-print">
    <div class="card-title">Données détaillées sur demande</div>
    <div class="btn-row">
      <button class="btn btn-primary btn-sm" onclick="showPharmaHistoryDetail('${prefix}','all','','${view}')">Afficher la liste détaillée (${filtered.length})</button>
      ${detailOpen?`<button class="btn btn-out btn-sm" onclick="hidePharmaHistoryDetail('${prefix}','${view}')">Masquer le détail</button>`:''}
    </div>
  </div>
  ${detailOpen?`<div class="card">
    <div class="card-title">${escHtml(detailTitle)} — ${detailRows.length} ligne(s)</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Page</th><th>Libellé du registre</th><th>Produit rapproché</th><th>Type</th><th>Quantité</th><th>Montant</th><th>Financement</th><th>Observation</th></tr>
      ${detailRows.slice(0,300).map(row=>`<tr>
        <td style="white-space:nowrap">${fmtD(row.date)}</td><td>${row.page||'—'}</td>
        <td>${escHtml(row.original_label||row.normalized_source_label||'—')}</td>
        <td style="font-weight:700">${escHtml(row.canonical_name||'Non rapproché')}<div style="font-size:9px;color:var(--muted)">${escHtml(row.product_id||'')}</div></td>
        <td><span class="badge ${row.record_type==='KIT_FINANCIER'?'b-warn':'b-ok'}">${escHtml(row.record_type||'—')}</span></td>
        <td>${fmt(+row.quantity||0)}</td><td style="font-weight:700">${fmt(+row.amount||0)} F</td>
        <td>${escHtml(row.financing||'—')}</td><td style="font-size:10px">${escHtml(row.source_observation||'—')}</td>
      </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:#aaa;padding:16px">Aucune ligne pour ce filtre</td></tr>'}
    </table></div>
    ${detailRows.length>300?`<div class="al al-warn no-print" style="margin-top:10px"><strong>Affichage limité</strong>Les 300 premières lignes sont affichées. Affinez les filtres pour consulter le reste.</div>`:''}
  </div>`:''}`;
}

// ── PHARMACIE — Tableau de bord ─────────────────────────
VIEW['pha-tableau'] = (el) => {
  const ventes=DB.get('pharma_ventes');
  const ventesToday=DB.todayItems('pharma_ventes');
  const stock=DB.getStock();
  const alertes=stock.filter(isOperationalStockAlert);
  const totToday=ventesToday.reduce((s,v)=>s+v.total,0);
  const totAll=ventes.reduce((s,v)=>s+v.total,0);
  const byCat={};
  ventes.forEach(v=>v.items.forEach(i=>{
    const m=stock.find(s=>s.id===i.id||s.nom===i.nom);
    const cat=(m?.categorie)||'Autre';
    byCat[cat]=(byCat[cat]||0)+i.montant;
  }));
  const statuts={FPM:0,CMU:0,NA:0};
  ventes.forEach(v=>{statuts[v.statut]=(statuts[v.statut]||0)+v.total;});
  el.innerHTML=`
  <div class="g4">
    <div class="kpi" style="border-left-color:var(--orang)"><div class="kpi-ico">💰</div><div class="kpi-lbl">CA aujourd'hui</div><div class="kpi-val" style="color:var(--orang)">${fmt(totToday)} F</div></div>
    <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-ico">📈</div><div class="kpi-lbl">CA historique</div><div class="kpi-val" style="font-size:16px;color:var(--marine)">${fmt(totAll)} F</div></div>
    <div class="kpi" style="border-left-color:${alertes.length?'var(--rouge)':'var(--vert)'}"><div class="kpi-ico">⚠️</div><div class="kpi-lbl">Alertes stock</div><div class="kpi-val" style="color:${alertes.length?'var(--rouge)':'var(--vert)'}">${alertes.length}</div></div>
    <div class="kpi" style="border-left-color:var(--bleu)"><div class="kpi-ico">🧾</div><div class="kpi-lbl">Délivrances totales</div><div class="kpi-val" style="color:var(--bleu)">${ventes.length}</div></div>
  </div>
  ${alertes.length?`<div class="al al-err"><strong>⚠️ Stock critique :</strong> ${alertes.map(m=>m.nom+' ('+m.stock+')').join(' | ')}</div>`:''}
  <div class="g2">
    <div class="card"><div class="card-title">Ventes par catégorie</div><canvas id="ch-pha-cat"></canvas></div>
    <div class="card"><div class="card-title">Ventes par statut patient</div><canvas id="ch-pha-statut"></canvas></div>
  </div>
  <div class="card">
    <div class="card-title">Délivrances du jour</div>
    <div class="tw"><table>
      <tr><th>Heure</th><th>Patient</th><th>Statut</th><th>Médicaments</th><th>Total</th><th>CNAM</th><th>TM</th></tr>
      ${ventesToday.map(v=>`<tr>
        <td>${fmtT(v.created_at)}</td><td style="font-weight:700">${escHtml(v.patient_nom)}</td>
        <td>${badge(v.statut)}</td>
        <td style="font-size:10px">${v.items.map(i=>i.nom+' ×'+i.qte).join(', ')}</td>
        <td>${fmt(v.total)} F</td>
        <td style="color:var(--cmu)">${fmt(v.cnam)} F</td>
        <td style="color:var(--or)">${fmt(v.tm)} F</td>
      </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:#aaa;padding:16px">Aucune délivrance</td></tr>'}
    </table></div>
  </div>`;
  setTimeout(()=>{
    const cats=Object.keys(byCat);
    if(cats.length) mkChart('ch-pha-cat','bar',cats,[{data:cats.map(c=>byCat[c]),backgroundColor:'rgba(127,63,0,.75)'}]);
    mkChart('ch-pha-statut','doughnut',['FPM','CMU','Non-assuré'],
      [{data:[statuts.FPM||0,statuts.CMU||0,statuts.NA||0],backgroundColor:['#2E7D32','#1565C0','#6D4C41'],borderWidth:2,borderColor:'#fff'}]);
  },100);
};

// ── COMPTA — Caisse ─────────────────────────────────────
VIEW['cpt-caisse'] = (el) => {
  const tx=DB.todayItems('transactions');
  const enc=tx.reduce((s,t)=>s+t.encaisse,0);
  const cnam=tx.reduce((s,t)=>s+t.cnam,0);
  const tot=tx.reduce((s,t)=>s+t.montant,0);
  const byS={ACCUEIL:0,LABO:0,PHARMACIE:0,SOINS:0};
  tx.forEach(t=>{if(t.service in byS)byS[t.service]+=t.encaisse;});
  el.innerHTML=`
  <div class="g4">
    <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-ico">💳</div><div class="kpi-lbl">Total prestations</div><div class="kpi-val" style="color:var(--marine)">${fmt(tot)}</div><div class="kpi-sub">FCFA</div></div>
    <div class="kpi" style="border-left-color:var(--cmu)"><div class="kpi-ico">🏥</div><div class="kpi-lbl">Part CNAM</div><div class="kpi-val" style="color:var(--cmu)">${fmt(cnam)}</div></div>
    <div class="kpi" style="border-left-color:var(--or)"><div class="kpi-ico">💵</div><div class="kpi-lbl">Encaissé direct</div><div class="kpi-val" style="color:var(--or)">${fmt(enc)}</div></div>
    <div class="kpi" style="border-left-color:var(--bleu)"><div class="kpi-ico">🧾</div><div class="kpi-lbl">Opérations</div><div class="kpi-val" style="color:var(--bleu)">${tx.length}</div></div>
  </div>
  <div class="g2">
    <div class="card"><div class="card-title">Encaissements par service</div><canvas id="ch-cpt-pie"></canvas></div>
    <div class="card">
      <div class="card-title">Journal de caisse — ${new Date().toLocaleDateString('fr-FR')}</div>
      <div class="tw"><table>
        <tr><th>Heure</th><th>Patient</th><th>Service</th><th>Statut</th><th>Montant</th><th>Encaissé</th><th>Agent</th></tr>
        ${tx.slice(0,25).map(t=>`<tr>
          <td>${fmtT(t.created_at)}</td>
          <td style="font-size:11px;font-weight:700">${escHtml(t.patient_nom)}</td>
          <td><span style="font-size:10px;background:#f0f4ff;color:var(--bleu);padding:1px 6px;border-radius:6px;font-weight:700">${t.service}</span></td>
          <td>${badge(t.statut)}</td>
          <td>${fmt(t.montant)} F</td>
          <td style="font-weight:700;color:${t.encaisse===0?'var(--fpm)':'var(--or)'}">${t.encaisse===0?'FPM':fmt(t.encaisse)+' F'}</td>
          <td style="font-size:10px;color:var(--muted)">${escHtml(t.agent_nom)}</td>
        </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:#aaa;padding:16px">Aucune transaction</td></tr>'}
        ${tx.length?`<tr class="tr-tot"><td colspan="4">TOTAL</td><td>${fmt(tot)} F</td><td>${fmt(enc)} F</td><td></td></tr>`:''}
      </table></div>
    </div>
  </div>`;
  setTimeout(()=>{
    mkChart('ch-cpt-pie','doughnut',
      ['Accueil','Labo','Pharmacie','Soins'],
      [{data:[byS.ACCUEIL,byS.LABO,byS.PHARMACIE,byS.SOINS],backgroundColor:['#2E7D32','#1F4E79','#7F3F00','#006064'],borderWidth:2,borderColor:'#fff'}]);
  },100);
};

VIEW['cpt-cloture'] = (el) => {
  const tx=DB.todayItems('transactions');
  const enc=tx.reduce((s,t)=>s+t.encaisse,0);
  const cnam=tx.reduce((s,t)=>s+t.cnam,0);
  const consults=DB.todayItems('consultations');
  const patients=DB.todayItems('patients');
  const labo=DB.todayItems('labo_actes');
  const pharma=DB.todayItems('pharma_ventes');
  const soins=DB.todayItems('soins');
  el.innerHTML=`
  <div class="card" id="cloture-print">
    <div class="card-title">Fiche de clôture — ${new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
    <div class="g2">
      <div>
        <table class="tw" style="width:100%">
          <tr><th colspan="2" style="background:var(--vert)">Activités du jour</th></tr>
          <tr><td>Patients enregistrés</td><td style="font-weight:700;text-align:right">${patients.length}</td></tr>
          <tr><td>Consultations</td><td style="font-weight:700;text-align:right">${consults.length}</td></tr>
          <tr><td>dont FPM (gratuites)</td><td style="text-align:right">${consults.filter(c=>c.statut==='FPM').length}</td></tr>
          <tr><td>dont CMU</td><td style="text-align:right">${consults.filter(c=>c.statut==='CMU').length}</td></tr>
          <tr><td>dont Non-assurés</td><td style="text-align:right">${consults.filter(c=>c.statut==='NA').length}</td></tr>
          <tr><td>dont Visites de stage</td><td style="text-align:right">${consults.filter(c=>c.type==='STAGE').length}</td></tr>
          <tr><td>Actes biologie</td><td style="font-weight:700;text-align:right">${labo.length}</td></tr>
          <tr><td>Soins infirmiers</td><td style="font-weight:700;text-align:right">${soins.length}</td></tr>
          <tr><td>Délivrances pharmacie</td><td style="font-weight:700;text-align:right">${pharma.length}</td></tr>
        </table>
      </div>
      <div>
        <table class="tw" style="width:100%">
          <tr><th colspan="2" style="background:var(--or)">Situation financière</th></tr>
          <tr><td>Total prestations brutes</td><td style="font-weight:700;text-align:right">${fmt(tx.reduce((s,t)=>s+t.montant,0))} F</td></tr>
          <tr><td>Part CNAM (à facturer)</td><td style="color:var(--cmu);font-weight:700;text-align:right">${fmt(cnam)} F</td></tr>
          <tr><td style="font-weight:700">TOTAL ENCAISSÉ</td><td style="font-weight:800;font-size:15px;color:var(--vert);text-align:right">${fmt(enc)} F</td></tr>
          <tr><td>dont Accueil</td><td style="text-align:right">${fmt(tx.filter(t=>t.service==='ACCUEIL').reduce((s,t)=>s+t.encaisse,0))} F</td></tr>
          <tr><td>dont Labo (TM)</td><td style="text-align:right">${fmt(tx.filter(t=>t.service==='LABO').reduce((s,t)=>s+t.encaisse,0))} F</td></tr>
          <tr><td>dont Soins (TM)</td><td style="text-align:right">${fmt(tx.filter(t=>t.service==='SOINS').reduce((s,t)=>s+t.encaisse,0))} F</td></tr>
          <tr><td>dont Pharmacie (TM)</td><td style="text-align:right">${fmt(tx.filter(t=>t.service==='PHARMACIE').reduce((s,t)=>s+t.encaisse,0))} F</td></tr>
        </table>
      </div>
    </div>
    <div class="fs" style="margin-top:10px">
      <div class="al al-info"><strong>Règle caisse</strong>Le montant physique doit être supérieur ou égal au montant attendu (les excédents sont autorisés).</div>
      <div class="fr"><label>Montant physique en caisse (FCFA)</label><input type="number" id="clt-physique" placeholder="Comptage physique" oninput="calcEcart(${enc})"></div>
      <div class="fr"><label>Écart</label><span id="clt-ecart-lbl" style="font-size:13px;font-weight:700">—</span></div>
      <div class="fr"><label>Observations</label><input type="text" id="clt-obs" placeholder="Observations éventuelles..."></div>
    </div>
    <div class="fs">
      <div class="fr"><label>Signature Caissière</label><input type="text" id="clt-sig1" placeholder="Nom + signature"></div>
      <div class="fr"><label>Signature Responsable</label><input type="text" id="clt-sig2" placeholder="Nom + signature"></div>
    </div>
    <div class="btn-row no-print">
      <button class="btn btn-success" onclick="validerCloture(${enc},${cnam})">Valider et enregistrer</button>
      <button class="btn btn-print btn-sm" onclick="printSection('cloture-print')">Imprimer fiche</button>
    </div>
  </div>
  <div id="clt-confirm"></div>`;
};
function calcEcart(expected){
  const v=+document.getElementById('clt-physique').value||0;
  const ecart=v-expected;
  const el=document.getElementById('clt-ecart-lbl');
  if(!el)return;
  el.textContent=ecart===0?'✅ Conforme':ecart>0?`+ ${fmt(ecart)} F (excédent)`:`- ${fmt(Math.abs(ecart))} F (manque)`;
  el.style.color=ecart===0?'var(--vert)':ecart>0?'var(--or)':'var(--rouge)';
}
function validerCloture(enc,cnam){
  const physique=+document.getElementById('clt-physique').value||0;
  const ecart=physique-enc;
  const s1=document.getElementById('clt-sig1').value;
  const s2=document.getElementById('clt-sig2').value;
  if(!s1||!s2){alert('Les deux signatures sont obligatoires');return;}
  if(physique<enc){
    alert('Clôture refusée : le montant physique ne peut pas être inférieur au montant attendu.');
    logAudit('CLOTURE_REJETEE',{enc_attendu:enc,physique,ecart,motif:'physique inferieur a attendu'});
    return;
  }
  DB.push('clotures',{date:today(),enc_attendu:enc,physique,ecart,cnam_a_facturer:cnam,
    observations:document.getElementById('clt-obs').value,sig_caissier:s1,sig_resp:s2,heure:new Date().toLocaleTimeString('fr-FR')});
  logAudit('CLOTURE_CREATE',{enc_attendu:enc,physique,ecart,cnam_a_facturer:cnam,sig_caissier:s1,sig_resp:s2});
  document.getElementById('clt-confirm').innerHTML=`
    <div class="al ${ecart===0?'al-ok':ecart>0?'al-warn':'al-err'}">
      <strong>${ecart===0?'✅ Clôture conforme':'⚠️ Clôture avec écart de '+fmt(Math.abs(ecart))+' FCFA'}</strong>
      Enregistrée le ${new Date().toLocaleString('fr-FR')} | Caissière : ${s1}
    </div>`;
}

VIEW['cpt-rapports'] = (el) => {
  const allTx=DB.get('transactions');
  const byDay={};
  allTx.forEach(t=>{
    const d=t.date||t.created_at?.slice(0,10)||today();
    if(!byDay[d]){byDay[d]={enc:0,cnam:0,tot:0,nb:0};}
    byDay[d].enc+=t.encaisse;byDay[d].cnam+=t.cnam;byDay[d].tot+=t.montant;byDay[d].nb++;
  });
  const days=Object.keys(byDay).sort().reverse().slice(0,21);
  el.innerHTML=`
  <div class="g2">
    <div class="kpi" style="border-left-color:var(--or)"><div class="kpi-ico">💰</div><div class="kpi-lbl">Total encaissé (tout l'historique)</div><div class="kpi-val" style="font-size:16px;color:var(--or)">${fmt(allTx.reduce((s,t)=>s+t.encaisse,0))} FCFA</div></div>
    <div class="kpi" style="border-left-color:var(--cmu)"><div class="kpi-ico">🏥</div><div class="kpi-lbl">Total CNAM à facturer</div><div class="kpi-val" style="font-size:16px;color:var(--cmu)">${fmt(allTx.reduce((s,t)=>s+t.cnam,0))} FCFA</div></div>
  </div>
  <div class="card">
    <div class="card-title">Rapports par journée (21 derniers jours)</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Opérations</th><th>Total prestations</th><th>Part CNAM</th><th>Encaissé direct</th><th>Taux CMU</th></tr>
      ${days.map(d=>{const r=byDay[d];const taux=r.tot>0?Math.round(r.cnam/r.tot*100):0;
        return `<tr><td style="font-weight:700">${fmtD(d)}</td><td style="text-align:center">${r.nb}</td>
          <td>${fmt(r.tot)} F</td><td style="color:var(--cmu);font-weight:700">${fmt(r.cnam)} F</td>
          <td style="color:var(--or);font-weight:700">${fmt(r.enc)} F</td>
          <td><span class="badge ${taux>=70?'b-ok':taux>=50?'b-warn':'b-err'}">${taux}%</span></td></tr>`;}).join('')||'<tr><td colspan="6" style="text-align:center;color:#aaa">Aucune donnée</td></tr>'}
    </table></div>
  </div>`;
};

// ── MÉDECIN-CHEF — Dashboard ─────────────────────────────
VIEW['chef-dashboard'] = (el) => {
  const txT=DB.todayItems('transactions');
  const enc=txT.reduce((s,t)=>s+t.encaisse,0);
  const cnam=txT.reduce((s,t)=>s+t.cnam,0);
  const tot=txT.reduce((s,t)=>s+t.montant,0);
  const taux=tot>0?Math.round(cnam/tot*100):0;
  const allTx=DB.get('transactions');
  const weekData=[];
  for(let i=6;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const ds=d.toISOString().slice(0,10);
    const dtx=allTx.filter(t=>(t.date||t.created_at?.slice(0,10))===ds);
    weekData.push({label:['D','L','M','Me','J','V','S'][d.getDay()]+d.getDate(),
      enc:dtx.reduce((s,t)=>s+t.encaisse,0),cnam:dtx.reduce((s,t)=>s+t.cnam,0),tot:dtx.reduce((s,t)=>s+t.montant,0)});
  }
  const pat=DB.todayItems('patients');
  const cs=DB.todayItems('consultations');
  const la=DB.todayItems('labo_actes');
  const ph=DB.todayItems('pharma_ventes');
  const so=DB.todayItems('soins');
  const rejetsClotureToday=DB.todayItems('audit_logs').filter(l=>l.action==='CLOTURE_REJETEE');
  const totalManqueRejete=rejetsClotureToday.reduce((s,l)=>s+Math.abs(l.details?.ecart||0),0);
  el.innerHTML=`
  ${renderCriticalBanner('Médecin-Chef')}
  ${rejetsClotureToday.length?`<div class="al al-err"><strong>🚨 Alerte clôture :</strong> ${rejetsClotureToday.length} rejet(s) aujourd'hui (${fmt(totalManqueRejete)} FCFA de manque cumulé). Vérifier le module Traçabilité.</div>`:''}
  <div class="g4">
    <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-ico">💳</div><div class="kpi-lbl">Total jour</div><div class="kpi-val" style="color:var(--marine)">${fmt(tot)}</div><div class="kpi-sub">FCFA</div></div>
    <div class="kpi" style="border-left-color:var(--cmu)"><div class="kpi-ico">🏥</div><div class="kpi-lbl">Part CNAM</div><div class="kpi-val" style="color:var(--cmu)">${fmt(cnam)}</div></div>
    <div class="kpi" style="border-left-color:var(--or)"><div class="kpi-ico">💵</div><div class="kpi-lbl">Encaissé</div><div class="kpi-val" style="color:var(--or)">${fmt(enc)}</div></div>
    <div class="kpi" style="border-left-color:${taux>=70?'var(--vert)':'var(--rouge)'}"><div class="kpi-ico">📊</div><div class="kpi-lbl">Taux CMU</div><div class="kpi-val" style="color:${taux>=70?'var(--vert)':'var(--rouge)'}">${taux}%</div><div class="kpi-sub">Obj. ≥ 70%</div></div>
  </div>
  <div class="g4">
    <div class="kpi" style="border-left-color:var(--fpm)"><div class="kpi-ico">👥</div><div class="kpi-lbl">Patients</div><div class="kpi-val" style="color:var(--fpm)">${pat.length}</div></div>
    <div class="kpi" style="border-left-color:var(--bleu)"><div class="kpi-ico">🩺</div><div class="kpi-lbl">Consultations</div><div class="kpi-val" style="color:var(--bleu)">${cs.length}</div></div>
    <div class="kpi" style="border-left-color:var(--bleu)"><div class="kpi-ico">🔬</div><div class="kpi-lbl">Actes Labo</div><div class="kpi-val" style="color:var(--bleu)">${la.length}</div></div>
    <div class="kpi" style="border-left-color:var(--orang)"><div class="kpi-ico">💊</div><div class="kpi-lbl">Pharma+Soins</div><div class="kpi-val" style="color:var(--orang)">${ph.length+so.length}</div></div>
  </div>
  <div class="g2">
    <div class="card"><div class="card-title">Activités 7 jours</div><canvas id="ch-chef-w"></canvas></div>
    <div class="card"><div class="card-title">Mix patients du jour</div><canvas id="ch-chef-s"></canvas></div>
  </div>
  <div class="card">
    <div class="card-title">Vue temps réel par service</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${[
        {lbl:'ACCUEIL',ico:'👥',v:pat.length+' pts / '+cs.length+' consult.',enc:txT.filter(t=>t.service==='ACCUEIL').reduce((s,t)=>s+t.encaisse,0),col:'var(--vert)'},
        {lbl:'LABO',ico:'🔬',v:la.length+' dossiers',enc:txT.filter(t=>t.service==='LABO').reduce((s,t)=>s+t.encaisse,0),col:'var(--bleu)'},
        {lbl:'SOINS',ico:'💉',v:so.length+' actes',enc:txT.filter(t=>t.service==='SOINS').reduce((s,t)=>s+t.encaisse,0),col:'var(--cyan)'},
        {lbl:'PHARMACIE',ico:'💊',v:ph.length+' déliv.',enc:txT.filter(t=>t.service==='PHARMACIE').reduce((s,t)=>s+t.encaisse,0),col:'var(--orang)'},
      ].map(s=>`
        <div style="border-left:4px solid ${s.col};padding:10px;background:#f8f9fb;border-radius:8px">
          <div style="font-weight:700;color:${s.col};font-size:11px">${s.ico} ${s.lbl}</div>
          <div style="font-size:12px;margin:4px 0">${s.v}</div>
          <div style="font-size:12px;font-weight:700;color:var(--or)">Encaissé : ${fmt(s.enc)} F</div>
        </div>`).join('')}
    </div>
  </div>`;
  setTimeout(()=>{
    mkChart('ch-chef-w','bar',weekData.map(d=>d.label),
      [{label:'Total',data:weekData.map(d=>d.tot),backgroundColor:'rgba(13,43,69,.7)',stack:'s'},
       {label:'CNAM',data:weekData.map(d=>d.cnam),backgroundColor:'rgba(26,107,60,.7)',stack:'s'}]);
    const fpm=cs.filter(c=>c.statut==='FPM').length,cmu=cs.filter(c=>c.statut==='CMU').length,na=cs.filter(c=>c.statut==='NA').length;
    if(fpm+cmu+na>0) mkChart('ch-chef-s','doughnut',['FPM','CMU','Non-assuré'],
      [{data:[fpm,cmu,na],backgroundColor:['#2E7D32','#1565C0','#6D4C41'],borderWidth:2,borderColor:'#fff'}]);
  },100);
};

// CHEF — Détail pharmacie (lecture seule)
VIEW['chef-pharmacie'] = (el) => {
  const dateFilter=localStorage.getItem('chef-pharma-date')||today();
  const search=(localStorage.getItem('chef-pharma-search')||'').toLowerCase();
  const ventes=DB.get('pharma_ventes')
    .filter(v=>(!dateFilter||(v.created_at||v.date||'').startsWith(dateFilter)))
    .filter(v=>!search||[
      v.patient_nom,v.ordonnance,v.agent_nom,v.origine,v.motif_entree_directe,
      ...(Array.isArray(v.items)?v.items.map(i=>i.nom):[])
    ].some(x=>String(x||'').toLowerCase().includes(search)));
  const stock=DB.getStock();
  const lots=DB.getLots();
  const mouvements=DB.get('pharma_mouvements');
  const inventaires=DB.get('pharma_inventaires');
  const total=ventes.reduce((s,v)=>s+(+v.total||0),0);
  const cnam=ventes.reduce((s,v)=>s+(+v.cnam||0),0);
  const tm=ventes.reduce((s,v)=>s+(+v.tm||0),0);
  const alertes=stock.filter(isOperationalStockAlert);
  const toInventory=stock.filter(m=>m.catalogue_status==='A_INVENTORIER');
  const toPrice=stock.filter(m=>(+m.px_cession||0)<=0);
  const stockAcquisitionValue=stock.reduce((sum,m)=>sum+(+m.stock||0)*(+m.px_achat||0),0);
  const stockCmuValue=stock.reduce((sum,m)=>sum+(m.cmu_eligible?(+m.stock||0)*pxCMU(m):0),0);
  const stockNonCmuValue=stock.reduce((sum,m)=>sum+(+m.stock||0)*pxNA(m),0);
  const potentialMargin=stock.reduce((sum,m)=>{
    const sale=m.cmu_eligible?pxCMU(m):pxNA(m);
    return sum+(+m.stock||0)*(sale-(+m.px_achat||0));
  },0);
  el.innerHTML=`
  <div class="g4" style="margin-bottom:12px">
    <div class="kpi" style="border-left-color:var(--orang)"><div class="kpi-ico">💊</div><div class="kpi-lbl">Délivrances</div><div class="kpi-val" style="color:var(--orang)">${ventes.length}</div></div>
    <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-ico">💰</div><div class="kpi-lbl">Valeur délivrée</div><div class="kpi-val" style="font-size:14px">${fmt(total)} F</div></div>
    <div class="kpi" style="border-left-color:var(--cmu)"><div class="kpi-ico">🏥</div><div class="kpi-lbl">Part CNAM</div><div class="kpi-val" style="font-size:14px;color:var(--cmu)">${fmt(cnam)} F</div></div>
    <div class="kpi" style="border-left-color:${alertes.length?'var(--rouge)':'var(--vert)'}"><div class="kpi-ico">📦</div><div class="kpi-lbl">Alertes stock</div><div class="kpi-val" style="color:${alertes.length?'var(--rouge)':'var(--vert)'}">${alertes.length}</div></div>
  </div>
  <div class="card no-print">
    <div class="card-title">Consultation des opérations pharmacie</div>
    <div class="fr">
      <label>Date</label>
      <input type="date" value="${escHtml(dateFilter)}" onchange="localStorage.setItem('chef-pharma-date',this.value);showView('chef-pharmacie')">
      <label>Recherche</label>
      <input type="text" value="${escHtml(localStorage.getItem('chef-pharma-search')||'')}" placeholder="Patient, ordonnance, médicament, agent..."
        onchange="localStorage.setItem('chef-pharma-search',this.value);showView('chef-pharmacie')" style="flex:1">
      <button class="btn btn-out btn-sm" onclick="localStorage.removeItem('chef-pharma-date');localStorage.removeItem('chef-pharma-search');showView('chef-pharmacie')">Tout afficher</button>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Délivrances détaillées — ${dateFilter||'Toutes les dates'}</div>
    <div class="tw"><table>
      <tr><th>Date/heure</th><th>Patient</th><th>Ordonnance</th><th>Origine</th><th>Médicaments délivrés</th><th>Total</th><th>CNAM</th><th>TM</th><th>Agent</th></tr>
      ${ventes.map(v=>`<tr>
        <td style="white-space:nowrap">${fmtD(v.created_at)} ${fmtT(v.created_at)}</td>
        <td style="font-weight:700">${escHtml(v.patient_nom||'—')}<div style="font-size:9px">${badge(v.statut_facturation||v.statut)}</div></td>
        <td>${escHtml(v.ordonnance||'—')}</td>
        <td style="font-size:10px">${escHtml(v.origine||'ORIENTATION')}${v.motif_entree_directe?`<div style="color:var(--muted)">${escHtml(v.motif_entree_directe)}</div>`:''}</td>
        <td style="min-width:250px">${(Array.isArray(v.items)?v.items:[]).map(i=>`
          <div style="margin-bottom:3px"><strong>${escHtml(i.nom||'Médicament')}</strong> × ${fmt(+i.qte||0)}
          <span style="color:var(--muted)">à ${fmt(+i.pu||0)} F = ${fmt(+i.montant||0)} F</span></div>`).join('')||'—'}</td>
        <td style="font-weight:700">${fmt(+v.total||0)} F</td>
        <td style="color:var(--cmu)">${fmt(+v.cnam||0)} F</td>
        <td style="color:var(--or)">${fmt(+v.tm||0)} F</td>
        <td style="font-size:10px">${escHtml(v.agent_nom||'—')}</td>
      </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:#aaa;padding:16px">Aucune délivrance pour ce filtre</td></tr>'}
      ${ventes.length?`<tr class="tr-tot"><td colspan="5">TOTAL (${ventes.length} délivrance(s))</td><td>${fmt(total)} F</td><td>${fmt(cnam)} F</td><td>${fmt(tm)} F</td><td></td></tr>`:''}
    </table></div>
  </div>
  <div class="card">
    <div class="card-title">État actuel du stock — Lecture seule</div>
    <div class="g4" style="margin-bottom:12px">
      <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-lbl">Valeur d'acquisition</div><div class="kpi-val" style="font-size:14px">${fmt(stockAcquisitionValue)} F</div></div>
      <div class="kpi" style="border-left-color:var(--cmu)"><div class="kpi-lbl">Valeur de vente CMU</div><div class="kpi-val" style="font-size:14px;color:var(--cmu)">${fmt(stockCmuValue)} F</div></div>
      <div class="kpi" style="border-left-color:var(--orang)"><div class="kpi-lbl">Valeur hors CMU</div><div class="kpi-val" style="font-size:14px;color:var(--orang)">${fmt(stockNonCmuValue)} F</div></div>
      <div class="kpi" style="border-left-color:var(--vert)"><div class="kpi-lbl">Marge potentielle</div><div class="kpi-val" style="font-size:14px;color:${potentialMargin>=0?'var(--vert)':'var(--rouge)'}">${fmt(potentialMargin)} F</div></div>
    </div>
    ${(toInventory.length||toPrice.length)?`<div class="al al-info"><strong>Catalogue réel en cours d'initialisation</strong>${toInventory.length} référence(s) à inventorier et ${toPrice.length} tarif(s) à valider. Les zéros affichés sont des valeurs d'attente, pas des ruptures de stock.</div>`:''}
    ${alertes.length?`<div class="al al-err"><strong>${alertes.length} article(s) au seuil ou en dessous</strong>${alertes.map(m=>`${escHtml(m.nom)} : ${fmt(+m.stock||0)} (seuil ${fmt(+m.seuil||0)})`).join(' | ')}</div>`:''}
    <div class="tw"><table>
      <tr><th>Code interne</th><th>EAN</th><th>Médicament</th><th>DCI</th><th>Dosage</th><th>Forme</th><th>Conditionnement</th><th>CMU</th><th>Stock</th><th>État</th><th>Acquisition</th><th>Vente CMU</th><th>Vente hors CMU</th><th>Marge unitaire</th></tr>
      ${stock.map(m=>{
        const pending=m.catalogue_status==='A_INVENTORIER';
        const low=isOperationalStockAlert(m);
        const sale=m.cmu_eligible?pxCMU(m):pxNA(m);
        const margin=productMargin(sale,m.px_achat);
        return `<tr><td>${escHtml(m.code_produit||m.source_product_id||'—')}</td><td style="font-family:monospace">${escHtml(m.code_ean||'—')}</td>
          <td style="font-weight:700">${escHtml(m.nom||'—')}</td><td>${escHtml(m.dci||'—')}</td>
          <td>${escHtml(m.dosage||'Non renseigné')}</td><td>${escHtml(pharmaForm(m))}</td><td>${escHtml(canonicalPharmaPack(m.conditionnement||m.unite))}</td>
          <td><span class="badge ${m.cmu_eligible?'b-cmu':'b-na'}">${m.cmu_eligible?'OUI':'NON'}</span></td>
          <td style="font-weight:700;color:${pending?'var(--orang)':low?'var(--rouge)':'var(--vert)'}">${fmt(+m.stock||0)} ${escHtml(canonicalPharmaPack(m.conditionnement||m.unite))}</td>
          <td><span class="badge ${pending?'b-warn':low?'b-err':'b-ok'}">${pending?'À INVENTORIER':low?'ALERTE':'OK'}</span></td>
          <td>${fmt(+m.px_achat||0)} F</td><td>${m.cmu_eligible?fmt(pxCMU(m))+' F':'—'}</td><td>${fmt(pxNA(m))} F</td>
          <td style="color:${margin.amount>=0?'var(--vert)':'var(--rouge)'};font-weight:700">${fmt(margin.amount)} F (${fmt(margin.rate)}%)</td></tr>`;
      }).join('')}
    </table></div>
  </div>
  <div class="card">
    <div class="card-title">Lots à surveiller</div>
    <div class="tw"><table>
      <tr><th>Médicament</th><th>Lot</th><th>Péremption</th><th>État</th><th>Quantité</th><th>Fournisseur</th></tr>
      ${lots.filter(l=>(+l.quantite||0)>0).sort((a,b)=>(a.date_peremption||'9999').localeCompare(b.date_peremption||'9999')).map(l=>{
        const state=lotExpiryState(l);
        return `<tr><td style="font-weight:700">${escHtml(l.medicament||'—')}</td><td>${escHtml(l.numero_lot||'—')}</td>
          <td>${l.date_peremption?fmtD(l.date_peremption):'—'}</td><td><span class="badge ${state.cls}">${state.label}</span></td>
          <td>${fmt(+l.quantite||0)}</td><td>${escHtml(l.fournisseur||'—')}</td></tr>`;
      }).join('')||'<tr><td colspan="6" style="text-align:center;color:#aaa">Aucun lot</td></tr>'}
    </table></div>
  </div>
  <div class="card">
    <div class="card-title">Inventaires en attente de décision</div>
    ${inventaires.filter(i=>i.statut==='EN_ATTENTE_CHEF').map(inv=>{
      const ecarts=(inv.lignes||[]).filter(l=>(+l.ecart||0)!==0);
      const nouveaux=(inv.lignes||[]).filter(l=>l.is_new);
      const aRevoir=(inv.lignes||[]).filter(l=>l.review_required);
      const summary=inv.import_summary||{};
      return `<div class="fs"><div class="fs-title">${escHtml(inv.reference||'Inventaire')} — ${fmtD(inv.created_at)} — ${escHtml(inv.agent_nom||'—')}</div>
        ${inv.imported_inventory?`<div class="al al-info"><strong>Reprise d'inventaire importée</strong>
          ${fmt(summary.inventory_lines||(inv.lignes||[]).length)} ligne(s), ${fmt(summary.existing_products||0)} produit(s) rapproché(s) et
          ${fmt(summary.new_products||nouveaux.length)} nouvelle(s) fiche(s). Le stock reste inchangé jusqu'à l'approbation.</div>`:''}
        ${aRevoir.length?`<div class="al al-err"><strong>${aRevoir.length} ligne(s) à corriger avant approbation</strong>
          Les unités ou quantités de ces lignes sont contradictoires dans le fichier source.</div>`:''}
        ${nouveaux.length?`<div class="al al-warn"><strong>${nouveaux.length} nouveau(x) produit(s) à valider</strong>${nouveaux.map(l=>`${escHtml(l.code_produit)} — ${escHtml(l.medicament)} — ${fmt(l.physique)} ${escHtml(l.conditionnement||'')}`).join(' | ')}</div>`:''}
        <div style="font-size:11px;margin-bottom:8px">${ecarts.filter(l=>!l.is_new).map(l=>`<strong>${escHtml(l.medicament)}</strong> : ${l.ecart>0?'+':''}${fmt(l.ecart)} (${escHtml(l.motif||'sans motif')})`).join(' | ')||'Aucun écart sur les produits existants'}</div>
        ${inv.imported_inventory?`<details style="margin:10px 0"><summary style="cursor:pointer;font-weight:700">Voir les ${fmt((inv.lignes||[]).length)} lignes de contrôle</summary>
          <div class="tw" style="margin-top:8px"><table>
            <tr><th>Ligne source</th><th>Produit corrigé</th><th>Rapprochement</th><th>Compté</th><th>Contrôle</th><th>Note source</th><th></th></tr>
            ${(inv.lignes||[]).map((line,index)=>`<tr>
              <td>${escHtml((line.source_rows||[line.source_row]).join(', '))}</td>
              <td style="font-weight:700">${escHtml(line.medicament||'—')}<div style="font-size:9px;color:var(--muted)">${escHtml(line.correction_note||'')}</div></td>
              <td><span class="badge ${line.is_new?'b-warn':'b-ok'}">${line.is_new?'NOUVELLE FICHE':'CATALOGUE'}</span></td>
              <td style="white-space:nowrap;font-weight:700">${fmt(+line.physique||0)} ${escHtml(line.unite||line.conditionnement||'')}</td>
              <td>${line.review_required?`<span class="badge b-err">À CORRIGER</span><div style="font-size:9px;color:var(--rouge);max-width:260px">${escHtml(line.review_reason||'Contrôle requis')}</div>`:'<span class="badge b-ok">PRÊT</span>'}</td>
              <td style="font-size:9px;max-width:260px">${escHtml(line.source_note||'—')}</td>
              <td>${line.review_required?`<button class="btn btn-out btn-sm no-print" onclick="resolveImportedInventoryLine('${inv.id}',${index})">Corriger</button>`:''}</td>
            </tr>`).join('')}
          </table></div></details>`:''}
        <div class="btn-row no-print"><button class="btn btn-success btn-sm" onclick="decidePharmaInventory('${inv.id}',true)">Approuver et ajuster</button>
          <button class="btn btn-danger btn-sm" onclick="decidePharmaInventory('${inv.id}',false)">Rejeter</button></div></div>`;
    }).join('')||'<div class="al al-ok"><strong>Aucun inventaire en attente</strong>Toutes les demandes ont reçu une décision.</div>'}
  </div>
  <div class="card">
    <div class="card-title">Derniers mouvements de stock</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Type</th><th>Médicament</th><th>Lot</th><th>Quantité</th><th>Avant</th><th>Après</th><th>Motif</th><th>Agent</th></tr>
      ${mouvements.slice(0,100).map(m=>`<tr><td>${fmtD(m.created_at)} ${fmtT(m.created_at)}</td><td>${escHtml(m.type||'—')}</td>
        <td style="font-weight:700">${escHtml(m.medicament||'—')}</td><td>${escHtml(m.numero_lot||'—')}</td>
        <td style="color:${(+m.quantite||0)>=0?'var(--vert)':'var(--rouge)'};font-weight:700">${(+m.quantite||0)>0?'+':''}${fmt(+m.quantite||0)}</td>
        <td>${fmt(+m.stock_avant||0)}</td><td>${fmt(+m.stock_apres||0)}</td><td>${escHtml(m.motif||'—')}</td><td>${escHtml(m.agent_nom||'—')}</td></tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:#aaa">Aucun mouvement</td></tr>'}
    </table></div>
  </div>
  ${renderPharmaHistory('chef-pharma-history','chef-pharmacie')}`;
};

function resolveImportedInventoryLine(id,index){
  const inventaires=DB.get('pharma_inventaires');
  const inv=inventaires.find(item=>item.id===id);
  const line=inv?.lignes?.[index];
  if(!inv||inv.statut!=='EN_ATTENTE_CHEF'||!line?.review_required)return;
  const quantity=prompt(`Quantité physique corrigée pour ${line.medicament} :`,String(+line.physique||0));
  if(quantity===null)return;
  const parsed=Number(String(quantity).replace(',','.'));
  if(!Number.isFinite(parsed)||parsed<0){alert('La quantité doit être un nombre positif ou nul.');return;}
  const unit=prompt('Unité homogène validée (ex. Ampoule, Boîte, Flacon, Plaquette, Comprimé / unité) :',line.unite||line.conditionnement||'Unité');
  if(unit===null||!unit.trim()){alert('L’unité validée est obligatoire.');return;}
  const note=prompt('Note de correction du Médecin-Chef :',line.review_reason||'');
  if(note===null||!note.trim()){alert('La justification de la correction est obligatoire.');return;}
  line.physique=parsed;
  line.unite=canonicalPharmaPack(unit.trim());
  line.conditionnement=line.unite;
  line.ecart=parsed-(+line.theorique||0);
  line.review_required=false;
  line.review_resolved_at=new Date().toISOString();
  line.review_resolved_by=CURRENT_AGENT.nom;
  line.chef_correction=note.trim();
  if(!line.is_new)line.catalogue_patch={...(line.catalogue_patch||{}),conditionnement:line.unite,unite:line.unite};
  persistUpdatedRecord('pharma_inventaires',inventaires,inv);
  logAudit('PHARMACIE_INVENTAIRE_LIGNE_CORRIGEE',{reference:inv.reference,source_row:line.source_row,medicament:line.medicament,physique:parsed,unite:line.unite});
  showView('chef-pharmacie');
}

function decidePharmaInventory(id,approve){
  const inventaires=DB.get('pharma_inventaires');
  const inv=inventaires.find(i=>i.id===id);
  if(!inv||inv.statut!=='EN_ATTENTE_CHEF') return;
  const unresolved=(inv.lignes||[]).filter(line=>line.review_required);
  if(approve&&unresolved.length){
    alert(`${unresolved.length} ligne(s) doivent être corrigées avant l’approbation de cet inventaire.`);
    return;
  }
  const decision=prompt(approve?'Motif ou commentaire d’approbation :':'Motif obligatoire du rejet :','');
  if(decision===null||(!approve&&!decision.trim())) return;
  if(!approve){
    inv.statut='REJETE';
    inv.decision_motif=decision.trim();
    inv.decide_par=CURRENT_AGENT.nom;
    inv.decide_at=new Date().toISOString();
    persistUpdatedRecord('pharma_inventaires',inventaires,inv);
    logAudit('PHARMACIE_INVENTAIRE_REJETE',{reference:inv.reference,motif:inv.decision_motif});
    showView('chef-pharmacie');
    return;
  }
  const stock=DB.getStock();
  const stale=(inv.lignes||[]).find(line=>{
    if(line.is_new)return false;
    const med=stock.find(m=>m.id===line.med_id);
    return med&&(+med.stock||0)!==(+line.theorique||0);
  });
  if(stale){alert(`Le stock de ${stale.medicament} a changé depuis l’inventaire. Rejetez cette demande et faites saisir un nouvel inventaire.`);return;}
  const lots=DB.getLots();
  const impossible=(inv.lignes||[]).find(line=>{
    if(line.is_new||(+line.ecart||0)>=0) return false;
    const med=stock.find(m=>m.id===line.med_id);
    if(!med) return true;
    ensureLotCoverage(med,lots);
    return lots.filter(l=>l.med_id===med.id).reduce((sum,l)=>sum+(+l.quantite||0),0)<Math.abs(+line.ecart||0);
  });
  if(impossible){alert(`Lots insuffisants pour ajuster ${impossible.medicament}.`);return;}
  for(const line of (inv.lignes||[])){
    if(line.is_new){
      const duplicate=stock.find(m=>catalogueKey(m.code_produit)===catalogueKey(line.code_produit)
        ||(line.code_ean&&normalizeEan(m.code_ean)===normalizeEan(line.code_ean)));
      if(duplicate){alert(`Le nouveau produit ${line.medicament} existe désormais dans le catalogue. Rejetez l’inventaire et recommencez.`);return;}
      const med={
        id:'CAT-'+line.med_id,
        source_product_id:line.code_produit,
        code_produit:line.code_produit,
        code_ean:line.code_ean||'',
        nom:line.medicament,
        dci:line.dci||'',
        dosage:line.dosage||'',
        forme:line.forme||'Non renseignée',
        conditionnement:line.conditionnement||'Unité',
        unite:line.conditionnement||'Unité',
        type_produit:line.type_produit||'Médicament',
        categorie:line.categorie||'À classer',
        cmu_eligible:!!line.cmu_eligible,
        cmu_source:line.cmu_eligible?'Inventaire physique 12/06/2026 — tarif à renseigner':'',
        cmu_markup_pct:15,
        px_achat:0,px_cession:0,px_cmu:0,px_na:0,seuil:0,
        stock:+line.physique||0,
        active:true,
        catalogue_status:'OPERATIONNEL',
        price_status:'A_VALIDER',
        validation_source:'INVENTAIRE_APPROUVE',
        created_at:new Date().toISOString()
      };
      stock.push(med);
      const lotId=`LOT-INV-${inv.id}-${med.id}`;
      lots.unshift({id:lotId,med_id:med.id,medicament:med.nom,numero_lot:`INV-${inv.reference}`,
        date_peremption:'',fournisseur:'Nouveau produit validé par inventaire',quantite:med.stock,quantite_initiale:med.stock,created_at:new Date().toISOString()});
      recordStockMovement({type:'CREATION_PRODUIT_INVENTAIRE',med_id:med.id,medicament:med.nom,quantite:med.stock,
        stock_avant:0,stock_apres:med.stock,lot_id:lotId,numero_lot:`INV-${inv.reference}`,
        motif:line.motif,reference:inv.reference});
      continue;
    }
    const med=stock.find(m=>m.id===line.med_id);
    if(!med) continue;
    if(line.catalogue_patch&&inv.imported_inventory){
      if(line.catalogue_patch.conditionnement)med.conditionnement=canonicalPharmaPack(line.catalogue_patch.conditionnement);
      if(line.catalogue_patch.unite)med.unite=canonicalPharmaPack(line.catalogue_patch.unite);
    }
    med.catalogue_status='OPERATIONNEL';
    if((+line.ecart||0)===0) continue;
    const before=+med.stock||0;
    const delta=+line.ecart||0;
    if(delta>0){
      const lotId=`LOT-INV-${inv.id}-${med.id}`;
      lots.unshift({id:lotId,med_id:med.id,medicament:med.nom,numero_lot:`INV-${inv.reference}`,
        date_peremption:'',fournisseur:'Ajustement inventaire',quantite:delta,quantite_initiale:delta,created_at:new Date().toISOString()});
      med.stock=before+delta;
      med.catalogue_status='OPERATIONNEL';
      recordStockMovement({type:'AJUSTEMENT_INVENTAIRE',med_id:med.id,medicament:med.nom,quantite:delta,
        stock_avant:before,stock_apres:med.stock,lot_id:lotId,numero_lot:`INV-${inv.reference}`,
        motif:line.motif,reference:inv.reference});
    }else{
      ensureLotCoverage(med,lots);
      let remaining=Math.abs(delta);
      const allocations=[];
      lots.filter(l=>l.med_id===med.id&&(+l.quantite||0)>0)
        .sort((a,b)=>(a.date_peremption||'9999').localeCompare(b.date_peremption||'9999'))
        .forEach(l=>{
          if(remaining<=0) return;
          const used=Math.min(remaining,+l.quantite||0);
          l.quantite=(+l.quantite||0)-used;
          remaining-=used;
          allocations.push({lot:l,used});
        });
      med.stock=before+delta;
      allocations.forEach(a=>recordStockMovement({type:'AJUSTEMENT_INVENTAIRE',med_id:med.id,medicament:med.nom,quantite:-a.used,
        stock_avant:before,stock_apres:med.stock,lot_id:a.lot.id,numero_lot:a.lot.numero_lot,date_peremption:a.lot.date_peremption,
        motif:line.motif,reference:inv.reference}));
    }
  }
  DB.setLots(lots);
  DB.setStock(stock);
  inv.statut='APPROUVE';
  inv.decision_motif=decision.trim();
  inv.decide_par=CURRENT_AGENT.nom;
  inv.decide_at=new Date().toISOString();
  persistUpdatedRecord('pharma_inventaires',inventaires,inv);
  logAudit('PHARMACIE_INVENTAIRE_APPROUVE',{reference:inv.reference,ecarts:(inv.lignes||[]).filter(l=>l.ecart!==0&&!l.is_new).length,nouveaux_produits:(inv.lignes||[]).filter(l=>l.is_new).length});
  showView('chef-pharmacie');
}

// CHEF — Alertes
VIEW['chef-alertes'] = (el) => {
  const stock=DB.getStock();
  const alertes=stock.filter(isOperationalStockAlert);
  const critiques=stock.filter(m=>m.stock<=Math.floor(m.seuil/2));
  const txT=DB.todayItems('transactions');
  const tot=txT.reduce((s,t)=>s+t.montant,0);
  const cnam=txT.reduce((s,t)=>s+t.cnam,0);
  const taux=tot>0?Math.round(cnam/tot*100):0;
  const clotures=DB.get('clotures');
  const derniereCloture=clotures[0];
  const alerts=[];
  if(critiques.length) alerts.push({t:'err',titre:'Stock CRITIQUE — Rupture imminente',msg:critiques.map(m=>m.nom+' : '+m.stock+' restants (seuil '+m.seuil+')').join(' | ')});
  else if(alertes.length) alerts.push({t:'warn',titre:'Stock faible',msg:alertes.map(m=>m.nom+' ('+m.stock+')').join(', ')});
  if(taux<60&&tot>0) alerts.push({t:'err',titre:`Taux CMU critique aujourd'hui : ${taux}%`,msg:'Vérifier la saisie des feuilles de soins et la transmission CNAM. Objectif ≥ 70%.'});
  else if(taux<70&&tot>0) alerts.push({t:'warn',titre:`Taux CMU bas : ${taux}%`,msg:'Objectif 70% non atteint. Vérifier la facturation.'});
  if(!derniereCloture||derniereCloture.date!==today()) alerts.push({t:'warn',titre:'Clôture journalière non effectuée',msg:'La clôture doit être réalisée avant 18h00 chaque jour.'});
  if(derniereCloture&&derniereCloture.ecart!==0) alerts.push({t:'err',titre:`Écart de caisse non résolu : ${fmt(Math.abs(derniereCloture.ecart))} FCFA`,msg:`Date : ${derniereCloture.date} | Obs : ${derniereCloture.observations||'—'}`});
  if(!alerts.length) alerts.push({t:'ok',titre:'Aucune alerte active','msg':'Toutes les vérifications sont satisfaisantes.'});
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Alertes & Surveillance — Temps réel</div>
    <button class="btn btn-primary btn-sm no-print" onclick="showView('chef-alertes')" style="margin-bottom:10px">Actualiser</button>
    ${alerts.map(a=>`<div class="al al-${a.t}"><strong>${a.titre}</strong>${a.msg}</div>`).join('')}
  </div>
  <div class="card">
    <div class="card-title">Indicateurs pharmacie — Seuils d'alerte</div>
    <div class="al al-info">Le Médecin-Chef peut modifier les seuils dans l'onglet "Gestion prix".</div>
    ${stock.filter(m=>m.catalogue_status!=='A_INVENTORIER'&&m.stock<=m.seuil*2).slice(0,10).map(m=>{
      const pct=Math.min(100,m.seuil>0?Math.round(m.stock/m.seuil*100):100);
      const col=isOperationalStockAlert(m)?'#E24B4A':m.stock<=m.seuil*1.5?'#EF9F27':'#63992280';
      return `<div class="sk-row">
        <div class="sk-name">${escHtml(m.nom)}</div>
        <div class="sk-bw"><div class="sk-bar" style="width:${pct}%;background:${col}"></div></div>
        <div class="sk-qty" style="color:${col}">${m.stock} / seuil ${m.seuil}</div>
      </div>`;
    }).join('')||'<p style="color:#aaa;text-align:center">Tous les stocks sont au-dessus des seuils ✅</p>'}
  </div>
  <div class="card">
    <div class="card-title">Clôtures récentes</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Attendu</th><th>Physique</th><th>Écart</th><th>CNAM à facturer</th><th>Caissière</th></tr>
      ${clotures.slice(0,7).map(c=>`<tr>
        <td>${c.date}</td><td>${fmt(c.enc_attendu)} F</td><td>${fmt(c.physique)} F</td>
        <td><span class="badge ${c.ecart===0?'b-ok':c.ecart>0?'b-warn':'b-err'}">${c.ecart===0?'✓':fmt(Math.abs(c.ecart))+' F'}</span></td>
        <td style="color:var(--cmu)">${fmt(c.cnam_a_facturer||0)} F</td>
        <td style="font-size:10px">${c.sig_caissier}</td>
      </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:#aaa">Aucune clôture</td></tr>'}
    </table></div>
  </div>`;
};

// CHEF — Dossiers patients
VIEW['chef-patients'] = (el) => {
  const patients=DB.get('patients').slice(0,100);
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Dossiers patients (${patients.length} enregistrés)</div>
    <div class="sb"><input type="text" id="chef-search" placeholder="Rechercher un patient..." oninput="chefSearch()"></div>
    <div id="chef-pat-results">
      <div class="tw"><table>
        <tr><th>Date</th><th>Nom</th><th>Genre</th><th>Statut</th><th>Bâtiment</th><th>Agent accueil</th><th>Consultations</th></tr>
        ${patients.map(p=>{
          const cs=DB.get('consultations').filter(c=>c.patient_id===p.id);
          return `<tr>
            <td>${fmtD(p.created_at)}</td>
            <td style="font-weight:700">${escHtml(p.nom)}</td>
            <td>${escHtml(p.genre||'—')}</td>
            <td>${badge(p.statut_simple||p.statut)}</td>
            <td style="font-size:11px">${escHtml(p.batiment||'—')}</td>
            <td style="font-size:10px;color:var(--muted)">${escHtml(p.agent_nom||'—')}</td>
            <td style="text-align:center">${cs.length}</td>
          </tr>`;
        }).join('')||'<tr><td colspan="7" style="text-align:center;color:#aaa">Aucun patient</td></tr>'}
      </table></div>
    </div>
  </div>`;
};
function chefSearch(){
  const q=document.getElementById('chef-search').value.toLowerCase();
  const patients=DB.get('patients').filter(p=>p.nom.toLowerCase().includes(q)).slice(0,20);
  document.getElementById('chef-pat-results').innerHTML=`
    <div class="tw"><table>
      <tr><th>Date</th><th>Nom</th><th>Genre</th><th>Statut</th><th>Bâtiment</th><th>Agent</th><th>Consultations</th></tr>
      ${patients.map(p=>{const cs=DB.get('consultations').filter(c=>c.patient_id===p.id);return `<tr>
        <td>${fmtD(p.created_at)}</td><td style="font-weight:700">${escHtml(p.nom)}</td><td>${p.genre||'—'}</td>
        <td>${badge(p.statut_simple||p.statut)}</td><td style="font-size:11px">${p.batiment||'—'}</td>
        <td style="font-size:10px;color:var(--muted)">${escHtml(p.agent_nom)}</td><td style="text-align:center">${cs.length}</td>
      </tr>`;}).join('')||'<tr><td colspan="7" style="text-align:center;color:#aaa">Aucun résultat</td></tr>'}
    </table></div>`;
}

// CHEF — Dossier patient complet
VIEW['chef-dossier'] = (el) => {
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Consultation dossier patient complet</div>
    <div class="sb"><input type="text" id="chef-doss-search" placeholder="Rechercher patient..." oninput="chefDossierSearch()"></div>
    <div id="chef-doss-results" style="max-height:120px;overflow-y:auto"></div>
    <div id="chef-doss-view"></div>
  </div>`;
};
function chefDossierSearch(){
  const q=(document.getElementById('chef-doss-search').value||'').toLowerCase();
  const res=document.getElementById('chef-doss-results');
  if(q.length<2){res.innerHTML='';return;}
  const pts=DB.get('patients').filter(p=>p.nom.toLowerCase().includes(q)).slice(0,10);
  res.innerHTML=pts.map(p=>`<div class="pat-card" onclick="openChefDossier('${p.id}')"><div class="pat-av">${escHtml(p.nom[0]||"")}</div><div style="flex:1"><div style="font-weight:700">${escHtml(p.nom)}</div><div style="font-size:10px;color:var(--muted)">${escHtml(p.dossier_no||'—')}</div></div>${badge(p.statut_simple||p.statut)}</div>`).join('')||'<p style="color:#aaa;text-align:center">Aucun patient</p>';
}
function openChefDossier(pid){
  const p=getPatientById(pid); if(!p) return;
  const cs=DB.get('consultations').filter(x=>x.patient_id===pid);
  const cst=DB.get('constantes').filter(x=>x.patient_id===pid);
  const soins=DB.get('soins').filter(x=>x.patient_id===pid);
  const obs=DB.get('observations').filter(x=>(x.patient_id&&x.patient_id===pid)||x.patient_nom===p.nom);
  const ph=DB.get('pharma_ventes').filter(x=>x.patient_nom===p.nom);
  const lab=DB.get('labo_actes').filter(x=>(x.patient_id&&x.patient_id===pid)||x.patient_nom===p.nom);
  const timeline=[];
  cs.forEach(c=>timeline.push({id:c.id,dt:c.created_at,type:'CONSULT',txt:`${c.type} / ${escHtml(c.agent_nom||'?')}`}));
  cst.forEach(c=>timeline.push({id:c.id,dt:c.created_at,type:'CONST',txt:`T°${c.temperature||'—'} TA ${c.ta||'—'} SpO2 ${c.spo2||'—'} IMC ${c.imc||'—'}`}));
  soins.forEach(s=>timeline.push({id:s.id,dt:s.created_at,type:'SOINS',txt:`${(s.actes||[]).map(a=>a.nom).join(', ')||'Actes'} (${fmt(s.total||0)} F)`}));
  lab.forEach(l=>timeline.push({id:l.id,dt:l.created_at,type:'LABO',txt:`${(l.actes||[]).map(a=>a.code).join(', ')||'Actes labo'} (${fmt(l.total||0)} F)`}));
  ph.forEach(v=>timeline.push({id:v.id,dt:v.created_at,type:'PHARMA',txt:`Délivrance (${fmt(v.total||0)} F)`}));
  obs.forEach(o=>timeline.push({id:o.id,dt:o.created_at,type:'OBS',txt:`Observation ${o.statut_obs||'EN COURS'} (${o.nb_jours||1}j)`}));
  timeline.sort((a,b)=>String(b.dt||'').localeCompare(String(a.dt||'')));
  document.getElementById('chef-doss-view').innerHTML=`
    <div class="fs"><div class="fs-title">Identité</div>
      <div class="recu-line"><span>Dossier</span><span>${escHtml(p.dossier_no||'—')}</span></div>
      <div class="recu-line"><span>Patient</span><span><strong>${escHtml(p.nom)}</strong></span></div>
      <div class="recu-line"><span>Antécédents</span><span>${escHtml(p.antecedents||'—')}</span></div>
      <div class="recu-line"><span>Droits</span><span>${p.droits_verifies==='1'?'Vérifiés':'Non vérifiés'}</span></div>
    </div>
    <div class="fs"><div class="fs-title">Historique clinique</div>
      <div style="font-size:11px"><strong>Consultations (${cs.length})</strong>: ${cs.map(c=>`${fmtD(c.created_at)} ${escHtml(c.type||'')} / ${escHtml(c.agent_nom||'?')}`).join(' | ')||'—'}</div>
      <div style="font-size:11px;margin-top:6px"><strong>Constantes (${cst.length})</strong>: ${cst.map(c=>`${fmtD(c.created_at)} T°${escHtml(c.temperature||'—')} TA ${escHtml(c.ta||'—')} SpO2 ${escHtml(c.spo2||'—')} IMC ${escHtml(c.imc||'—')}`).join(' | ')||'—'}</div>
      <div style="font-size:11px;margin-top:6px"><strong>Soins (${soins.length})</strong>: ${soins.map(s=>`${fmtD(s.created_at)} ${escHtml((s.actes||[]).map(a=>a.nom).join(', ')||'—')}`).join(' | ')||'—'}</div>
      <div style="font-size:11px;margin-top:6px"><strong>Pharmacie (${ph.length})</strong>: ${ph.map(v=>`${fmtD(v.created_at)} ${fmt(v.total)} F`).join(' | ')||'—'}</div>
      <div style="font-size:11px;margin-top:6px"><strong>Labo (${lab.length})</strong>: ${lab.map(v=>`${fmtD(v.created_at)} ${fmt(v.total||0)} F`).join(' | ')||'—'}</div>
      <div style="font-size:11px;margin-top:6px"><strong>Observation (${obs.length})</strong>: ${obs.map(v=>`${fmtD(v.created_at)} ${escHtml(v.statut_obs||'EN COURS')}`).join(' | ')||'—'}</div>
    </div>
    <div class="fs"><div class="fs-title">Timeline patient</div>
      <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;background:#fff">
      ${timeline.map(t=>`<div style="padding:6px 0;border-bottom:1px dashed #eee"><span class="badge b-ok" style="margin-right:6px">${t.type}</span><strong>${fmtD(t.dt)} ${fmtT(t.dt)}</strong><br><span style="font-size:11px">${escHtml(t.txt)}</span><div style="margin-top:4px"><button class="btn btn-sm btn-print" onclick="openTimelineDetail('${t.type}','${t.id}')">Ouvrir détail</button></div></div>`).join('')||'<div style="color:#aaa">Aucune activité</div>'}
      </div>
      <div id="chef-timeline-detail" style="margin-top:10px"></div>
    </div>`;
}

function openTimelineDetail(type,id){
  const zone=document.getElementById('chef-timeline-detail');
  if(!zone) return;
  let item=null, html='';
  if(type==='CONSULT'){
    item=DB.get('consultations').find(x=>x.id===id);
    if(!item) return;
    html=`<div class="card"><div class="card-title">Détail consultation</div><div class="recu">
      <div class="recu-line"><span>Date</span><span>${fmtD(item.created_at)} ${fmtT(item.created_at)}</span></div>
      <div class="recu-line"><span>Patient</span><span>${escHtml(item.patient_nom||'—')}</span></div>
      <div class="recu-line"><span>Type</span><span>${escHtml(item.type||'—')}</span></div>
      <div class="recu-line"><span>Praticien</span><span>${escHtml(item.praticien||'—')}</span></div>
      <div style="font-size:11px;margin-top:6px"><strong>Motif:</strong> ${escHtml(item.motif||'—')}</div>
      <div style="font-size:11px;margin-top:6px"><strong>Ordonnance:</strong> ${escHtml(item.ordonnance||'—')}</div>
    </div></div>`;
  } else if(type==='CONST'){
    item=DB.get('constantes').find(x=>x.id===id);
    if(!item) return;
    html=`<div class="card"><div class="card-title">Détail constantes</div><div class="recu">
      <div class="recu-line"><span>Date</span><span>${fmtD(item.created_at)} ${fmtT(item.created_at)}</span></div>
      <div class="recu-line"><span>T°</span><span>${escHtml(item.temperature||'—')} °C</span></div>
      <div class="recu-line"><span>TA</span><span>${escHtml(item.ta||'—')}</span></div>
      <div class="recu-line"><span>SpO2</span><span>${escHtml(item.spo2||'—')} %</span></div>
      <div class="recu-line"><span>IMC</span><span>${escHtml(item.imc||'—')}</span></div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${getAlertFlags(item).map(alertBadge).join('')}</div>
    </div></div>`;
  } else if(type==='SOINS'){
    item=DB.get('soins').find(x=>x.id===id);
    if(!item) return;
    html=`<div class="card"><div class="card-title">Détail soins</div><div class="recu">
      <div class="recu-line"><span>Date</span><span>${fmtD(item.created_at)} ${fmtT(item.created_at)}</span></div>
      <div class="recu-line"><span>Patient</span><span>${escHtml(item.patient_nom||'—')}</span></div>
      <div style="font-size:11px;margin-top:6px"><strong>Actes:</strong> ${escHtml((item.actes||[]).map(a=>a.nom+' x'+a.qte).join(', ')||'—')}</div>
      <div class="recu-line"><span>Total</span><span>${fmt(item.total||0)} F</span></div>
      <div style="font-size:11px;margin-top:6px"><strong>Observations:</strong> ${escHtml(item.observations||'—')}</div>
    </div></div>`;
  } else if(type==='LABO'){
    item=DB.get('labo_actes').find(x=>x.id===id);
    if(!item) return;
    html=`<div class="card"><div class="card-title">Détail labo</div><div class="recu">
      <div class="recu-line"><span>Date</span><span>${fmtD(item.created_at)} ${fmtT(item.created_at)}</span></div>
      <div class="recu-line"><span>Patient</span><span>${escHtml(item.patient_nom||'—')}</span></div>
      <div style="font-size:11px;margin-top:6px"><strong>Actes:</strong> ${escHtml((item.actes||[]).map(a=>a.code).join(', ')||'—')}</div>
      <div class="recu-line"><span>Total</span><span>${fmt(item.total||0)} F</span></div>
      <div style="font-size:11px;margin-top:6px"><strong>Résultat:</strong> ${escHtml(item.resultat||'—')}</div>
    </div></div>`;
  } else if(type==='PHARMA'){
    item=DB.get('pharma_ventes').find(x=>x.id===id);
    if(!item) return;
    html=`<div class="card"><div class="card-title">Détail pharmacie</div><div class="recu">
      <div class="recu-line"><span>Date</span><span>${fmtD(item.created_at)} ${fmtT(item.created_at)}</span></div>
      <div class="recu-line"><span>Patient</span><span>${escHtml(item.patient_nom||'—')}</span></div>
      <div style="font-size:11px;margin-top:6px"><strong>Médicaments:</strong> ${escHtml((item.items||[]).map(i=>i.nom+' x'+i.qte).join(', ')||'—')}</div>
      <div class="recu-line"><span>Total</span><span>${fmt(item.total||0)} F</span></div>
    </div></div>`;
  } else if(type==='OBS'){
    item=DB.get('observations').find(x=>x.id===id);
    if(!item) return;
    html=`<div class="card"><div class="card-title">Détail observation</div><div class="recu">
      <div class="recu-line"><span>Patient</span><span>${escHtml(item.patient_nom||'—')}</span></div>
      <div class="recu-line"><span>Admission</span><span>${fmtD(item.date_admission||item.created_at)}</span></div>
      <div class="recu-line"><span>Sortie</span><span>${item.date_sortie?fmtD(item.date_sortie):'—'}</span></div>
      <div class="recu-line"><span>Statut</span><span>${escHtml(item.statut_obs||'EN COURS')}</span></div>
      <div style="font-size:11px;margin-top:6px"><strong>Motif:</strong> ${escHtml(item.motif||'—')}</div>
      <div style="font-size:11px;margin-top:6px"><strong>Surveillance:</strong> ${(item.surveillance_logs||[]).length} entrée(s)</div>
    </div></div>`;
  }
  zone.innerHTML=html;
}

// CHEF — Statistiques
VIEW['chef-mensuel'] = (el) => {
  const allTx=DB.get('transactions');
  const byDay={};
  allTx.forEach(t=>{
    const d=t.date||t.created_at?.slice(0,10);if(!d)return;
    if(!byDay[d]){byDay[d]={tot:0,cnam:0,enc:0,nb:0,labo:0,pharma:0,accueil:0,soins:0};}
    byDay[d].tot+=t.montant;byDay[d].cnam+=t.cnam;byDay[d].enc+=t.encaisse;byDay[d].nb++;
    byDay[d][t.service?.toLowerCase()]=(byDay[d][t.service?.toLowerCase()]||0)+t.montant;
  });
  const days=Object.keys(byDay).sort();
  const totAll=days.reduce((s,d)=>s+byDay[d].tot,0);
  const totCnam=days.reduce((s,d)=>s+byDay[d].cnam,0);
  el.innerHTML=`
  <div class="g3">
    <div class="kpi" style="border-left-color:var(--marine)"><div class="kpi-ico">💳</div><div class="kpi-lbl">Total (historique)</div><div class="kpi-val" style="font-size:16px;color:var(--marine)">${fmt(totAll)} FCFA</div></div>
    <div class="kpi" style="border-left-color:var(--cmu)"><div class="kpi-ico">🏥</div><div class="kpi-lbl">Total CNAM</div><div class="kpi-val" style="font-size:16px;color:var(--cmu)">${fmt(totCnam)} FCFA</div></div>
    <div class="kpi" style="border-left-color:var(--or)"><div class="kpi-ico">📅</div><div class="kpi-lbl">Jours d'activité</div><div class="kpi-val" style="color:var(--or)">${days.length}</div></div>
  </div>
  <div class="card"><div class="card-title">Évolution (30 derniers jours)</div><canvas id="ch-mensuel-ev"></canvas></div>
  <div class="card">
    <div class="card-title">Tableau détaillé par jour</div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Ops</th><th>Total</th><th>Labo</th><th>Pharma</th><th>Soins</th><th>CNAM</th><th>Encaissé</th><th>Taux</th></tr>
      ${days.slice().reverse().map(d=>{const r=byDay[d],tx=r.tot>0?Math.round(r.cnam/r.tot*100):0;
        return `<tr><td style="font-weight:700">${fmtD(d)}</td><td style="text-align:center">${r.nb}</td>
          <td>${fmt(r.tot)} F</td><td style="color:var(--bleu)">${fmt(r.labo||0)} F</td>
          <td style="color:var(--orang)">${fmt(r.pharmacie||0)} F</td>
          <td style="color:var(--cyan)">${fmt(r.soins||0)} F</td>
          <td style="color:var(--cmu);font-weight:700">${fmt(r.cnam)} F</td>
          <td style="color:var(--or);font-weight:700">${fmt(r.enc)} F</td>
          <td><span class="badge ${tx>=70?'b-ok':tx>=50?'b-warn':'b-err'}">${tx}%</span></td>
        </tr>`;}).join('')||'<tr><td colspan="9" style="text-align:center;color:#aaa">Aucune donnée</td></tr>'}
      ${days.length?`<tr class="tr-tot"><td colspan="2">TOTAL</td><td>${fmt(totAll)} F</td><td></td><td></td><td></td><td>${fmt(totCnam)} F</td><td>${fmt(days.reduce((s,d)=>s+byDay[d].enc,0))} F</td><td>${totAll>0?Math.round(totCnam/totAll*100):0}%</td></tr>`:''}
    </table></div>
  </div>`;
  setTimeout(()=>{
    if(days.length) mkChart('ch-mensuel-ev','line',days.slice(-30),
      [{label:'Total',data:days.slice(-30).map(d=>byDay[d].tot),borderColor:'#0D2B45',backgroundColor:'rgba(13,43,69,.07)',fill:true,tension:.4,pointRadius:3,borderWidth:2},
       {label:'CNAM',data:days.slice(-30).map(d=>byDay[d].cnam),borderColor:'#1A6B3C',backgroundColor:'rgba(26,107,60,.06)',fill:true,tension:.4,pointRadius:3,borderWidth:2},
       {label:'Encaissé',data:days.slice(-30).map(d=>byDay[d].enc),borderColor:'#B8860B',tension:.4,pointRadius:3,borderWidth:2}]);
  },100);
};

// CHEF — Gestion prix (accès exclusif)
VIEW['chef-prix'] = (el) => {
  const stock=DB.getStock();
  el.innerHTML=`
  <div class="al al-info"><strong>Accès exclusif Médecin-Chef</strong>Vous pouvez compléter l'EAN, le dosage, la forme, le conditionnement, l'éligibilité CMU et les prix. Toutes les modifications sont tracées.</div>
  <div class="al al-warn"><strong>Calcul du tarif CMU</strong>Le tarif CMU correspond au prix de cession majoré de 15 % par défaut. Le Médecin-Chef peut modifier cette majoration produit par produit.</div>
  <div class="card">
    <div class="card-title">Paramétrage financier du catalogue</div>
    <div class="tw"><table>
      <tr><th>Code interne</th><th>Produit</th><th>EAN</th><th>Dosage</th><th>Forme</th><th>Conditionnement</th><th>CMU</th><th>Prix acquisition</th><th>Prix cession</th><th>Majoration CMU</th><th>Vente CMU calculée</th><th>Marge bénéficiaire CMU</th><th>Vente hors CMU</th><th>Marge hors CMU</th><th>Seuil</th><th>Action</th></tr>
      ${stock.map((m,i)=>`<tr>
        <td style="font-size:10px">${escHtml(m.code_produit||m.source_product_id||'—')}<div style="font-size:9px;color:var(--muted)">ATC ${escHtml(m.code_atc||'—')}</div></td>
        <td style="font-size:11px;font-weight:700;min-width:180px">${escHtml(m.nom||'—')}<div style="font-size:9px;color:var(--muted)">${escHtml(m.dci||'')}</div></td>
        <td><input type="text" id="ean-${m.id}" value="${escHtml(m.code_ean||'')}" inputmode="numeric" maxlength="14" placeholder="8, 12, 13 ou 14 chiffres" style="width:125px" oninput="this.value=normalizeEan(this.value)"></td>
        <td><input type="text" id="dosage-${m.id}" value="${escHtml(m.dosage||'')}" placeholder="Ex. 500 mg" style="width:105px"></td>
        <td><select id="forme-${m.id}" style="width:145px">${[pharmaForm(m),...PHARMA_FORMS].filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option ${pharmaForm(m)===v?'selected':''}>${escHtml(v)}</option>`).join('')}</select></td>
        <td><select id="pack-${m.id}" style="width:140px">${[canonicalPharmaPack(m.conditionnement||m.unite),...PHARMA_PACKS].filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option ${canonicalPharmaPack(m.conditionnement||m.unite)===v?'selected':''}>${escHtml(v)}</option>`).join('')}</select></td>
        <td><label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cmu-${m.id}" ${m.cmu_eligible?'checked':''} onchange="toggleCmuPrice('${m.id}')"> Éligible</label></td>
        <td><input type="text" inputmode="decimal" id="px-a-${m.id}" value="${+m.px_achat||0}" style="width:85px" oninput="updatePriceMargins('${m.id}')"></td>
        <td><input type="text" inputmode="decimal" id="px-cession-${m.id}" value="${+m.px_cession||0}" style="width:85px" oninput="updatePriceMargins('${m.id}')"></td>
        <td><input type="text" inputmode="decimal" id="cmu-markup-${m.id}" value="${cmuMarkup(m)}" style="width:70px" ${m.cmu_eligible?'':'disabled'} oninput="updatePriceMargins('${m.id}')"> %</td>
        <td><input type="number" id="px-cmu-${m.id}" value="${pxCMU(m)}" readonly style="width:85px;background:#f3f4f6"></td>
        <td id="margin-cmu-${m.id}" style="font-size:10px"></td>
        <td><input type="text" inputmode="decimal" id="px-na-${m.id}" value="${pxNA(m)}" style="width:85px" oninput="updatePriceMargins('${m.id}')"></td>
        <td id="margin-na-${m.id}" style="font-size:10px"></td>
        <td><input type="number" id="seuil-${m.id}" value="${m.seuil}" min="0" style="width:60px;padding:4px;border:1.5px solid var(--border);border-radius:6px"></td>
        <td><button class="btn btn-sm btn-success" onclick="savePrix('${m.id}')">Sauver</button></td>
      </tr>`).join('')}
    </table></div>
    <div class="btn-row">
      <button class="btn btn-warn" onclick="saveAllPrix()">Sauvegarder tous les prix</button>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Sécurité du compte</div>
    <div class="al al-info"><strong>Authentification Supabase</strong>Les mots de passe ne sont jamais stockés dans cette application. Leur modification et la récupération de compte sont administrées dans Supabase Auth.</div>
  </div>`;
  setTimeout(()=>stock.forEach(m=>updatePriceMargins(m.id)),0);
};
function toggleCmuPrice(id){
  const eligible=document.getElementById('cmu-'+id)?.checked===true;
  const markup=document.getElementById('cmu-markup-'+id);
  if(markup)markup.disabled=!eligible;
  updatePriceMargins(id);
}
function updatePriceMargins(id){
  const purchase=numFR(document.getElementById('px-a-'+id)?.value);
  const cmuEligible=document.getElementById('cmu-'+id)?.checked===true;
  const cession=numFR(document.getElementById('px-cession-'+id)?.value);
  const markup=numFR(document.getElementById('cmu-markup-'+id)?.value);
  const cmu=cmuEligible?Math.round(cession*(1+markup/100)):0;
  const nonCmu=numFR(document.getElementById('px-na-'+id)?.value);
  const cmuInput=document.getElementById('px-cmu-'+id);
  if(cmuInput)cmuInput.value=cmu;
  const cmuMargin=productMargin(cmu,purchase);
  const nonCmuMargin=productMargin(nonCmu,purchase);
  const cmuEl=document.getElementById('margin-cmu-'+id);
  const naEl=document.getElementById('margin-na-'+id);
  if(cmuEl){
    cmuEl.textContent=cmuEligible?`${fmt(cmuMargin.amount)} F (${fmt(cmuMargin.rate)}%)`:'—';
    cmuEl.style.color=cmuMargin.amount>=0?'var(--vert)':'var(--rouge)';
  }
  if(naEl){
    naEl.textContent=`${fmt(nonCmuMargin.amount)} F (${fmt(nonCmuMargin.rate)}%)`;
    naEl.style.color=nonCmuMargin.amount>=0?'var(--vert)':'var(--rouge)';
  }
}
function savePrix(id){
  const stock=DB.getStock();
  const idx=stock.findIndex(m=>m.id===id);
  if(idx>=0){
    const ean=normalizeEan(document.getElementById('ean-'+id).value);
    if(!isValidEan(ean)){alert('Code EAN invalide. Vérifiez le nombre de chiffres et la clé de contrôle.');return;}
    if(ean&&stock.some(m=>m.id!==id&&normalizeEan(m.code_ean)===ean)){alert('Ce code EAN est déjà affecté à un autre produit.');return;}
    const before={code_ean:stock[idx].code_ean,dosage:stock[idx].dosage,forme:stock[idx].forme,conditionnement:stock[idx].conditionnement,px_achat:stock[idx].px_achat,px_cession:stock[idx].px_cession,cmu_eligible:stock[idx].cmu_eligible,cmu_markup_pct:cmuMarkup(stock[idx]),px_cmu:pxCMU(stock[idx]),px_na:pxNA(stock[idx]),seuil:stock[idx].seuil};
    stock[idx].code_ean=ean;
    stock[idx].dosage=document.getElementById('dosage-'+id).value.trim();
    stock[idx].forme=canonicalPharmaForm(document.getElementById('forme-'+id).value);
    stock[idx].conditionnement=canonicalPharmaPack(document.getElementById('pack-'+id).value);
    stock[idx].unite=stock[idx].conditionnement;
    stock[idx].px_achat=numFR(document.getElementById('px-a-'+id).value);
    stock[idx].px_cession=numFR(document.getElementById('px-cession-'+id).value);
    stock[idx].cmu_eligible=document.getElementById('cmu-'+id).checked===true;
    stock[idx].cmu_markup_pct=numFR(document.getElementById('cmu-markup-'+id).value);
    stock[idx].px_cmu=stock[idx].cmu_eligible?Math.round(stock[idx].px_cession*(1+stock[idx].cmu_markup_pct/100)):0;
    stock[idx].px_na=numFR(document.getElementById('px-na-'+id).value);
    stock[idx].seuil=+document.getElementById('seuil-'+id).value||0;
    stock[idx].price_status=stock[idx].px_na>0&&(!stock[idx].cmu_eligible||stock[idx].px_cmu>0)?'VALIDE':'A_VALIDER';
    DB.setStock(stock);
    logAudit('CATALOGUE_PRIX_UPDATE',{medicament:stock[idx].nom,med_id:id,before,after:{code_ean:stock[idx].code_ean,dosage:stock[idx].dosage,forme:stock[idx].forme,conditionnement:stock[idx].conditionnement,px_achat:stock[idx].px_achat,px_cession:stock[idx].px_cession,cmu_eligible:stock[idx].cmu_eligible,cmu_markup_pct:stock[idx].cmu_markup_pct,px_cmu:stock[idx].px_cmu,px_na:stock[idx].px_na,seuil:stock[idx].seuil}});
    updatePriceMargins(id);
  }
}
function saveAllPrix(){
  const stock=DB.getStock();
  const eans=new Set();
  for(const m of stock){
    const ean=normalizeEan(document.getElementById('ean-'+m.id)?.value);
    if(!isValidEan(ean)){alert(`EAN invalide pour ${m.nom}. Sauvegarde annulée.`);return;}
    if(ean&&eans.has(ean)){alert(`EAN dupliqué : ${ean}. Sauvegarde annulée.`);return;}
    if(ean)eans.add(ean);
  }
  stock.forEach(m=>{
    const ean=document.getElementById('ean-'+m.id);
    const dosage=document.getElementById('dosage-'+m.id);
    const forme=document.getElementById('forme-'+m.id);
    const pack=document.getElementById('pack-'+m.id);
    const acquisition=document.getElementById('px-a-'+m.id);
    const cession=document.getElementById('px-cession-'+m.id);
    const cmuEligible=document.getElementById('cmu-'+m.id);
    const markup=document.getElementById('cmu-markup-'+m.id);
    const pxna=document.getElementById('px-na-'+m.id);
    const seuil=document.getElementById('seuil-'+m.id);
    if(ean) m.code_ean=normalizeEan(ean.value);
    if(dosage) m.dosage=dosage.value.trim();
    if(forme) m.forme=canonicalPharmaForm(forme.value);
    if(pack){m.conditionnement=canonicalPharmaPack(pack.value);m.unite=m.conditionnement;}
    if(acquisition) m.px_achat=numFR(acquisition.value);
    if(cession) m.px_cession=numFR(cession.value);
    if(cmuEligible) m.cmu_eligible=cmuEligible.checked===true;
    if(markup) m.cmu_markup_pct=numFR(markup.value);
    m.px_cmu=m.cmu_eligible?Math.round((+m.px_cession||0)*(1+cmuMarkup(m)/100)):0;
    if(pxna) m.px_na=+pxna.value||0;
    if(seuil) m.seuil=+seuil.value||0;
    m.price_status=m.px_na>0&&(!m.cmu_eligible||m.px_cmu>0)?'VALIDE':'A_VALIDER';
  });
  DB.setStock(stock);
  logAudit('CATALOGUE_PRIX_UPDATE_BULK',{items:stock.length});
  alert('Le référentiel et les prix ont été sauvegardés ✅');
  showView('chef-prix');
}
// CHEF - Traçabilité (anti-fraude)
VIEW['chef-audit'] = (el) => {
  const logs=DB.get('audit_logs');
  const q=(document.getElementById('audit-search')?.value||'').toLowerCase();
  const dateFilter=document.getElementById('audit-date')?.value||'';
  const agentFilter=document.getElementById('audit-agent')?.value||'';
  const actionFilter=document.getElementById('audit-action')?.value||'';
  const actions=[...new Set(logs.map(l=>l.action).filter(Boolean))].sort();
  const agents=[...new Set(logs.map(l=>l.agent_nom).filter(Boolean))].sort();
  const filtered=logs.filter(l=>{
    if(q && !JSON.stringify(l).toLowerCase().includes(q)) return false;
    if(dateFilter && (l.date||l.created_at?.slice(0,10))!==dateFilter) return false;
    if(agentFilter && (l.agent_nom||'')!==agentFilter) return false;
    if(actionFilter && (l.action||'')!==actionFilter) return false;
    return true;
  }).slice(0,500);
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Journal d'audit central (${filtered.length})</div>
    <div class="al al-info"><strong>Traçabilité Médecin-Chef</strong>Toutes les opérations sensibles sont horodatées avec agent, action et détails.</div>
    <div class="fr no-print" style="margin-bottom:10px">
      <label>Recherche</label><input type="text" id="audit-search" placeholder="Agent, action, patient, médicament..." oninput="showView('chef-audit')">
      <label>Date</label><input type="date" id="audit-date" value="${dateFilter}" onchange="showView('chef-audit')">
      <label>Agent</label>
      <select id="audit-agent" onchange="showView('chef-audit')">
        <option value="">Tous</option>
        ${agents.map(a=>`<option value="${escHtml(a)}" ${agentFilter===a?'selected':''}>${escHtml(a)}</option>`).join('')}
      </select>
      <label>Action</label>
      <select id="audit-action" onchange="showView('chef-audit')">
        <option value="">Toutes</option>
        ${actions.map(a=>`<option value="${escHtml(a)}" ${actionFilter===a?'selected':''}>${escHtml(a)}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm" onclick="exportCSV('audit_logs','audit_'+today()+'.csv')">📥 Export audit (CSV)</button>
    </div>
    <div class="tw"><table>
      <tr><th>Date</th><th>Heure</th><th>Agent</th><th>Rôle</th><th>Action</th><th>Détails</th></tr>
      ${filtered.map(l=>`<tr>
        <td>${fmtD(l.created_at||l.date)}</td>
        <td>${l.heure||fmtT(l.created_at)}</td>
        <td style="font-size:11px">${escHtml(l.agent_nom||'—')}</td>
        <td style="font-size:10px;color:var(--muted)">${escHtml(l.role||'—')}</td>
        <td><span class="badge ${l.action==='CLOTURE_REJETEE'?'b-err':'b-warn'}">${escHtml(l.action||'—')}</span></td>
        <td style="font-size:10px">${escHtml(JSON.stringify(l.details||{}))}</td>
      </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:#aaa">Aucune trace</td></tr>'}
    </table></div>
  </div>`;
};

// CHEF — Exports
VIEW['chef-exports'] = (el) => {
  el.innerHTML=`
  <div class="card">
    <div class="card-title">Exports des données</div>
    <div class="g2">
      <button class="btn btn-primary" style="padding:14px" onclick="exportCSV('transactions','transactions_'+today()+'.csv')">📥 Transactions (CSV)</button>
      <button class="btn btn-primary" style="padding:14px" onclick="exportCSV('labo_actes','biologie_cmu_'+today()+'.csv')">📥 Biologie CMU (CSV)</button>
      <button class="btn btn-primary" style="padding:14px" onclick="exportCSV('consultations','consultations_'+today()+'.csv')">📥 Consultations (CSV)</button>
      <button class="btn btn-primary" style="padding:14px" onclick="exportCSV('pharma_ventes','pharmacie_'+today()+'.csv')">📥 Pharmacie (CSV)</button>
      <button class="btn btn-primary" style="padding:14px" onclick="exportCSV('soins','soins_'+today()+'.csv')">📥 Soins infirmiers (CSV)</button>
      <button class="btn btn-primary" style="padding:14px" onclick="exportCSV('clotures','clotures_'+today()+'.csv')">📥 Clôtures (CSV)</button>
      <button class="btn btn-primary" style="padding:14px" onclick="exportCSV('audit_logs','audit_'+today()+'.csv')">📥 Audit (CSV)</button>
    </div>
    <hr style="margin:14px 0;border-color:var(--border)">
    <div class="al al-warn"><strong>⚠️ Zone de réinitialisation</strong>Ces actions sont irréversibles.</div>
    <div class="btn-row">
      <button class="btn btn-danger" onclick="clearData()">Réinitialiser toutes les données</button>
    </div>
  </div>`;
};
function exportCSV(table,filename){
  const data=DB.get(table);
  if(!data.length){alert('Aucune donnée');return;}
  const keys=Object.keys(data[0]);
  const csv=[keys.join(','),...data.map(row=>keys.map(k=>{const v=row[k];if(typeof v==='object')return '"'+JSON.stringify(v).replace(/"/g,'""')+'"';return '"'+(v||'').toString().replace(/"/g,'""')+'"';}).join(','))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download=filename;a.click();
}
function clearData(){
  if(!confirm('Supprimer TOUTES les données ? Irréversible.'))return;
  logAudit('DATA_RESET_REQUEST',{by:CURRENT_AGENT?.nom||'?'});
  ['patients','consultations','constantes','transactions','labo_actes','soins','observations','pharma_ventes','clotures','audit_logs'].forEach(k=>localStorage.removeItem('csa2_'+k));
  localStorage.removeItem('csa2_sq');SYNC_Q=[];
  alert('Données réinitialisées'); location.reload();
}

// ════════════════════════════════════════════════════════
// SYNC & ONLINE
// ════════════════════════════════════════════════════════
function updateSyncStatus(){
  const dot=document.getElementById('sync-dot');
  const lbl=document.getElementById('sync-lbl');
  const bar=document.getElementById('notif-bar');
  if(!dot||!lbl||!bar) return;
  if(!supa){
    dot.className='sync-dot off';
    lbl.textContent='Cloud OFF';
    bar.style.display='block';
    bar.textContent='⚠ Synchronisation cloud non configurée';
    return;
  }
  if(!IS_ONLINE){
    dot.className='sync-dot off';
    lbl.textContent='Hors ligne';
    bar.style.display='block';
    bar.textContent='⚠ Hors connexion — Données en attente de synchronisation';
    return;
  }
  const pending=SYNC_Q.length;
  if(LAST_SYNC_ERROR){
    dot.className='sync-dot off';
    lbl.textContent=`Erreur sync${pending?` (${pending})`:''} — réessayer`;
    bar.style.display='block';
    bar.textContent=`⚠ Erreur de synchronisation (${pending} en attente): ${LAST_SYNC_ERROR}. Cliquez sur l'état pour réessayer.`;
    return;
  }
  if(IS_SYNCING){
    dot.className='sync-dot sync';
    lbl.textContent=`Sync...${pending?` (${pending})`:''}`;
    bar.style.display='none';
    return;
  }
  if(pending>0){
    dot.className='sync-dot sync';
    lbl.textContent=`${pending} à synchroniser`;
    bar.style.display='none';
    return;
  }
  dot.className='sync-dot';
  lbl.textContent='En ligne';
  bar.style.display='none';
}
// Relance manuelle de la synchronisation (clic sur l'état dans la barre)
function retrySync(){
  if(!IS_ONLINE){alert('Hors connexion — réessayez une fois reconnecté.');return;}
  if(!supa){alert('Synchronisation cloud non configurée.');return;}
  LAST_SYNC_ERROR=null;
  updateSyncStatus();
  syncQueue();
}
function toCloudRow(op){
  return {
    event_key:`${op.table}:${op.item.id||Date.now()}`,
    table_name:op.table,
    item_id:String(op.item.id||''),
    payload:{...op.item,synced:true},
    created_at:op.item.created_at||new Date().toISOString(),
    agent_id:op.item.agent_id||CURRENT_AGENT?.id||null,
    agent_nom:op.item.agent_nom||CURRENT_AGENT?.nom||null,
    updated_at:new Date().toISOString(),
  };
}
async function pushCloudRow(row, baseVersion){
  // Tables EN INSERTION SEULE (audit_logs, consultations, soins, constantes,
  // labo_actes, transactions, clotures, pharma_ventes, pharma_mouvements...) :
  // INSERT simple. Un doublon (même event_key déjà enregistré) = déjà
  // synchronisé -> succès. On n'essaie JAMAIS d'UPDATE ces tables (la policy
  // UPDATE les interdit : 42501). C'est ce qui bloquait la file.
  if(!MUTABLE_TABLES.includes(row.table_name)){
    const ins=await supa.from(CLOUD_TABLE).insert(row);
    if(!ins.error) return {ok:true};
    if(String(ins.error.code||'')==='23505') return {ok:true,fallback:'duplicate_ignored'};
    return {ok:false,error:ins.error};
  }
  // Tables MODIFIABLES (patients, observations, pharma_stock/lots/inventaires,
  // sevci_pvvih) : upsert (la policy UPDATE l'autorise).
  const upsertRes = await supa.from(CLOUD_TABLE).upsert(row,{onConflict:'event_key'});
  if(!upsertRes.error) return {ok:true};
  const code = String(upsertRes.error.code||'');
  if(code==='23505') return {ok:true,fallback:'duplicate_ignored'};
  return {ok:false,error:upsertRes.error};
}
async function syncQueue(){
  if(!supa||!CURRENT_AGENT||!IS_ONLINE||!SYNC_Q.length||IS_SYNCING)return;
  IS_SYNCING=true;
  updateSyncStatus();
  try{
    const done=[];
    for(const op of SYNC_Q.slice(0,50)){
      const row=toCloudRow(op);
      const res=await pushCloudRow(row, op.item.entity_version);
      if(res.conflict){
        addConflict(op,res.serverVersion,res.serverPayload);
        done.push(op); // retirer de la file : on ne réécrase pas, on parque le conflit
        continue;
      }
      if(!res.ok){
        LAST_SYNC_ERROR=res.error?.message||'Erreur Supabase';
        break;
      }
      done.push(op);
      const localRows=DB.get(op.table);
      const local=localRows.find(item=>String(item.id)===String(op.item.id));
      if(local){
        local.synced=true;
        local.updated_at=row.updated_at;
        DB.set(op.table,localRows);
      }
    }
    SYNC_Q=SYNC_Q.filter(o=>!done.includes(o));
    localStorage.setItem('csa2_sq',JSON.stringify(SYNC_Q));
    if(done.length>0 && SYNC_Q.length===0) LAST_SYNC_ERROR='';
  }catch(e){
    LAST_SYNC_ERROR=(e&&e.message)?e.message:'Erreur de synchronisation';
  }finally{
    IS_SYNCING=false;
    updateSyncStatus();
    if(IS_ONLINE&&SYNC_Q.length&&!LAST_SYNC_ERROR) setTimeout(syncQueue,0);
  }
}
// ── Conflits de synchronisation (anti-écrasement, Phase 1.3b) ──
function saveConflicts(){ localStorage.setItem('csa2_conflicts', JSON.stringify(CONFLICTS)); }
function addConflict(op, serverVersion, serverPayload){
  CONFLICTS = CONFLICTS.filter(c=>!(c.table===op.table && String(c.item_id)===String(op.item.id)));
  CONFLICTS.push({cid:newClientEventId(), table:op.table, item_id:op.item.id, local:op.item, serverVersion:serverVersion, serverPayload:serverPayload||{}, at:new Date().toISOString()});
  saveConflicts(); showConflictBanner();
  logAudit('SYNC_CONFLICT',{table:op.table,item:op.item.id,serverVersion});
}
function showConflictBanner(){
  let b=document.getElementById('csa-conflict-banner');
  if(!CONFLICTS.length){ if(b) b.remove(); return; }
  if(!b){
    b=document.createElement('div'); b.id='csa-conflict-banner';
    b.style.cssText='position:fixed;left:0;right:0;top:0;background:#8B1A1A;color:#fff;padding:10px 14px;text-align:center;z-index:2100;font-size:13px;font-weight:700;cursor:pointer';
    b.onclick=openConflicts; document.body.appendChild(b);
  }
  b.textContent='⚠ '+CONFLICTS.length+' conflit(s) de synchronisation — cliquer pour résoudre';
}
function conflictSummary(p){
  try{ return Object.entries(p||{}).filter(([k])=>!['synced','entity_version','client_event_id','agent_id'].includes(k))
        .slice(0,6).map(([k,v])=>k+': '+String(v).slice(0,30)).join(' | '); }catch(e){ return ''; }
}
function openConflicts(){
  const ex=document.getElementById('csa-conflict-overlay'); if(ex) ex.remove();
  const o=document.createElement('div'); o.id='csa-conflict-overlay';
  o.style.cssText='position:fixed;inset:0;background:rgba(15,32,56,.55);z-index:2200;overflow-y:auto;padding:20px';
  o.innerHTML='<div style="max-width:760px;margin:0 auto;background:#fff;border-radius:10px;padding:18px">'
    +'<h3 style="color:#8B1A1A;margin-bottom:6px">Conflits de synchronisation</h3>'
    +'<p style="font-size:12px;color:#667084;margin-bottom:12px">Une version plus récente existe déjà sur le serveur. Choisissez pour chaque cas — aucune donnée n\'est perdue avant votre choix.</p>'
    +CONFLICTS.map(c=>'<div style="border:1px solid #e0a0a0;border-radius:8px;padding:10px;margin-bottom:10px">'
        +'<div style="font-weight:700;font-size:12px">'+escHtml(c.table)+' — '+escHtml(String(c.item_id))+'</div>'
        +'<div style="font-size:11px;margin-top:6px"><strong>Votre version :</strong> '+escHtml(conflictSummary(c.local))+'</div>'
        +'<div style="font-size:11px;margin-top:2px"><strong>Serveur (v'+escHtml(String(c.serverVersion))+') :</strong> '+escHtml(conflictSummary(c.serverPayload))+'</div>'
        +'<div class="btn-row" style="margin-top:8px">'
          +'<button class="btn btn-ghost btn-sm" onclick="resolveConflict(\''+c.cid+'\',\'server\')">Garder la version serveur</button> '
          +'<button class="btn btn-primary btn-sm" onclick="resolveConflict(\''+c.cid+'\',\'local\')">Forcer ma version</button>'
        +'</div></div>').join('')
    +'<div class="btn-row" style="justify-content:flex-end"><button class="btn btn-ghost" onclick="this.closest(\'#csa-conflict-overlay\').remove()">Fermer</button></div>'
    +'</div>';
  document.body.appendChild(o);
}
function resolveConflict(cid, choice){
  const c=CONFLICTS.find(x=>x.cid===cid); if(!c) return;
  const arr=DB.get(c.table); const i=arr.findIndex(it=>String(it.id)===String(c.item_id));
  if(choice==='server'){
    const srv={...c.serverPayload, synced:true, entity_version:c.serverVersion};
    if(i>=0) arr[i]=srv; else arr.unshift(srv);
    DB.set(c.table, arr);
  } else { // forcer : repartir de la version serveur pour pouvoir réécrire
    const forced={...c.local, entity_version:c.serverVersion, synced:false};
    if(i>=0) arr[i]=forced; else arr.unshift(forced);
    DB.set(c.table, arr);
    queueSync(c.table, forced);
  }
  CONFLICTS=CONFLICTS.filter(x=>x.cid!==cid); saveConflicts();
  logAudit('SYNC_CONFLICT_RESOLVED',{table:c.table,item:c.item_id,choice});
  showConflictBanner();
  const o=document.getElementById('csa-conflict-overlay'); if(o){ o.remove(); if(CONFLICTS.length) openConflicts(); }
  if(choice==='local'&&IS_ONLINE&&supa) syncQueue();
}

async function pullFromCloud(){
  if(!supa||!CURRENT_AGENT||!IS_ONLINE) return;
  try{
    const {data,error}=await supa
      .from(CLOUD_TABLE)
      .select('table_name,item_id,payload,created_at,updated_at')
      .order('updated_at',{ascending:false})
      .limit(20000);
    if(error||!Array.isArray(data)) return;
    SYNC_TABLES.forEach(table=>{
      const rows=data.filter(r=>r.table_name===table&&r.payload&&typeof r.payload==='object');
      if(!rows.length) return;
      const remoteById=new Map();
      rows.forEach(r=>{
        const id=String(r.item_id||r.payload.id||'');
        if(!id) return;
        if(!remoteById.has(id) || String(r.updated_at||'')>String(remoteById.get(id).updated_at||'')){
          remoteById.set(id,{payload:{...r.payload,synced:true},updated_at:r.updated_at});
        }
      });
      const localRows=DB.get(table);
      const mergedById=new Map();
      localRows.forEach(item=>{
        const id=String(item.id||'');
        if(!id){return;}
        if(item.synced===false){
          mergedById.set(id,item);
        } else if(remoteById.has(id)){
          mergedById.set(id,remoteById.get(id).payload);
          remoteById.delete(id);
        } else {
          mergedById.set(id,item);
        }
      });
      remoteById.forEach((remote,id)=> mergedById.set(id,remote.payload));
      const merged=Array.from(mergedById.values()).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
      DB.set(table,merged);
    });
    LAST_SYNC_ERROR='';
    updateSyncStatus();
  }catch(e){
    LAST_SYNC_ERROR=(e&&e.message)?e.message:'Lecture cloud impossible';
    updateSyncStatus();
  }
}
window.addEventListener('online',()=>{IS_ONLINE=true;updateSyncStatus();syncNow();});
window.addEventListener('offline',()=>{IS_ONLINE=false;updateSyncStatus();});
// Synchro immédiate quand l'utilisateur ouvre/revient sur l'app (essentiel sur
// téléphone où les minuteries sont ralenties en arrière-plan).
function syncNow(){ if(IS_ONLINE&&supa&&CURRENT_AGENT){ pullFromCloud(); syncQueue(); } }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') syncNow(); });
window.addEventListener('focus', syncNow);

// ════════════════════════════════════════════════════════
// HORLOGE
// ════════════════════════════════════════════════════════
function tick(){
  const el=document.getElementById('clock-top');
  if(el) el.textContent=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function applyInstitutionLogo(){
  const bind=(imgId,fallbackId)=>{
    const img=document.getElementById(imgId);
    const fb=document.getElementById(fallbackId);
    if(!img) return;
    img.src=INSTITUTION_LOGO_URL;
    img.onerror=()=>{img.style.display='none'; if(fb) fb.style.display='inline-block';};
    img.onload=()=>{img.style.display='block'; if(fb) fb.style.display='none';};
  };
  bind('auth-logo','auth-logo-fallback');
  bind('top-logo','top-logo-fallback');
}
function applyCompactMode(){
  document.body.classList.toggle('compact',COMPACT_MODE);
  const btn=document.getElementById('compact-toggle');
  if(btn){
    btn.classList.toggle('active',COMPACT_MODE);
    btn.textContent=COMPACT_MODE?'Compact ON':'Compact';
  }
}
function toggleCompactMode(){
  COMPACT_MODE=!COMPACT_MODE;
  localStorage.setItem('csa2_compact',COMPACT_MODE?'1':'0');
  applyCompactMode();
}
setInterval(tick,1000);tick();

// ════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════
if(SUPABASE_URL&&!SUPABASE_URL.includes('VOTRE_PROJET')&&window.supabase){
  try{supa=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);}catch(e){}
}
if(localStorage.getItem('csa_security_v2')!=='1'&&SYNC_Q.length===0){
  clearLocalClinicalData();
  localStorage.setItem('csa_security_v2','1');
}
applyInstitutionLogo();
applyCompactMode();
updateSyncStatus();
if(supa){
  supa.auth.onAuthStateChange((event,session)=>{
    setTimeout(async()=>{
      if(event==='SIGNED_OUT'){
        CURRENT_AGENT=null;
        document.getElementById('app').style.display='none';
        document.getElementById('auth-screen').style.display='flex';
        document.getElementById('auth-submit').disabled=false;
        return;
      }
      if(session&&!CURRENT_AGENT) await loadAuthenticatedProfile(session);
    },0);
  });
  supa.auth.getSession().then(({data})=>{
    if(data.session) loadAuthenticatedProfile(data.session);
  });
}else{
  document.getElementById('auth-error').textContent='Service sécurisé indisponible.';
  document.getElementById('auth-submit').disabled=true;
}
setInterval(syncQueue,30000);
setInterval(pullFromCloud,60000);

// ════════════════════════════════════════════════════════
// MISE À JOUR AUTOMATIQUE (PWA) — sans manip technique pour l'utilisateur.
// Grâce au service worker « réseau d'abord », chaque ouverture de l'app charge
// déjà la dernière version. Si une nouvelle version arrive pendant que l'app
// reste ouverte, on affiche un simple bouton « Mettre à jour ».
// ════════════════════════════════════════════════════════
function showUpdateBanner(){
  if(document.getElementById('csa-update-banner')) return;
  const b=document.createElement('div');
  b.id='csa-update-banner';
  b.style.cssText='position:fixed;left:0;right:0;bottom:0;background:#1A6B3C;color:#fff;padding:12px 14px;text-align:center;z-index:2000;font-size:14px;font-weight:600;box-shadow:0 -2px 10px rgba(0,0,0,.25)';
  b.innerHTML='Une nouvelle version est disponible. <button id="csa-update-btn" style="margin-left:10px;background:#fff;color:#1A6B3C;border:none;border-radius:6px;padding:7px 16px;font-weight:700;cursor:pointer">Mettre à jour</button>';
  document.body.appendChild(b);
  document.getElementById('csa-update-btn').onclick=()=>location.reload();
}
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(reg=>{
    setInterval(()=>{ try{reg.update();}catch(e){} }, 30*60*1000);
    if(reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;
      if(nw) nw.addEventListener('statechange',()=>{
        if(nw.state==='installed' && navigator.serviceWorker.controller) showUpdateBanner();
      });
    });
  }).catch(()=>{});
  let __reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(__reloaded) return; __reloaded=true; showUpdateBanner();
  });
}
