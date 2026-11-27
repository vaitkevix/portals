/* SH | Sniega tīrīšana — izsaukums pēc sniega prognozes (vadītājs apstiprina / atceļ) vai ar pogu; katram traktoristam (vai SIA) savs maršruts secībā,
 * izpildītājs atzīmē sākumu, beigas un bildi. © VAITKEVIX, SIA
 * Maršruts POST /sniegs  { pin, action, … }.  Lomas: perms.sniegs = admin | vaditajs | izpilditajs; portāla admins = admin, citi = skatitajs; SIA ar veidu «traktorists» = izpilditajs.
 * Tabulas: sniegs_obj (traktorists, secība), sniegs_call (izsaukumi), sniegs_visit (adrese izsaukumā), sniegs_log. Laikapstākļi — kv 'wx' (wx.js). */
import { claimsOf, claimApi } from './pretenzijas.js';
import { audit } from './audit.js';
import { chkList, chkSave, chkTake, chkOf } from './checklist.js';
import { threadCounts, threadApi } from './thread.js';
import { onSnowCall as kaisSnow } from './kaisammaterials.js';
import { sendSms, smsOn } from './darbalaiks.js';
import { personByPin, companyBy } from './portal.js';
import { groupsOf } from './master.js';
import { notify, managers, personNames } from './webpush.js';
import { today, addDays, nowStr, uid, anorm, lvD, kv, kvSet, geoQuery, CORS, out, assertOpen } from './util.js';

export const KEY = 'sniegs', NAME = 'Sniega tīrīšana', KIND = 'traktorists';
export const DEF_CFG = { snowCm: 3, auto: true, approve: true, photoReq: true, ice: true, veidi: ['Brauktuve', 'Ietves', 'Stāvlaukums', 'Kaisīts'] };
/* ---------- Sniega tīrīšanas specifika ---------- */
export const TEHNIKA = ['Traktors', 'Frontālais iekrāvējs', 'Mini traktors', 'Ar rokām'];
export const KAISA = ['Nav', 'Sāls', 'Smiltis', 'Sāls/smilts mix'];
export const REQ_VEIDI = ['Brauktuve', 'Ietves', 'Lāstekas / jumts', 'Sniega izvešana', 'Kaisīšana'];
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
export const LAST = 'Lāstekas / jumts';   // lāsteku / jumta tīrīšana — riska zona + bilde obligāti
function cleanReq(d) { d = d || {}; return { veidi: (d.veidi || []).filter(x => REQ_VEIDI.indexOf(x) !== -1), zona: String(d.zona || '').trim().slice(0, 200) }; }
/* Apledojums pēc prognozes: t° min −2…+1 un nokrišņi, vai vakar lietus (t° > 0) → šodien sals */
export function iceRisk(wx, d) { const x = wx[d] || {}, p = wx[addDays(d, -1)] || {}; if (x.t == null) return '';
  if (x.t >= -2 && x.t <= 1 && (x.r || 0) >= 0.3) return 'nokrišņi ap 0° (' + (+x.t).toFixed(0) + '°)';
  if (x.t < 0 && (p.r || 0) >= 0.5 && (p.t == null || p.t > 0)) return 'lietus → sals (' + (+x.t).toFixed(0) + '°)';
  return ''; }
function cleanObj(d) { d = d || {}; return { tehnika: TEHNIKA.indexOf(d.tehnika) !== -1 ? d.tehnika : 'Traktors' }; }
function cleanDone(d) { d = d || {}; return { zona: !!d.zona, tehnika: TEHNIKA.indexOf(d.tehnika) !== -1 ? d.tehnika : '', kaisits: KAISA.indexOf(d.kaisits) !== -1 ? d.kaisits : 'Nav', kg: int(d.kg, 0, 99999), kravas: int(d.kravas, 0, 999) }; }

async function cfgOf(db) { return Object.assign({}, DEF_CFG, (await kv(db, 'sniegs:cfg')) || {}); }
const log = (db, t) => db.prepare('INSERT INTO sniegs_log (laiks, teksts) VALUES (?, ?)').bind(nowStr(), String(t).slice(0, 300));

/* Izsaukuma adreses — visi aktīvie objekti ar savu traktoristu un secību */
/* Traktoristiem (cilvēkiem) — maršruts gatavs */
async function pushCrews(env, call, txt) {
  const names = ((await env.DB.prepare("SELECT DISTINCT brigade FROM sniegs_visit WHERE izs = ? AND brigade != ''").bind(call.id).all()).results || []).map(r => r.brigade);
  await notify(env, await personNames(env, names), { title: '❄ Sniega tīrīšana · ' + lvD(call.datums), body: txt, url: '/sh/#sniegs', urgent: true });
  // ārējiem traktoristiem (SIA) arī SMS uz uzņēmuma tālruni — viņi bieži nav abonējuši paziņojumus
  if (names.length && await smsOn(env.DB, 'sniegs')) { const ph = ((await env.DB.prepare(`SELECT phone FROM companies WHERE active = 1 AND phone != '' AND name IN (${names.map(() => '?').join(',')})`).bind(...names).all()).results || []).map(r => r.phone);
    if (ph.length) await sendSms(env, ph, 'SH sniega tīrīšana ' + lvD(call.datums) + ': ' + txt + ' Maršruts: vaitkevix.cloud/sh/#sniegs').catch(e => console.error('sniegs sms', e)); }
}
async function callVisits(db, call) {
  const objs = (await db.prepare('SELECT s.anorm, o.adrese, s.brigade, s.seq FROM sniegs_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.aktivs = 1 ORDER BY s.brigade, s.seq, o.adrese').all()).results || [];
  const have = new Set(((await db.prepare('SELECT anorm FROM sniegs_visit WHERE izs = ?').bind(call.id).all()).results || []).map(r => r.anorm));
  const dati = call.veids === 'kaisisana' ? JSON.stringify({ veidi: ['Kaisīšana'] }) : '{}';
  const st = objs.filter(o => !have.has(o.anorm)).map(o => db.prepare('INSERT INTO sniegs_visit (id, izs, anorm, adrese, datums, brigade, seq, dati, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), call.id, o.anorm, o.adrese, call.datums, o.brigade || '', +o.seq || 0, dati, nowStr()));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  return st.length;
}
/* Prognoze ≥ slieksnis šodien / rīt → izsaukums (gaida apstiprinājumu vai uzreiz aktīvs) */
export async function snowCheck(db, env) {
  const C = await cfgOf(db), wx = (await kv(db, 'wx')) || {}, t = today(); let made = 0;
  if (!C.auto) return 0;
  for (const d of [t, addDays(t, 1)]) {
    const cm = +((wx[d] || {}).s || 0), ice = C.ice !== false ? iceRisk(wx, d) : '';
    if (cm < C.snowCm && ice) {   // kaisīšana bez sniega — atsevišķs izsaukuma veids (vadītājs apstiprina tāpat)
      if (await db.prepare('SELECT id FROM sniegs_call WHERE datums = ?').bind(d).first()) continue;
      const call = { id: uid(), datums: d, statuss: C.approve ? 'gaida' : 'aktivs', veids: 'kaisisana' };
      await db.batch([db.prepare("INSERT INTO sniegs_call (id, datums, statuss, cm, avots, izveidots, veids) VALUES (?, ?, ?, 0, 'prognoze', ?, 'kaisisana')").bind(call.id, d, call.statuss, nowStr()),
        log(db, 'Apledojums ' + lvD(d) + ': ' + ice + ' → kaisīšana ' + (C.approve ? 'gaida apstiprinājumu' : 'aktīva'))]);
      if (call.statuss === 'aktivs') { await callVisits(db, call); if (env) await kaisSnow(env, d).catch(() => 0); }
      if (env) { try {
        if (call.statuss === 'gaida') await notify(env, await managers(env, KEY), { title: '🧊 Apledojums · ' + lvD(d), body: ice + ' — kaisīšana gaida apstiprinājumu', url: '/sh/#sniegs', urgent: true });
        else await pushCrews(env, call, 'Apledojums (' + ice + ') — kaisīšanas maršruts gatavs');
      } catch (e) { console.error('push', e); } }
      made++; continue;
    }
    if (cm < C.snowCm) continue;
    if (await db.prepare('SELECT id FROM sniegs_call WHERE datums = ?').bind(d).first()) continue;
    const call = { id: uid(), datums: d, statuss: C.approve ? 'gaida' : 'aktivs' };
    await db.batch([db.prepare('INSERT INTO sniegs_call (id, datums, statuss, cm, avots, izveidots) VALUES (?, ?, ?, ?, ?, ?)').bind(call.id, d, call.statuss, cm, 'prognoze', nowStr()),
      log(db, 'Prognoze ' + cm.toFixed(1) + ' cm ' + lvD(d) + ' → izsaukums ' + (C.approve ? 'gaida apstiprinājumu' : 'aktīvs'))]);
    if (call.statuss === 'aktivs') { await callVisits(db, call); if (env) await kaisSnow(env, d); }
    if (env) { try {
      if (call.statuss === 'gaida') await notify(env, await managers(env, KEY), { title: '❄ Sniegs ' + cm.toFixed(1) + ' cm · ' + lvD(d), body: 'Izsaukums gaida apstiprinājumu — atveriet Sniega tīrīšanu', url: '/sh/#sniegs', urgent: true });
      else await pushCrews(env, call, 'Prognoze ' + cm.toFixed(1) + ' cm — jūsu maršruts gatavs');
    } catch (e) { console.error('push', e); } }
    made++;
  }
  return made;
}
export async function geocode(db, max) {
  for (const T of ['pl_obj', 'logi_obj', 'darz_obj', 'stav_obj'])
    await db.prepare(`UPDATE sniegs_obj SET lat = (SELECT x.lat FROM ${T} x WHERE x.anorm = sniegs_obj.anorm AND x.lat IS NOT NULL), lng = (SELECT x.lng FROM ${T} x WHERE x.anorm = sniegs_obj.anorm AND x.lat IS NOT NULL) WHERE lat IS NULL AND EXISTS (SELECT 1 FROM ${T} x WHERE x.anorm = sniegs_obj.anorm AND x.lat IS NOT NULL)`).run().catch(() => 0);
  const L = (await db.prepare('SELECT s.anorm, o.adrese FROM sniegs_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.aktivs = 1 AND s.lat IS NULL LIMIT ?').bind(max || 10).all()).results || [];
  let ok = 0, miss = 0;
  for (const o of L) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=lv&q=' + encodeURIComponent(geoQuery(o.adrese)), { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'SH-sniegs/1.0 (+https://vaitkevix.cloud/sh/)', 'Accept-Language': 'lv' } });
      const j = r.ok ? await r.json() : [];
      if (j && j[0]) { await db.prepare('UPDATE sniegs_obj SET lat = ?, lng = ? WHERE anorm = ?').bind(+j[0].lat, +j[0].lon, o.anorm).run(); ok++; }
      else { await db.prepare('UPDATE sniegs_obj SET lat = 0, lng = 0 WHERE anorm = ?').bind(o.anorm).run(); miss++; }
    } catch (e) { break; }
    await new Promise(res => setTimeout(res, 1100));
  }
  const left = (await db.prepare('SELECT COUNT(*) n FROM sniegs_obj WHERE aktivs = 1 AND lat IS NULL').first()).n;
  return { found: ok, notFound: miss, left };
}
/* Cron ik 30 min: sniega pārbaude (prognozi atjauno wx.js); koordinātas reizi dienā */
export async function cron(env) {
  const db = env.DB, t = today();
  await snowCheck(db, env);
  if ((await kv(db, 'sniegs:ran')) === t) return;
  await db.batch([kvSet(db, 'sniegs:ran', t)]);
  await geocode(db, 5).catch(() => 0);
}

/* ---------- API ---------- */
const ROLE_W = { admin: 3, vaditajs: 2, izpilditajs: 1, skatitajs: 0 };
/* Bezsaistē atzīmēts: izpildes laiks no telefona (kad), ja ≤3 dienas vecs un nav nākotnē; citādi tagad */
const kadOf = (b) => { const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String((b && b.kad) || '')), t = today(); return m && m[1] <= t && m[1] >= addDays(t, -3) ? { d: m[1], t: m[2] } : { d: t, t: nowStr().slice(11) }; };
export async function api(request, env, X, fetchWx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB;
  let me = await personByPin(db, b.pin);
  if (!me && b.pin) { const c = await companyBy(db, 'pass', b.pin); if (c && c.perms[KEY]) me = c; }
  const GUEST = !b.pin && ['boot', 'month', 'obj'].indexOf(b.action) !== -1;   // skatīšanās bez ielogošanās (pārvaldniekiem)
  if (GUEST) me = { name: 'Pārvaldnieks', perms: { [KEY]: 'skatitajs' } };
  const role = me && (me.company ? me.perms[KEY] : ((me.perms || {})[KEY] || ((me.perms || {}).portal === 'admin' ? 'admin' : 'skatitajs')));
  if (!me || !role) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN vai nav piekļuves: ' + NAME, code: 'auth' }); }
  const need = (r) => { if ((ROLE_W[role] || 0) < ROLE_W[r]) throw new Error('Jums ir tikai skatīšanās tiesības'); };
  const a = b.action;
  try {
    if (a === 'boot') {
      const t = today();
      const objects = (await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, o.piekluve, s.aktivs, s.brigade, s.piezime, s.seq, s.dati, s.lat, s.lng FROM objects o LEFT JOIN sniegs_obj s ON s.anorm = o.anorm JOIN obj_info i ON i.anorm = o.anorm AND i.sniegs = 1 ORDER BY o.ord').all()).results || [];
      if (ROLE_W[role] < 1) objects.forEach(o => { o.piekluve = ''; });
      const ice = {}; { const wx = (await kv(db, 'wx')) || {}; Object.keys(wx).forEach(d => { const r = iceRisk(wx, d); if (r) ice[d] = r; }); }
      const calls = (await db.prepare('SELECT * FROM sniegs_call ORDER BY datums DESC, izveidots DESC LIMIT 12').all()).results || [];
      const ids = calls.slice(0, 6).map(c => c.id);
      let visits = ids.length ? ((await db.prepare('SELECT * FROM sniegs_visit WHERE izs IN (' + ids.map(() => '?').join(',') + ') ORDER BY brigade, seq, adrese').bind(...ids).all()).results || []) : [];
      const reqs = (await db.prepare("SELECT * FROM sniegs_visit WHERE izs = '' AND (statuss != 'done' OR datums >= ?) ORDER BY steidzami DESC, datums, adrese").bind(addDays(t, -7)).all()).results || [];
      visits = visits.concat(reqs);
      if (me.company) visits = visits.filter(v => !v.brigade || v.brigade === me.name);   // SIA redz savu maršrutu
      const last = (await db.prepare("SELECT anorm, MAX(datums) d FROM sniegs_visit WHERE statuss = 'done' GROUP BY anorm").all()).results || [];
      const logs = ROLE_W[role] < 2 ? [] : ((await db.prepare('SELECT laiks, teksts FROM sniegs_log ORDER BY id DESC LIMIT 30').all()).results || []);
      const crews = ((await db.prepare('SELECT name, kinds FROM companies WHERE active = 1').all()).results || []).filter(c => String(c.kinds).split(',').indexOf(KIND) !== -1).map(c => c.name);
      const chk = await chkList(db, KEY), threadN = await threadCounts(db, KEY, visits.map(v => v.id));
      return out({ ok: true, ice, checklist: chk, threadN, claims: await claimsOf(db, KEY, me), me: { name: me.name, role, company: !!me.company }, today: t, cfg: await cfgOf(db), wx: (await kv(db, 'wx')) || {}, objects, visits, calls, last, logs, crews,
        groups: (await groupsOf(db).catch(() => [])).map(g => ({ name: g.name, adreses: g.adreses })) });
    }
    if (a === 'obj') {
      let hist = (await db.prepare('SELECT id, datums, statuss, laiks, sakums, izpilditajs, foto, iemesls, piezime, avots, apraksts, izpilde, brigade FROM sniegs_visit WHERE anorm = ? ORDER BY datums DESC LIMIT 40').bind(anorm(b.anorm || b.adrese)).all()).results || [];
      if (me.company) hist = hist.filter(v => !v.brigade || v.brigade === me.name);   // SIA redz tikai savus darbus
      const ck = await chkOf(db, KEY, hist.map(h => h.id)); hist.forEach(h => { if (ck[h.id]) h.checks = ck[h.id]; });
      return out({ ok: true, hist });
    }
    if (a === 'geo') { need('vaditajs'); return out(Object.assign({ ok: true }, await geocode(db, 12))); }
    if (a === 'saveObj') {
      need('vaditajs');
      const OLD = {}; ((await db.prepare('SELECT s.anorm, s.brigade, s.aktivs, o.adrese FROM sniegs_obj s JOIN objects o ON o.anorm = s.anorm').all()).results || []).forEach(r => OLD[r.anorm] = r);
      const list = (Array.isArray(b.objs) ? b.objs : [b]).slice(0, 500), st = [];
      for (const o of list) {
        const k = anorm(o.adrese || o.anorm); if (!k) continue;
        st.push(db.prepare('INSERT INTO obj_info (anorm, sniegs) VALUES (?, 1) ON CONFLICT(anorm) DO UPDATE SET sniegs = 1').bind(k));   // grafikā = pakalpojums ieslēgts
        const act = !(o.aktivs === false || o.aktivs === 0), br = String(o.brigade || '').slice(0, 80), seq = Math.max(0, Math.min(9999, Math.round(+o.seq || 0)));
        st.push(db.prepare('INSERT INTO sniegs_obj (anorm, aktivs, brigade, piezime, seq, dati) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET aktivs = excluded.aktivs, brigade = excluded.brigade, piezime = excluded.piezime, seq = excluded.seq, dati = excluded.dati')
          .bind(k, act ? 1 : 0, br, String(o.piezime || '').slice(0, 300), seq, JSON.stringify(cleanObj(o.dati))));
        st.push(db.prepare("UPDATE sniegs_visit SET brigade = ?, seq = ? WHERE anorm = ? AND statuss = 'plan' AND sakums = ''").bind(br, seq, k));   // aktīvajā izsaukumā arī
      }
      for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
      for (const o of list.slice(0, 50)) { const w = OLD[anorm(o.adrese || o.anorm)]; if (!w) continue;   // G3
        const ch = [['Izpildītājs', w.brigade, String(o.brigade || '')], ['Aktīvs', w.aktivs ? 'jā' : 'nē', o.aktivs === false || o.aktivs === 0 ? 'nē' : 'jā']].filter(x => String(x[1]) !== String(x[2]));
        if (ch.length) await audit(db, me.name, NAME, w.adrese, ch); }
      return out({ ok: true, added: 0, moved: 0 });
    }
    if (a === 'callNow') {
      need('vaditajs');
      const d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') ? b.datums : today(), veids = b.veids === 'kaisisana' ? 'kaisisana' : 'sniegs';
      let c = await db.prepare("SELECT * FROM sniegs_call WHERE datums = ? AND statuss IN ('gaida', 'aktivs')").bind(d).first();
      if (!c) { c = { id: uid(), datums: d, veids }; await db.batch([db.prepare("INSERT INTO sniegs_call (id, datums, statuss, cm, avots, izveidots, apstiprinaja, veids) VALUES (?, ?, 'aktivs', ?, 'vaditajs', ?, ?, ?)").bind(c.id, d, +((((await kv(db, 'wx')) || {})[d] || {}).s || 0), nowStr(), me.name, veids), log(db, me.name + ' izsauca tīrīšanu ' + lvD(d))]); }
      else await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'aktivs', apstiprinaja = ? WHERE id = ?").bind(me.name, c.id)]);
      const added = await callVisits(db, c); X.bg && X.bg(kaisSnow(env, d)); X.bg && X.bg(pushCrews(env, c, me.name + ' izsauca tīrīšanu — jūsu maršruts gatavs').catch(() => 0));
      return out({ ok: true, added });
    }
    if (a === 'reorder') {   // maršruta secība traktoristam (vilkšana / ↑↓): order = [anorm…]
      need('vaditajs');
      const br = String(b.brigade || '').slice(0, 80), L = (Array.isArray(b.order) ? b.order : []).map(x => anorm(x)).filter(Boolean).slice(0, 500); if (!L.length) throw new Error('Tukšs saraksts');
      const st = [];
      L.forEach((k, i) => { st.push(db.prepare('UPDATE sniegs_obj SET seq = ? WHERE anorm = ?').bind(i + 1, k)); st.push(db.prepare("UPDATE sniegs_visit SET seq = ? WHERE anorm = ? AND brigade = ? AND statuss = 'plan' AND izs != ''").bind(i + 1, k, br)); });
      for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
      await db.batch([log(db, me.name + ' mainīja secību: ' + (br || 'bez traktorista') + ' (' + L.length + ' adreses)')]);
      await audit(db, me.name, NAME, 'Maršruts · ' + (br || 'bez traktorista'), ['Secība', '', L.length + ' adreses']);
      return out({ ok: true });
    }
    if (a === 'approve' || a === 'cancel' || a === 'finish') {
      need('vaditajs');
      const c = await db.prepare('SELECT * FROM sniegs_call WHERE id = ?').bind(String(b.id || '')).first(); if (!c) throw new Error('Izsaukums nav atrasts');
      await audit(db, me.name, NAME, 'Izsaukums ' + lvD(c.datums) + (c.veids === 'kaisisana' ? ' (kaisīšana)' : ''), ['Statuss', c.statuss, a === 'approve' ? 'aktivs' : a === 'cancel' ? 'atcelts' : 'beigts']);   // G3
      if (a === 'approve') { await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'aktivs', apstiprinaja = ? WHERE id = ?").bind(me.name, c.id), log(db, me.name + ' apstiprināja izsaukumu ' + lvD(c.datums))]); const added = await callVisits(db, c); X.bg && X.bg(kaisSnow(env, c.datums)); X.bg && X.bg(pushCrews(env, c, 'Apstiprināts — jūsu maršruts gatavs').catch(() => 0)); return out({ ok: true, added }); }
      if (a === 'cancel') { await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'atcelts', beigts = ? WHERE id = ?").bind(nowStr(), c.id), db.prepare("DELETE FROM sniegs_visit WHERE izs = ? AND statuss = 'plan' AND sakums = ''").bind(c.id), log(db, me.name + ' atcēla izsaukumu ' + lvD(c.datums))]); return out({ ok: true }); }
      await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'beigts', beigts = ? WHERE id = ?").bind(nowStr(), c.id), log(db, me.name + ' pabeidza izsaukumu ' + lvD(c.datums))]);
      return out({ ok: true });
    }
    if (a === 'start' || a === 'done' || a === 'cant') {
      need('izpilditajs');
      const v = await db.prepare('SELECT * FROM sniegs_visit WHERE id = ?').bind(String(b.id || '')).first(); if (!v) throw new Error('Nav atrasts — atjaunojiet'); await assertOpen(db, v.datums);
      if (v.izs) { const c = await db.prepare('SELECT statuss FROM sniegs_call WHERE id = ?').bind(v.izs).first(); if (!c || c.statuss !== 'aktivs') throw new Error('Izsaukums nav aktīvs'); }
      if (me.company && v.brigade && v.brigade !== me.name) throw new Error('Šī adrese nav jūsu maršrutā');
      if (v.statuss === 'done') return out({ ok: true, already: true });
      if (a === 'start') { if (!v.sakums) await db.batch([db.prepare('UPDATE sniegs_visit SET sakums = ?, izpilditajs = ? WHERE id = ?').bind(nowStr().slice(11), (me.who || me.name), v.id)]); return out({ ok: true }); }
      if (a === 'done') {
        const C = await cfgOf(db), photos = (b.photos || []).filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(String(p))).slice(0, 4);
        const lst = (() => { try { return (JSON.parse(v.dati || '{}').veidi || []).indexOf(LAST) !== -1; } catch (e) { return false; } })();
        if ((C.photoReq || lst) && !photos.length) throw new Error('Pievienojiet bildi pēc tīrīšanas');
        if (lst && !(b.izpilde && b.izpilde.zona)) throw new Error('Lāstekas: atzīmējiet, ka riska zona bija norobežota');
        const ov = await db.prepare('SELECT * FROM sniegs_obj WHERE anorm = ?').bind(v.anorm).first().catch(() => null), vd = (() => { try { return JSON.parse(v.dati || '{}').veidi || []; } catch (e) { return []; } })();
        const ck = await chkTake(db, KEY, v.id, me.who || me.name, b.checks, vd.concat(String((ov && ov.veidi) || '').split(',').map(x => x.trim()).filter(Boolean)));   // G1 — obligātie punkti bloķē
        const ids = photos.length ? await X.savePhotos({ datums: v.datums, adrese: NAME + ' · ' + v.adrese }, photos) : [];
        await db.batch([db.prepare("UPDATE sniegs_visit SET statuss = 'done', sakums = CASE WHEN sakums = '' THEN ? ELSE sakums END, laiks = ?, izpilditajs = ?, foto = ?, piezime = ?, izpilde = ? WHERE id = ?")
          .bind(kadOf(b).t, kadOf(b).t, (me.who || me.name), ids.join(','), String(b.piezime || '').slice(0, 300), JSON.stringify(cleanDone(b.izpilde)), v.id)].concat(ck ? [ck] : []));
      } else {
        const why = String(b.iemesls || 'Nevar').slice(0, 60);
        await db.batch([db.prepare("UPDATE sniegs_visit SET statuss = 'cant', iemesls = ?, izpilditajs = ?, laiks = ? WHERE id = ?").bind(why, (me.who || me.name), nowStr().slice(11), v.id), log(db, v.adrese + ': ' + why.toLowerCase() + ' (' + (me.who || me.name) + ')')]);
        X.bg && X.bg(managers(env, KEY).then(m => notify(env, m.filter(n => n !== me.name), { title: 'Sniega tīrīšana · nevar', body: v.adrese + ': ' + why + ' (' + me.name + ')', url: '/sh/#sniegs' })).catch(() => 0));
      }
      return out({ ok: true });
    }
    if (a === 'request') {   // papildu pieteikums konkrētai adresei (ārpus izsaukuma)
      need('vaditajs');
      const k = anorm(b.adrese); const o = k && await db.prepare('SELECT adrese FROM objects WHERE anorm = ?').bind(k).first(); if (!o) throw new Error('Izvēlieties adresi no saraksta');
      const t = today(), d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') && b.datums >= t ? b.datums : t;
      const so = await db.prepare('SELECT brigade FROM sniegs_obj WHERE anorm = ?').bind(k).first(), id = uid();
      const br = String(b.brigade || (so && so.brigade) || '');
      if (b.steidzami && X.bg) X.bg((async () => { const who = await personNames(env, [br]); await notify(env, who.length ? who : await managers(env, KEY), { title: '⚡ Steidzami · Sniega tīrīšana', body: o.adrese + (b.apraksts ? ' — ' + String(b.apraksts).slice(0, 80) : ''), url: '/sh/#sniegs', urgent: true }); })().catch(() => 0));
      await db.batch([db.prepare("INSERT INTO sniegs_visit (id, izs, anorm, adrese, datums, brigade, avots, steidzami, apraksts, dati, pieteica, izveidots) VALUES (?, '', ?, ?, ?, ?, 'pieteikums', ?, ?, ?, ?, ?)")
        .bind(id, k, o.adrese, d, String(b.brigade || (so && so.brigade) || '').slice(0, 80), b.steidzami ? 1 : 0, String(b.apraksts || '').slice(0, 500), JSON.stringify(cleanReq(b.dati)), me.name, nowStr()),
        log(db, me.name + ' pieteica: ' + o.adrese + (b.steidzami ? ' (steidzami)' : ''))]);
      return out({ ok: true, id });
    }
    if (a === 'report') {   // mēneša stundas, kaisīšana, kravas (rēķinam)
      need('vaditajs');
      const ym = String(b.ym || today().slice(0, 7)).slice(0, 7);
      const rows = (await db.prepare("SELECT id, adrese, datums, izpilditajs, brigade, sakums, laiks, izpilde, avots FROM sniegs_visit WHERE statuss = 'done' AND substr(datums, 1, 7) = ? ORDER BY datums").bind(ym).all()).results || [];
      return out({ ok: true, rows: me.company ? rows.filter(r => !r.brigade || r.brigade === me.name) : rows });
    }
    if (a === 'reopen') {   // «nevar» → atpakaļ maršrutā
      need('vaditajs');
      await db.batch([db.prepare("UPDATE sniegs_visit SET statuss = 'plan', iemesls = '' WHERE id = ? AND statuss = 'cant'").bind(String(b.id || ''))]);
      return out({ ok: true });
    }
    if (a === 'saveCfg') {
      need('admin'); const c = b.cfg || {}, n = Object.assign({}, await cfgOf(db));
      if (c.snowCm != null && c.snowCm !== '' && !isNaN(+c.snowCm)) n.snowCm = Math.max(0.5, Math.min(100, +c.snowCm));
      ['auto', 'approve', 'photoReq', 'ice'].forEach(k => { if (typeof c[k] === 'boolean') n[k] = c[k]; });
      if (Array.isArray(c.veidi)) { const v = c.veidi.map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 12); if (v.length) n.veidi = v; }
      await db.batch([kvSet(db, 'sniegs:cfg', n)]);
      return out({ ok: true, cfg: n });
    }
    if (a === 'replan') { need('vaditajs'); await fetchWx(db).catch(() => 0); return out({ ok: true, added: await snowCheck(db, env), moved: 0 }); }
    if (a === 'chkSave') { need('admin'); return out({ ok: true, checklist: await chkSave(db, KEY, NAME, me.name, b.list) }); }
    if (a === 'thread' || a === 'threadAdd') { const v = await db.prepare('SELECT id, adrese, datums, brigade, izpilditajs FROM sniegs_visit WHERE id = ?').bind(String(b.id || '')).first(); return out(Object.assign({ ok: true }, await threadApi(env, X, KEY, NAME, v, me, ROLE_W[role] || 0, b))); }
    if (a === 'claim' || a === 'claimFix') return out(Object.assign({ ok: true }, await claimApi(env, X, KEY, NAME, 'sniegs_visit', me, ROLE_W[role] || 0, b), { claims: await claimsOf(db, KEY, me) }));   // E3 pretenzijas
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
