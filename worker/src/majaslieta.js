/* SH | Mājas lieta — viss par māju vienuviet: kadastra dati (no kadastrs.lv caur Safari pogu + AI), dokumenti (R2), darbu vēsture no visām lietotnēm. © VAITKEVIX, SIA
 * Maršruts POST /ml { pin, action, … }. Lomas portālā: perms.ml = admin | vaditajs | skatitajs; portāla admins = admin.
 * Savas tabulas ml_kad, ml_doc, ml_log. Citu lietotņu tabulas tikai lasa.
 * Objekti (agrāk portāla Administrēšana → Objekti) — rediģē tikai ml admin; saglabāšana iet caur TO PAŠU loģiku:
 * X.adm(action) = index.js masterAdmin (saveObjects, objInfoSave, objSvcBulk, objParvBulk), objinfo.js — tabulas objects, obj_info, dl_obj. */
import { personByPin, people } from './portal.js';
import { master } from './master.js';
import * as objinfo from './objinfo.js';
import { aiCall } from './ai.js';
import { today, nowStr, anorm, akey, CORS, out, cleanAddr } from './util.js';

export const KEY = 'ml', NAME = 'Mājas lieta';
const ROLE_W = { admin: 3, vaditajs: 2, skatitajs: 0 };
const IMG = 'https://vaitkevix.cloud/sh/api/img?sz=w1600&id=';
const MAX_DOC = 10e6, MAX_RAW = 40000, MAX_KAD = 200000;
const DOC_TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'Bilde', 'image/png': 'Bilde', 'image/webp': 'Bilde', 'image/heic': 'Bilde', 'image/heif': 'Bilde',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word', 'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel', 'application/vnd.ms-excel': 'Excel' };
const DOC_KINDS = ['Kadastrs', 'Līgums', 'Akts', 'Plāns / rasējums', 'Tehniskā dokumentācija', 'Cits'];

export async function cron() {}   // nav plānoto darbu

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const log = (db, t) => db.prepare('INSERT INTO ml_log (laiks, teksts) VALUES (?, ?)').bind(nowStr(), String(t).slice(0, 300)).run();
/** dd.mm.yyyy [hh:mm] → yyyy-mm-dd (citādi kā ir) */
const iso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : String(s || '').slice(0, 10); };
const fotos = (v) => String(v || '').split(/[\s,]+/).filter(Boolean).map(x => /^https?:/.test(x) ? x : /^[\w-]{20,80}$/.test(x) ? IMG + x : '').filter(Boolean).slice(0, 6);

/* Darbu vēsture: visas lietotnes, jaunākie pirmie */
const VISITS = [['pl_visit', 'pl', 'Zāles pļaušana'], ['logi_visit', 'logi', 'Logu mazgāšana'], ['darz_visit', 'darz', 'Dārzniecība'], ['stav_visit', 'stav', 'Pazemes stāvvieta'], ['sniegs_visit', 'sniegs', 'Sniega tīrīšana']];
const VST = { plan: 'Plānots', done: 'Izpildīts', cant: 'Nevarēja', skip: 'Izlaists', moved: 'Pārcelts' };
async function history(db, k, adrese, pre) {   // pre = { izv, kais } — vienreiz nolasītas tabulas (apvienotajiem objektiem)
  const t = today(), ak = akey(adrese), rows = [];
  pre = pre || {};
  for (const [tbl, app, name] of VISITS) {
    (await all(db, 'SELECT datums, statuss, izpilditajs, foto, iemesls, piezime FROM ' + tbl + " WHERE anorm = ? AND (statuss != 'plan' OR datums >= ?) ORDER BY datums DESC LIMIT 60", k, t).catch(() => []))
      .forEach(r => rows.push({ app, name, datums: r.datums, statuss: VST[r.statuss] || r.statuss, kas: r.izpilditajs || '', teksts: [r.piezime, r.iemesls].filter(Boolean).join(' · '), foto: fotos(r.foto), plan: r.statuss === 'plan' }));
  }
  (await all(db, 'SELECT datums, tips, apraksts, statuss, brigade, foto, komentars, iemesls FROM jobs WHERE anorm = ? OR lower(adrese) = lower(?) ORDER BY datums DESC LIMIT 80', k, adrese).catch(() => []))
    .forEach(r => rows.push({ app: 'aizv', name: 'Aizvietošana' + (r.tips ? ' · ' + r.tips : ''), datums: r.datums, statuss: r.statuss, kas: r.brigade || '', teksts: [r.apraksts, r.komentars, r.iemesls].filter(Boolean).join(' · '), foto: fotos(r.foto) }));
  // Izvešana un Kaisāmmateriāls glabā tikai adresi → salīdzina pēc normalizētas adreses
  if (!pre.izv) pre.izv = await all(db, "SELECT datums, adrese, maisi, statuss, sia, m3, izv_kom, foto_pec, problema FROM izv_task WHERE statuss != 'Dzēsts'").catch(() => []);
  if (!pre.kais) pre.kais = await all(db, 'SELECT datums, adrese, materials, statuss, kurjers, piegadati, kurj_kom, foto_pec FROM kais_task').catch(() => []);
  pre.izv
    .filter(r => akey(r.adrese) === ak).forEach(r => rows.push({ app: 'izv', name: 'Izvešana' + (r.maisi ? ' · ' + r.maisi : ''), datums: iso(r.datums), statuss: r.statuss, kas: r.sia || '',
      teksts: [r.m3 ? r.m3 + ' m³' : '', r.izv_kom, r.problema].filter(Boolean).join(' · '), foto: fotos(r.foto_pec) }));
  pre.kais
    .filter(r => akey(r.adrese) === ak).forEach(r => rows.push({ app: 'kais', name: 'Kaisāmmateriāls' + (r.materials ? ' · ' + r.materials : ''), datums: iso(r.datums), statuss: r.statuss, kas: r.kurjers || '',
      teksts: [r.piegadati ? r.piegadati + ' maisi' : '', r.kurj_kom].filter(Boolean).join(' · '), foto: fotos(r.foto_pec) }));
  return rows.sort((a, b) => String(b.datums).localeCompare(String(a.datums))).slice(0, 300);
}

/* Kadastrs: AI no kadastrs.lv lapas teksta → strukturēti dati */
const KAD_SYSTEM = 'Tu no Latvijas Kadastra informācijas sistēmas (kadastrs.lv) lapas teksta izvelc datus par nekustamo īpašumu. ' +
  'Atbildi TIKAI ar JSON, bez paskaidrojumiem. Neizdomā: ja vērtības tekstā nav, liec null. Skaitļus raksti kā skaitļus (bez mērvienībām), datumus kā tekstā. Neiekļauj fizisku personu vārdus, personas kodus un īpašnieku datus.';
const KAD_SHAPE = '{"kadastra_nr":"…","adrese":"…","nosaukums":"…","zeme":{"apzimejums":"…","platiba_m2":0,"lietosanas_merkis":"…"},' +
  '"buves":[{"apzimejums":"…","nosaukums":"…","lietosanas_veids":"…","virszemes_stavi":0,"pazemes_stavi":0,"kopplatiba_m2":0,"apbuves_laukums_m2":0,"buvtilpums_m3":0,' +
  '"dzivokli":0,"telpu_grupas":0,"ekspluatacijas_gads":0,"arsienu_materials":"…","jumta_segums":"…","nolietojums_proc":0}],' +
  '"kadastrala_vertiba_eur":0,"vertibas_datums":"…","citi":{"nosaukums":"vērtība"}}';
function matchObj(objs, adr) {
  const a = akey(adr); if (!a) return [];
  const num = (a.match(/\d+[a-z]?(?:\s?k-?\d+)?/) || [''])[0], words = a.replace(/\d.*$/, '').trim().split(' ').filter(w => w.length > 2);
  return objs.map(o => { const b = akey(o.adrese); let s = 0;
    if (b === a) s = 100; else { if (num && new RegExp('(^|\\s)' + num.replace(/\s/g, '\\s?') + '(\\s|$)').test(b)) s += 40; words.forEach(w => { if (b.indexOf(w) !== -1) s += 20; }); }
    return { adrese: o.adrese, anorm: o.anorm, s }; }).filter(x => x.s >= 50).sort((x, y) => y.s - x.s).slice(0, 5);
}
/* ---------- Apvienotie objekti: «Aglonas 11 / Prūšu 4b», «Dumbrāja 18, 18 k-1, 18 k-2» — vairākas mājas zem vienas adreses.
 * Adrese visur paliek tāda pati; šeit tikai parāda, no kurām mājām tas sastāv. Admins var norādīt ar roku (ml_parts). */
const PFX = /^\s*([A-ZĀČĒĢĪĶĻŅŠŪŽ]{1,4}\s*\|\s*)/;
export function splitAddr(a) {
  let s = String(a || '').trim(); const pm = s.match(PFX), pfx = pm ? pm[1] : ''; if (pm) s = s.slice(pm[0].length);
  const raw = s.split(/\s+\/\s+|\s*;\s*|\s*,\s*/).map(x => x.trim()).filter(x => x && !/^(lv-?\s?\d{4}|rīga|riga|latvija)$/i.test(x));   // «24/26» = viena māja
  if (raw.length < 2) return [];
  let street = '', base = ''; const out = [];
  for (const p of raw) {
    if (!/\d/.test(p) || /st[āa]v|^(dz|dzīv|kv|telpa)\b\.?|^\d+\.\s/i.test(p)) return [];   // «2. stāvs», «dz. 3» — nav cita māja
    if (/^k-?\s*\d/i.test(p)) { if (!base) return []; out.push(base + ' k-' + p.replace(/^k-?\s*/i, '')); }   // «Jomas 57, k-1», «K2»
    else if (/^\d/.test(p)) { if (!street) return []; const x = street + ' ' + p; out.push(x); base = x.replace(/\s+k-?\s*\d+\S*$/i, ''); }
    else { street = p.replace(/\s+\d[^\s]*(\s+k-?\s*\d+\S*)?$/i, '').trim(); out.push(p); base = p.replace(/\s+k-?\s*\d+\S*$/i, ''); }
  }
  // «Jomas 57, k-1» — viena māja ar korpusu, nevis apvienojums; apvienots tikai, ja ≥2 dažādi numuri vai ≥2 korpusi
  const nums = new Set(out.map(x => x.replace(/\s+k-?\s*\d+\S*$/i, '').toLowerCase())), ks = out.filter(x => /\sk-?\s*\d/i.test(x)).length;
  if (nums.size < 2 && ks < 2) return [];
  return out.map(x => ({ adrese: x, pfx }));
}
function partsOf(objs, manual) {   // → { anorm: [{ adrese, anorm }] } tikai apvienotajiem
  const byK = {}, byA = {}; objs.forEach(o => { byK[o.anorm] = o; const k = akey(o.adrese); if (k && !byA[k]) byA[k] = o; });
  const find = (x, pfx) => byK[anorm(pfx + x)] || byK[anorm(x)] || byA[akey(x)] || null;
  const res = {};
  objs.forEach(o => {
    const m = manual[o.anorm]; let L;
    if (m && m !== 'auto') { try { L = JSON.parse(m).map(x => ({ adrese: String(x), pfx: '' })); } catch (e) { L = []; } }
    else L = splitAddr(o.adrese);
    if (L.length < (m && m !== 'auto' ? 1 : 2)) return;
    const R = L.map(x => { const f = find(x.adrese, x.pfx); return f ? (f.anorm === o.anorm ? null : { adrese: f.adrese, anorm: f.anorm }) : { adrese: x.adrese, anorm: '' }; }).filter(Boolean);   // pašnorāde nav sastāvdaļa
    if (R.length >= (m && m !== 'auto' ? 1 : 2)) res[o.anorm] = R;
  });
  return res;
}
const manualParts = async (db) => { const m = {}; (await all(db, 'SELECT anorm, parts FROM ml_parts').catch(() => [])).forEach(r => m[r.anorm] = r.parts); return m; };

/* Darba laika kods apvienotajiem: kods ir apvienotajam objektam (dl_obj.kods ir UNIQUE), sastāvdaļas to manto.
 * dlInherit → { sastāvdaļas anorm: { kods, adrese, anorm } }; dlSync(k) — ja k apvienots ar kodu, sastāvdaļu savi kodi izslēgti (aktivs=0, rindas paliek). */
export async function dlInherit(db) {
  const objs = await all(db, 'SELECT anorm, adrese FROM objects'), P = partsOf(objs, await manualParts(db)), byK = {}, res = {};
  objs.forEach(o => byK[o.anorm] = o.adrese);
  const codes = {}; (await all(db, 'SELECT anorm, kods FROM dl_obj WHERE aktivs = 1').catch(() => [])).forEach(r => codes[r.anorm] = r.kods);
  for (const k of Object.keys(P)) if (codes[k]) P[k].forEach(x => { if (x.anorm && !res[x.anorm]) res[x.anorm] = { kods: codes[k], adrese: byK[k] || k, anorm: k }; });
  return res;
}
export async function dlSync(db, k) {
  const objs = await all(db, 'SELECT anorm, adrese FROM objects'), L = (partsOf(objs, await manualParts(db))[k] || []).map(x => x.anorm).filter(Boolean);
  const own = await db.prepare('SELECT kods FROM dl_obj WHERE anorm = ? AND aktivs = 1').bind(k).first();
  if (!own || !L.length) return 0;
  await db.batch(L.map(a => db.prepare('UPDATE dl_obj SET aktivs = 0 WHERE anorm = ? AND aktivs = 1').bind(a)));
  return L.length;
}

/* Apvienotie objekti visām lietotnēm: GET …/sh/api/apv.js — skripts ar sarakstu (tikai adreses un sastāvdaļas, bez kodiem/personām).
 * Lietotne to ielādē ar <script src defer>; skripts pie katra elementa, kura teksts = apvienotā adrese, pieliek kapsulu «Apvienots». */
export async function apvList(db) {
  const objs = await all(db, 'SELECT anorm, adrese FROM objects'), P = partsOf(objs, await manualParts(db)), byK = {};
  objs.forEach(o => byK[o.anorm] = o.adrese);
  return Object.keys(P).filter(k => byK[k]).map(k => ({ a: byK[k], p: P[k].map(x => x.adrese) }));
}
const APV_JS = `(function(L){if(window.__shApv)return;window.__shApv=1;
var n=function(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/\\s+/g,' ').trim()},M=Object.create(null);
L.forEach(function(x){M[n(x.a)]=x.p});
var st=document.createElement('style');st.textContent='[data-sh-apv]::before{content:"Apvienots";display:inline-block;margin-right:6px;padding:1px 8px;border-radius:999px;background:#e2ddf2;color:#3d3466;font:800 11px/1.5 Manrope,system-ui,sans-serif;letter-spacing:0;text-transform:none;text-decoration:none;vertical-align:middle;white-space:nowrap}html[data-theme=dark] [data-sh-apv]::before{background:#2c2840;color:#d9d2f5}@media print{[data-sh-apv]::before{display:none!important;content:none!important}}';
(document.head||document.documentElement).appendChild(st);
var SKIP={SCRIPT:1,STYLE:1,TEXTAREA:1,INPUT:1,SELECT:1,TITLE:1,svg:1,SVG:1};
function no(el){return el.closest&&el.closest('[data-no-apv],[contenteditable=true],.print,.no-apv')}
function deco(el){if(!el||el.nodeType!==1)return;
 if(el.tagName==='OPTION'){var p0=M[n(el.textContent||el.value)];if(p0&&!el.dataset.apv){el.dataset.apv=1;el.label=(el.textContent||el.value)+' · apvienots'}return}
 if(el.tagName==='DATALIST'||el.tagName==='SELECT'){[].forEach.call(el.querySelectorAll('option'),deco);return}
 if(SKIP[el.tagName]||el.isContentEditable||no(el))return;
 var kids=el.children;if(kids.length===0){var p=M[n(el.textContent)];
  if(p){if(!el.hasAttribute('data-sh-apv')){el.setAttribute('data-sh-apv','1');if(!el.title){el.title='Apvienots: '+p.join(' + ');el.dataset.apvT=1}}}
  else if(el.hasAttribute('data-sh-apv')){el.removeAttribute('data-sh-apv');if(el.dataset.apvT){el.removeAttribute('title');delete el.dataset.apvT}}
  return}
 for(var i=0;i<kids.length;i++)deco(kids[i])}
var q=[],sch=0;function run(){sch=0;var a=q;q=[];a.forEach(deco)}
function add(x){q.push(x);if(!sch){sch=1;(window.requestAnimationFrame||setTimeout)(run)}}
new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==='characterData'){if(m.target.parentElement)add(m.target.parentElement)}else{if(m.target&&m.target.nodeType===1)add(m.target);[].forEach.call(m.addedNodes,function(x){if(x.nodeType===1)add(x)})}})}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
if(document.body)add(document.body);else addEventListener('DOMContentLoaded',function(){add(document.body)});
})(`;
export async function apvScript(env, ctx) {
  const cache = caches.default, key = new Request('https://sh-cache/apv.js?' + APV_JS.length);   // jauns kods → jauns kešs
  let r = await cache.match(key); if (r) return r;
  const list = await apvList(env.DB).catch(() => []);
  r = new Response(APV_JS + JSON.stringify(list).replace(/</g, '\\u003c') + ');', { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
  ctx.waitUntil(cache.put(key, r.clone()));
  return r;
}

/* Pazemes autostāvvietas platība no kadastra datiem (koplietošanas telpas pagrabā vai telpu grupas ar stāvvietu). 0 = nav */
export const isPark = (x) => /auto\s*st[āa]v|st[āa]vviet|garā[žz]|garaz|auto\s*novietn|transportlīdzekļ|brauktuv|\b124[12]\b/i.test(String(x || ''));
/* Viena loģika (tā pati kā majaslieta/index.html gPark/parkUnder): telpu grupa ir autostāvvieta pēc nosaukuma/veida, telpām grupā vai rokas atzīmes park */
export const gPark = (g) => g.park === true || (g.park !== false && (isPark(g.nosaukums + ' ' + g.lv) || (Array.isArray(g.telpas_n) && g.telpas_n.some(isPark))));
const overGround = (x) => /virszem|ārtelp/i.test(String(x || ''));
function parkingM2(d) {   // tikai pazemes (Stāvvietu lietotnei): koplietošanas telpas pagrabā + telpu grupas, kas nav virszemes/ārtelpas
  let m = 0;
  (Array.isArray(d.telpas) ? d.telpas : []).forEach(t => { if (isPark(t.nosaukums) && !overGround(t.nosaukums) && (t.zona === 'Pagrabs' || /pazem/i.test(t.nosaukums))) m += +t.m2 || 0; });
  (Array.isArray(d.grupas) ? d.grupas : []).forEach(g => { if (gPark(g) && !overGround(g.nosaukums)) m += +g.m2 || 0; });
  return m;
}
/* Kadastrā ir pazemes stāvvieta → objekts Pazemes stāvvietās + platība (ja tur vēl nav). Ja admins pakalpojumu izslēdzis (pazemes = 0) — neaiztiek.
 * → { m2, state: 'added' | 'in' | 'off' | 'none' } */
async function applyParking(db, k, adrese, dati) {
  const pk = Math.round(parkingM2(dati) * 10) / 10;
  const oi = await db.prepare('SELECT pazemes FROM obj_info WHERE anorm = ?').bind(k).first();
  const cur = oi ? oi.pazemes : null;
  if (!pk) return { m2: 0, state: cur === 1 ? 'in' : 'none' };
  if (cur === 0) return { m2: pk, state: 'off' };   // admins izslēdza — neieslēdzam atpakaļ
  await db.prepare('INSERT INTO obj_info (anorm, pazemes) VALUES (?, 1) ON CONFLICT(anorm) DO UPDATE SET pazemes = 1').bind(k).run();
  // platība Stāvvietu lietotnē, ja tur vēl nav ievadīta (qty > 0 ieslēdz grafiku — lietotājs to vēlas, 1× gadā)
  await db.prepare('INSERT INTO stav_obj (anorm, qty) VALUES (?, ?) ON CONFLICT(anorm) DO UPDATE SET qty = CASE WHEN stav_obj.qty > 0 THEN stav_obj.qty ELSE excluded.qty END').bind(k, pk).run();
  if (cur !== 1) await log(db, 'Pazemes stāvvietas ← ' + adrese + ' (' + Math.round(pk) + ' m²)');
  return { m2: pk, state: cur === 1 ? 'in' : 'added' };
}
const httpsOnly = (u) => /^https:\/\//i.test(String(u || '')) ? str(u, 500) : '';
const noI = (d) => { (Array.isArray(d && d.grupas) ? d.grupas : []).forEach(g => { delete g._i; }); return d; };

/* Ēkas dati (obj_info.ip: stāvi, kāpņu telpas, lifti, dzīvokļi) no kadastra. Kāpņu telpas un lifti — novērtējums:
 * kadastrā katrs stāvs ir atsevišķa telpa, tāpēc skaits ÷ virszemes stāvi; ja liftu virszemē nav — lifta šahtas pagrabā. */
export function kadIp(d) {
  const B = Array.isArray(d.buves) ? d.buves : [], T = Array.isArray(d.telpas) ? d.telpas : [], ip = {};
  const stavi = Math.max(0, ...B.map(b => +b.virszemes_stavi || 0)), dz = B.reduce((a, b) => a + (+b.dzivokli || 0), 0);
  if (stavi) ip.stavi = stavi;
  if (dz) ip.dzivokli = dz;
  const cnt = (re, z) => T.filter(t => re.test(t.nosaukums) && (!z || (t.zona || 'Virszeme') === z)).reduce((a, t) => a + (+t.skaits || 1), 0);
  const per = (n) => n && stavi ? Math.max(1, Math.round(n / stavi)) : 0;
  const kap = per(cnt(/^(kāpņu telpa|kāpnes)$/i, 'Virszeme')); if (kap) ip.kapnu = kap;
  const lv = cnt(/^lifts?$/i, 'Virszeme'), ls = cnt(/lifta šaht/i);
  const lif = lv ? per(lv) : ls; if (lif) ip.lifti = lif;
  return ip;
}
/* Aizpilda tikai tukšos laukus — ar roku ievadītais paliek */
async function fillIp(db, k, dati) {
  const add = kadIp(dati); if (!Object.keys(add).length) return null;
  const r = await db.prepare('SELECT ip FROM obj_info WHERE anorm = ?').bind(k).first();
  let cur = {}; try { cur = JSON.parse((r && r.ip) || '{}') || {}; } catch (e) {}
  const next = Object.assign({}, cur); let ch = 0;
  for (const x in add) if (next[x] == null || next[x] === '') { next[x] = add[x]; ch++; }
  if (ch) await db.prepare('INSERT INTO obj_info (anorm, ip) VALUES (?, ?) ON CONFLICT(anorm) DO UPDATE SET ip = excluded.ip').bind(k, JSON.stringify(next)).run();
  return next;
}
async function kadParse(env, db, b) {
  if (b.dati && typeof b.dati === 'object') {   // jau sakārtoti dati no «SH Kadastrs» pogas — AI nevajag
    const objs = await all(db, 'SELECT anorm, adrese FROM objects ORDER BY ord');
    return { dati: b.dati, ieteikumi: matchObj(objs, str(b.dati.adrese, 300)) };
  }
  const text = str(b.text, MAX_RAW); if (text.length < 40) throw new Error('Kadastra lapas teksts ir par īsu — atveriet objekta lapu kadastrs.lv');
  const raw = await aiCall(env, KAD_SYSTEM, 'Lapas adrese: ' + str(b.url, 300) + '\nVirsraksts: ' + str(b.title, 200) + '\n\nLapas teksts:\n' + text + '\n\nAtgriez JSON šādā formā: ' + KAD_SHAPE, 4000);
  const m = String(raw).match(/\{[\s\S]*\}/); if (!m) throw new Error('AI neatgrieza datus');
  let dati; try { dati = JSON.parse(m[0]); } catch (e) { throw new Error('AI atgrieza nederīgus datus'); }
  const objs = await all(db, 'SELECT anorm, adrese FROM objects ORDER BY ord');
  return { dati, ieteikumi: matchObj(objs, dati.adrese || b.title || '') };
}

async function docPut(env, b) {
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(String(b.data || ''));
  if (!m) throw new Error('Nederīgs fails');
  const ct = m[1].toLowerCase(); if (!DOC_TYPES[ct]) throw new Error('Var pievienot PDF, bildes, Word un Excel failus');
  if (m[2].length * 0.75 > MAX_DOC + 4) throw new Error('Fails par lielu (līdz 10 MB)');
  const s = atob(m[2]), bin = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i);
  if (bin.length > MAX_DOC) throw new Error('Fails par lielu (līdz 10 MB)');
  if (!env.FOTO) throw new Error('Failu glabātuve nav pieslēgta');
  const key = 'ml-' + crypto.randomUUID().replace(/-/g, '');
  await env.FOTO.put(key, bin, { httpMetadata: { contentType: ct }, customMetadata: { app: 'ml', name: str(b.name, 150) } });
  return { key, ct, size: bin.length };
}

export async function api(request, env, X) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB, me = await personByPin(db, b.pin);
  const role = me && ((me.perms || {})[KEY] || ((me.perms || {}).portal === 'admin' ? 'admin' : ''));
  if (!me || !role) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN vai nav piekļuves: ' + NAME, code: 'auth' }); }
  const need = (r) => { if ((ROLE_W[role] || 0) < ROLE_W[r]) throw new Error('Jums ir tikai skatīšanās tiesības'); };
  const a = b.action, k = anorm(b.anorm || b.adrese);
  try {
    if (a === 'boot') {
      const objects = await all(db, 'SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, CASE WHEN o.piekluve != \'\' THEN 1 ELSE 0 END pk, k.kad_nr, k.atjaunots kad_t, (SELECT COUNT(*) FROM ml_doc d WHERE d.anorm = o.anorm AND d.dzests = 0) docs, (SELECT MAX(CAST(json_extract(b.value, \'$.virszemes_stavi\') AS REAL)) FROM json_each(CASE WHEN json_valid(k.dati) THEN k.dati ELSE \'{}\' END, \'$.buves\') b) st, (SELECT MAX(CAST(json_extract(b.value, \'$.pazemes_stavi\') AS REAL)) FROM json_each(CASE WHEN json_valid(k.dati) THEN k.dati ELSE \'{}\' END, \'$.buves\') b) pz, (SELECT SUM(CAST(json_extract(b.value, \'$.dzivokli\') AS REAL)) FROM json_each(CASE WHEN json_valid(k.dati) THEN k.dati ELSE \'{}\' END, \'$.buves\') b) dz, (SELECT SUM(CAST(json_extract(b.value, \'$.kopplatiba_m2\') AS REAL)) FROM json_each(CASE WHEN json_valid(k.dati) THEN k.dati ELSE \'{}\' END, \'$.buves\') b) m2, (SELECT MIN(CAST(json_extract(b.value, \'$.ekspluatacijas_gads\') AS REAL)) FROM json_each(CASE WHEN json_valid(k.dati) THEN k.dati ELSE \'{}\' END, \'$.buves\') b WHERE CAST(json_extract(b.value, \'$.ekspluatacijas_gads\') AS INTEGER) > 1700) gads FROM objects o LEFT JOIN ml_kad k ON k.anorm = o.anorm ORDER BY o.ord, o.adrese');
      if ((ROLE_W[role] || 0) < 2) objects.forEach(o => { delete o.pk; });
      const parts = partsOf(objects, await manualParts(db));
      return out({ ok: true, me: { name: me.name, role }, objects, kinds: DOC_KINDS, parts, svc: await objinfo.svcMap(db).catch(() => ({})), names: Object.fromEntries(Object.keys(objinfo.SVC).map(x => [x, objinfo.SVC[x][2]])) });
    }
    if (a === 'obj') {
      if (!k) throw new Error('Nav objekta');
      const o = await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, o.piekluve, i.ip, i.parv FROM objects o LEFT JOIN obj_info i ON i.anorm = o.anorm WHERE o.anorm = ?').bind(k).first().catch(() => null)
        || await db.prepare('SELECT anorm, adrese, vaditajs, grupa, piekluve FROM objects WHERE anorm = ?').bind(k).first();
      if (!o) throw new Error('Objekts nav atrasts');
      if ((ROLE_W[role] || 0) < 2) o.piekluve = '';
      const kad = await db.prepare('SELECT kad_nr, dati, avots, atjaunots, kas FROM ml_kad WHERE anorm = ?').bind(k).first();
      if (kad) { try { kad.dati = JSON.parse(kad.dati || '{}'); } catch (e) { kad.dati = {}; } }
      const docs = await all(db, 'SELECT id, nosaukums, tips, izmers, pievienoja, laiks FROM ml_doc WHERE anorm = ? AND dzests = 0 ORDER BY laiks DESC', k);
      const allO = await all(db, 'SELECT anorm, adrese FROM objects'), man = await manualParts(db), P = partsOf(allO, man)[k] || null;
      let parts = null, histParts = []; const pre = {};
      if (P) {
        parts = [];
        for (const x of P) {
          const r = x.anorm ? await db.prepare('SELECT dati, atjaunots FROM ml_kad WHERE anorm = ?').bind(x.anorm).first() : null;
          let d = null; if (r) { try { d = JSON.parse(r.dati || '{}'); } catch (e) { d = {}; } }
          parts.push({ adrese: x.adrese, anorm: x.anorm, kad: d, kad_t: r ? r.atjaunots : '' });
          if (x.anorm) (await history(db, x.anorm, x.adrese, pre)).forEach(h => histParts.push(Object.assign(h, { part: x.adrese })));
        }
        histParts.sort((a, b) => String(b.datums).localeCompare(String(a.datums))); histParts = histParts.slice(0, 300);
      }
      return out({ ok: true, obj: o, kad: kad || null, docs, hist: await history(db, k, o.adrese, pre), parts, manual: !!(man[k] && man[k] !== 'auto'), histParts });
    }
    /* ---------- Objekti ---------- */
    const adm = async (act, body) => { if (!X || !X.adm) throw new Error('Nav pieejams'); const r = await X.adm(act, body, me); if (r && r.ok === false) throw new Error(r.error || 'Kļūda'); return r || {}; };
    const objList = async () => (await master(db)).objects;
    const saveList = async (list) => { await adm('saveObjects', { objects: list }); return out({ ok: true, objects: await objList() }); };
    if (a === 'objInfo') {   // objekta kartīte; algas un darbinieki (personas dati) — tikai adminam
      const ad = b.adrese || ((await db.prepare('SELECT adrese FROM objects WHERE anorm = ?').bind(k).first()) || {}).adrese;
      if (!ad) throw new Error('Objekts nav atrasts');
      const d = await objinfo.info(db, ad);
      const inh = (await dlInherit(db).catch(() => ({})))[k]; if (inh) d.dl.apv = { kods: inh.kods, adrese: inh.adrese, anorm: inh.anorm };
      if ((ROLE_W[role] || 0) < 3) { d.algas = []; d.personals = []; d.dl = { kods: (ROLE_W[role] || 0) >= 2 ? d.dl.kods : '', vajag_uzk: d.dl.vajag_uzk, vajag_set: d.dl.vajag_set, darbinieki: [] }; }
      return out(Object.assign({ ok: true }, d));
    }
    if (a === 'objMeta') {
      need('admin');
      const m = await master(db), P = await people(db);
      const mgrs = [...new Set(P.filter(p => p.active && (p.perms.portal === 'admin' || Object.keys(p.perms).some(x => x !== 'portal' && (p.perms[x] === 'vaditajs' || p.perms[x] === 'admin')))).map(p => p.name))].sort((x, y) => x.localeCompare(y, 'lv'));
      const parv = m.companies.filter(c => c.active !== false && c.kinds.includes('darba_devejs')).map(c => c.name);
      return out({ ok: true, objects: m.objects, mgrs, parv, amati: (m.lists && m.lists.amati) || [], svc: await objinfo.svcMap(db), names: Object.fromEntries(Object.keys(objinfo.SVC).map(x => [x, objinfo.SVC[x][2]])) });
    }
    if (a === 'objSave') {   // { old: anorm vai '' (jauns), obj: { adrese, vaditajs, grupa, piekluve } }
      need('admin');
      const o = b.obj || {}, n = { adrese: str(o.adrese, 200), vaditajs: str(o.vaditajs, 80), grupa: str(o.grupa, 80) || 'SH objekti', piekluve: str(o.piekluve, 2000) };
      n.adrese = cleanAddr(n.adrese);
      if (!n.adrese) throw new Error('Ierakstiet adresi');
      const list = await objList(), i = b.old ? list.findIndex(x => anorm(x.adrese) === b.old) : -1;
      if (b.old && i < 0) throw new Error('Objekts nav atrasts — atjaunojiet lapu');
      if (list.some((x, j) => j !== i && anorm(x.adrese) === anorm(n.adrese))) throw new Error('Šāda adrese jau ir');
      if (i >= 0 && anorm(list[i].adrese) !== anorm(n.adrese)) {   // pārdēvēšana: visas saites (darbi, grafiki, kadastrs, dokumenti…) pāriet uz jauno adresi
        const rn = X && X.adm && X.adm.renameObject;
        if (!rn) throw new Error('Pārdēvēšana vēl nav pieejama');
        const old = list[i].adrese; await rn(old, n.adrese, me);
        await log(db, me.name + ' · objekts pārdēvēts · ' + old + ' → ' + n.adrese);
        const l2 = await objList(), j = l2.findIndex(x => anorm(x.adrese) === anorm(n.adrese));
        if (j >= 0) { l2[j] = Object.assign({}, l2[j], n); return await saveList(l2); }
        return out({ ok: true, objects: l2 });
      }
      if (i >= 0) list[i] = n; else list.unshift(n);
      await log(db, me.name + ' · objekts ' + (i >= 0 ? 'labots' : 'pievienots') + ' · ' + n.adrese);
      return await saveList(list);
    }
    if (a === 'objDel') {
      need('admin');
      const list = await objList(), i = list.findIndex(x => anorm(x.adrese) === k); if (i < 0) throw new Error('Objekts nav atrasts');
      const [g] = list.splice(i, 1); await log(db, me.name + ' · objekts izņemts no saraksta · ' + g.adrese);
      return await saveList(list);
    }
    if (a === 'objMgrBulk') {   // darbu vadītājs vairākiem objektiem
      need('admin');
      const set = new Set((b.list || []).map(anorm)), v = str(b.vaditajs, 80);
      return await saveList((await objList()).map(o => set.has(anorm(o.adrese)) ? Object.assign({}, o, { vaditajs: v }) : o));
    }
    if (a === 'partsSave') {   // { anorm, parts: [adreses] | 'auto' } — [] = nav apvienots
      need('admin'); if (!k) throw new Error('Nav objekta');
      const v = b.parts === 'auto' ? 'auto' : JSON.stringify((Array.isArray(b.parts) ? b.parts : []).map(x => str(x, 200)).filter(Boolean).slice(0, 30));
      await db.prepare('INSERT INTO ml_parts (anorm, parts, kas, laiks) VALUES (?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET parts = excluded.parts, kas = excluded.kas, laiks = excluded.laiks').bind(k, v, me.name, nowStr()).run();
      await log(db, me.name + ' · sastāvdaļas · ' + k + ' → ' + v.slice(0, 200));
      await dlSync(db, k).catch(() => 0);
      return out({ ok: true });
    }
    if (a === 'objInfoSave') {   // sastāvdaļai savs Darba laika kods nav — tā manto apvienotā objekta kodu
      need('admin');
      const inh = (await dlInherit(db))[k]; if (inh && b.dl) b.dl.kods = '';
      const r = await adm(a, b); await dlSync(db, k);
      if (inh && r.dl) r.dl.apv = { kods: inh.kods, adrese: inh.adrese, anorm: inh.anorm };
      return out(Object.assign({ ok: true }, r));
    }
    if (a === 'objSvcBulk' || a === 'objParvBulk') { need('admin'); return out(Object.assign({ ok: true }, await adm(a, b))); }

    if (a === 'kadParse') { need('vaditajs'); return out(Object.assign({ ok: true }, await kadParse(env, db, b))); }
    if (a === 'kadSave') {
      need('vaditajs'); if (!k) throw new Error('Izvēlieties objektu');
      const o = await db.prepare('SELECT adrese FROM objects WHERE anorm = ?').bind(k).first(); if (!o) throw new Error('Objekts nav atrasts');
      const dati = noI(b.dati && typeof b.dati === 'object' ? b.dati : {});
      if ((ROLE_W[role] || 0) < 3) {   // «autostāvvieta» atzīmi (park) drīkst mainīt tikai admins — vadītājam paliek iepriekšējās atzīmes
        const prev = await db.prepare('SELECT dati FROM ml_kad WHERE anorm = ?').bind(k).first(); let pd = {}; try { pd = JSON.parse((prev && prev.dati) || '{}'); } catch (e) {}
        const pm = {}; (pd.grupas || []).forEach(g => { if (g && g.apz && typeof g.park === 'boolean') pm[g.apz] = g.park; });
        (Array.isArray(dati.grupas) ? dati.grupas : []).forEach(g => { delete g.park; if (g && g.apz in pm) g.park = pm[g.apz]; });
      }
      const js = JSON.stringify(dati); if (js.length > MAX_KAD) throw new Error('Par daudz datu');
      await db.prepare('INSERT INTO ml_kad (anorm, kad_nr, dati, raw, avots, atjaunots, kas) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET kad_nr = excluded.kad_nr, dati = excluded.dati, raw = excluded.raw, avots = excluded.avots, atjaunots = excluded.atjaunots, kas = excluded.kas')
        .bind(k, str(dati.kadastra_nr, 40), js, '', httpsOnly(b.url), nowStr(), me.name).run();
      await log(db, me.name + ' · kadastra dati · ' + o.adrese);
      const st = await applyParking(db, k, o.adrese, dati);
      const ipNew = await fillIp(db, k, dati);
      return out({ ok: true, stav: st.state === 'added' || st.state === 'in' ? Math.round(st.m2) : 0, stavState: st.state, ip: ipNew });
    }
    if (a === 'kadPark') {   // { anorm, i, park } — tikai atzīme; kadastra «atjaunots/kas» nemainās
      need('admin'); if (!k) throw new Error('Nav objekta');
      const r = await db.prepare('SELECT dati FROM ml_kad WHERE anorm = ?').bind(k).first(); if (!r) throw new Error('Kadastra datu nav');
      const o = await db.prepare('SELECT adrese FROM objects WHERE anorm = ?').bind(k).first(); if (!o) throw new Error('Objekts nav atrasts');
      let d = {}; try { d = JSON.parse(r.dati || '{}'); } catch (e) {}
      const g = (Array.isArray(d.grupas) ? d.grupas : [])[parseInt(b.i, 10)]; if (!g) throw new Error('Telpu grupa nav atrasta — atjaunojiet lapu');
      if (b.apz && g.apz !== b.apz) throw new Error('Kadastra dati mainījušies — atjaunojiet lapu');
      g.park = !!b.park; noI(d);
      await db.prepare('UPDATE ml_kad SET dati = ? WHERE anorm = ?').bind(JSON.stringify(d), k).run();
      await log(db, me.name + ' · ' + (g.park ? 'autostāvvieta' : 'nav autostāvvieta') + ' · ' + o.adrese + ' · ' + (g.nosaukums || g.apz));
      const st = await applyParking(db, k, o.adrese, d);
      return out({ ok: true, park: g.park, stav: Math.round(st.m2), stavState: st.state });
    }
    if (a === 'docUpload') {
      need('vaditajs'); if (!k) throw new Error('Izvēlieties objektu');
      if (!await db.prepare('SELECT 1 FROM objects WHERE anorm = ?').bind(k).first()) throw new Error('Objekts nav atrasts');
      const f = await docPut(env, b), id = f.key, tips = DOC_KINDS.indexOf(b.tips) !== -1 ? b.tips : 'Cits';
      await db.prepare('INSERT INTO ml_doc (id, anorm, nosaukums, tips, r2, izmers, pievienoja, laiks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, k, str(b.name, 150) || 'Dokuments', tips, f.key, f.size, me.name, nowStr()).run();
      await log(db, me.name + ' · dokuments · ' + str(b.name, 80));
      return out({ ok: true, id });
    }
    if (a === 'docList') return out({ ok: true, docs: await all(db, 'SELECT id, nosaukums, tips, izmers, pievienoja, laiks FROM ml_doc WHERE anorm = ? AND dzests = 0 ORDER BY laiks DESC', k) });
    if (a === 'docGet') {   // fails tikai ar PIN (dokumenti nav publiski)
      const d = await db.prepare('SELECT r2, nosaukums FROM ml_doc WHERE id = ? AND dzests = 0').bind(str(b.id, 60)).first(); if (!d || !env.FOTO) throw new Error('Dokuments nav atrasts');
      const o = await env.FOTO.get(d.r2); if (!o) throw new Error('Dokuments nav atrasts');
      return new Response(o.body, { headers: Object.assign({ 'Content-Type': (o.httpMetadata && o.httpMetadata.contentType) || 'application/octet-stream', 'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(d.nosaukums) }, CORS) });
    }
    if (a === 'docDel') {   // tikai paslēpj — fails R2 paliek (datus nedzēšam)
      need('vaditajs'); const id = str(b.id, 60);
      const d = await db.prepare('SELECT nosaukums FROM ml_doc WHERE id = ?').bind(id).first(); if (!d) throw new Error('Dokuments nav atrasts');
      await db.prepare('UPDATE ml_doc SET dzests = 1 WHERE id = ?').bind(id).run();
      await log(db, me.name + ' · noņemts dokuments · ' + d.nosaukums);
      return out({ ok: true });
    }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: String((e && e.message) || e) }); }
}
