/* SH | Mājas lieta — viss par māju vienuviet: kadastra dati (no kadastrs.lv caur Safari pogu + AI), dokumenti (R2), darbu vēsture no visām lietotnēm. © VAITKEVIX, SIA
 * Maršruts POST /ml { pin, action, … }. Lomas portālā: perms.ml = admin | vaditajs | skatitajs; portāla admins = admin.
 * Savas tabulas ml_kad, ml_doc, ml_log. Citu lietotņu tabulas tikai lasa. */
import { personByPin } from './portal.js';
import { aiCall } from './ai.js';
import { today, nowStr, anorm, CORS, out } from './util.js';

export const KEY = 'ml', NAME = 'Mājas lieta';
const ROLE_W = { admin: 3, vaditajs: 2, skatitajs: 0 };
const IMG = 'https://vaitkevix.cloud/sh/api/img?sz=w1600&id=';
const MAX_DOC = 15e6, MAX_RAW = 40000;
const DOC_TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'Bilde', 'image/png': 'Bilde', 'image/webp': 'Bilde', 'image/heic': 'Bilde', 'image/heif': 'Bilde',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word', 'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel', 'application/vnd.ms-excel': 'Excel' };
const DOC_KINDS = ['Kadastrs', 'Līgums', 'Akts', 'Plāns / rasējums', 'Tehniskā dokumentācija', 'Cits'];

export async function cron() {}   // nav plānoto darbu

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const log = (db, t) => db.prepare('INSERT INTO ml_log (laiks, teksts) VALUES (?, ?)').bind(nowStr(), String(t).slice(0, 300)).run();
/** Adreses salīdzināšanai: bez garumzīmēm, bez «iela», Rīgas/LV, VNĪ/KK prefiksiem */
const akey = (s) => anorm(s).replace(/^(kk|ir|ee) /, '').replace(/^(j|vni) ?\| ?/, '').replace(/,?\s*(latvija|lv-?\s?\d{4}|riga|rigas pils\.?)\s*/g, ' ')
  .replace(/\b(iela|gatve|bulvaris|prospekts|cels|laukums)\b/g, ' ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
/** dd.mm.yyyy [hh:mm] → yyyy-mm-dd (citādi kā ir) */
const iso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : String(s || '').slice(0, 10); };
const fotos = (v) => String(v || '').split(/[\s,]+/).filter(Boolean).map(x => /^https?:/.test(x) ? x : /^[\w-]{20,80}$/.test(x) ? IMG + x : '').filter(Boolean).slice(0, 6);

/* Darbu vēsture: visas lietotnes, jaunākie pirmie */
const VISITS = [['pl_visit', 'pl', 'Zāles pļaušana'], ['logi_visit', 'logi', 'Logu mazgāšana'], ['darz_visit', 'darz', 'Dārzniecība'], ['stav_visit', 'stav', 'Pazemes stāvvieta'], ['sniegs_visit', 'sniegs', 'Sniega tīrīšana']];
const VST = { plan: 'Plānots', done: 'Izpildīts', cant: 'Nevarēja', skip: 'Izlaists', moved: 'Pārcelts' };
async function history(db, k, adrese) {
  const t = today(), ak = akey(adrese), rows = [];
  for (const [tbl, app, name] of VISITS) {
    (await all(db, 'SELECT datums, statuss, izpilditajs, foto, iemesls, piezime FROM ' + tbl + " WHERE anorm = ? AND (statuss != 'plan' OR datums >= ?) ORDER BY datums DESC LIMIT 60", k, t).catch(() => []))
      .forEach(r => rows.push({ app, name, datums: r.datums, statuss: VST[r.statuss] || r.statuss, kas: r.izpilditajs || '', teksts: [r.piezime, r.iemesls].filter(Boolean).join(' · '), foto: fotos(r.foto), plan: r.statuss === 'plan' }));
  }
  (await all(db, 'SELECT datums, tips, apraksts, statuss, brigade, foto, komentars, iemesls FROM jobs WHERE anorm = ? OR lower(adrese) = lower(?) ORDER BY datums DESC LIMIT 80', k, adrese).catch(() => []))
    .forEach(r => rows.push({ app: 'aizv', name: 'Aizvietošana' + (r.tips ? ' · ' + r.tips : ''), datums: r.datums, statuss: r.statuss, kas: r.brigade || '', teksts: [r.apraksts, r.komentars, r.iemesls].filter(Boolean).join(' · '), foto: fotos(r.foto) }));
  // Izvešana un Kaisāmmateriāls glabā tikai adresi → salīdzina pēc normalizētas adreses
  (await all(db, "SELECT datums, adrese, maisi, statuss, sia, m3, izv_kom, foto_pec, problema FROM izv_task WHERE statuss != 'Dzēsts'").catch(() => []))
    .filter(r => akey(r.adrese) === ak).forEach(r => rows.push({ app: 'izv', name: 'Izvešana' + (r.maisi ? ' · ' + r.maisi : ''), datums: iso(r.datums), statuss: r.statuss, kas: r.sia || '',
      teksts: [r.m3 ? r.m3 + ' m³' : '', r.izv_kom, r.problema].filter(Boolean).join(' · '), foto: fotos(r.foto_pec) }));
  (await all(db, 'SELECT datums, adrese, materials, statuss, kurjers, piegadati, kurj_kom, foto_pec FROM kais_task').catch(() => []))
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
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); if (bin.length > MAX_DOC) throw new Error('Fails par lielu (līdz 15 MB)');
  if (!env.FOTO) throw new Error('Failu glabātuve nav pieslēgta');
  const key = 'ml-' + crypto.randomUUID().replace(/-/g, '');
  await env.FOTO.put(key, bin, { httpMetadata: { contentType: ct }, customMetadata: { app: 'ml', name: str(b.name, 150) } });
  return { key, ct, size: bin.length };
}

export async function api(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB, me = await personByPin(db, b.pin);
  const role = me && ((me.perms || {})[KEY] || ((me.perms || {}).portal === 'admin' ? 'admin' : ''));
  if (!me || !role) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN vai nav piekļuves: ' + NAME, code: 'auth' }); }
  const need = (r) => { if ((ROLE_W[role] || 0) < ROLE_W[r]) throw new Error('Jums ir tikai skatīšanās tiesības'); };
  const a = b.action, k = anorm(b.anorm || b.adrese);
  try {
    if (a === 'boot') {
      const objects = await all(db, 'SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, k.kad_nr, k.atjaunots kad_t, (SELECT COUNT(*) FROM ml_doc d WHERE d.anorm = o.anorm AND d.dzests = 0) docs FROM objects o LEFT JOIN ml_kad k ON k.anorm = o.anorm ORDER BY o.ord, o.adrese');
      return out({ ok: true, me: { name: me.name, role }, objects, kinds: DOC_KINDS });
    }
    if (a === 'obj') {
      if (!k) throw new Error('Nav objekta');
      const o = await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, o.piekluve, i.ip, i.parv FROM objects o LEFT JOIN obj_info i ON i.anorm = o.anorm WHERE o.anorm = ?').bind(k).first().catch(() => null)
        || await db.prepare('SELECT anorm, adrese, vaditajs, grupa, piekluve FROM objects WHERE anorm = ?').bind(k).first();
      if (!o) throw new Error('Objekts nav atrasts');
      if (ROLE_W[role] < 2) o.piekluve = '';
      const kad = await db.prepare('SELECT kad_nr, dati, avots, atjaunots, kas FROM ml_kad WHERE anorm = ?').bind(k).first();
      if (kad) { try { kad.dati = JSON.parse(kad.dati || '{}'); } catch (e) { kad.dati = {}; } }
      const docs = await all(db, 'SELECT id, nosaukums, tips, izmers, pievienoja, laiks FROM ml_doc WHERE anorm = ? AND dzests = 0 ORDER BY laiks DESC', k);
      return out({ ok: true, obj: o, kad: kad || null, docs, hist: await history(db, k, o.adrese) });
    }
    if (a === 'kadParse') { need('vaditajs'); return out(Object.assign({ ok: true }, await kadParse(env, db, b))); }
    if (a === 'kadSave') {
      need('vaditajs'); if (!k) throw new Error('Izvēlieties objektu');
      const o = await db.prepare('SELECT adrese FROM objects WHERE anorm = ?').bind(k).first(); if (!o) throw new Error('Objekts nav atrasts');
      const dati = b.dati && typeof b.dati === 'object' ? b.dati : {}, js = JSON.stringify(dati); if (js.length > 60000) throw new Error('Par daudz datu');
      await db.prepare('INSERT INTO ml_kad (anorm, kad_nr, dati, raw, avots, atjaunots, kas) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET kad_nr = excluded.kad_nr, dati = excluded.dati, raw = excluded.raw, avots = excluded.avots, atjaunots = excluded.atjaunots, kas = excluded.kas')
        .bind(k, str(dati.kadastra_nr, 40), js, '', str(b.url, 500), nowStr(), me.name).run();
      await log(db, me.name + ' · kadastra dati · ' + o.adrese);
      return out({ ok: true });
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
