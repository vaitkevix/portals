/* SH | Sniega tīrīšana — izsaukums pēc sniega prognozes (vadītājs apstiprina / atceļ) vai ar pogu; katram traktoristam (vai SIA) savs maršruts secībā,
 * izpildītājs atzīmē sākumu, beigas un bildi. © VAITKEVIX, SIA
 * Maršruts POST /sniegs  { pin, action, … }.  Lomas: perms.sniegs = admin | vaditajs | izpilditajs; portāla admins = admin, citi = skatitajs; SIA ar veidu «traktorists» = izpilditajs.
 * Tabulas: sniegs_obj (traktorists, secība), sniegs_call (izsaukumi), sniegs_visit (adrese izsaukumā), sniegs_log. Laikapstākļi — kv 'wx' (wx.js). */
import { personByPin, companyBy } from './portal.js';
import { groupsOf } from './master.js';
import { today, addDays, nowStr, uid, anorm, lvD, kv, kvSet, geoQuery, CORS, out } from './util.js';

export const KEY = 'sniegs', NAME = 'Sniega tīrīšana', KIND = 'traktorists';
export const DEF_CFG = { snowCm: 3, auto: true, approve: true, photoReq: true, veidi: ['Brauktuve', 'Ietves', 'Stāvlaukums', 'Kaisīts'] };
async function cfgOf(db) { return Object.assign({}, DEF_CFG, (await kv(db, 'sniegs:cfg')) || {}); }
const log = (db, t) => db.prepare('INSERT INTO sniegs_log (laiks, teksts) VALUES (?, ?)').bind(nowStr(), String(t).slice(0, 300));

/* Izsaukuma adreses — visi aktīvie objekti ar savu traktoristu un secību */
async function callVisits(db, call) {
  const objs = (await db.prepare('SELECT s.anorm, o.adrese, s.brigade, s.seq FROM sniegs_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.aktivs = 1 ORDER BY s.brigade, s.seq, o.adrese').all()).results || [];
  const have = new Set(((await db.prepare('SELECT anorm FROM sniegs_visit WHERE izs = ?').bind(call.id).all()).results || []).map(r => r.anorm));
  const st = objs.filter(o => !have.has(o.anorm)).map(o => db.prepare('INSERT INTO sniegs_visit (id, izs, anorm, adrese, datums, brigade, seq, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), call.id, o.anorm, o.adrese, call.datums, o.brigade || '', +o.seq || 0, nowStr()));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  return st.length;
}
/* Prognoze ≥ slieksnis šodien / rīt → izsaukums (gaida apstiprinājumu vai uzreiz aktīvs) */
export async function snowCheck(db) {
  const C = await cfgOf(db), wx = (await kv(db, 'wx')) || {}, t = today(); let made = 0;
  if (!C.auto) return 0;
  for (const d of [t, addDays(t, 1)]) {
    const cm = +((wx[d] || {}).s || 0); if (cm < C.snowCm) continue;
    if (await db.prepare('SELECT id FROM sniegs_call WHERE datums = ?').bind(d).first()) continue;
    const call = { id: uid(), datums: d, statuss: C.approve ? 'gaida' : 'aktivs' };
    await db.batch([db.prepare('INSERT INTO sniegs_call (id, datums, statuss, cm, avots, izveidots) VALUES (?, ?, ?, ?, ?, ?)').bind(call.id, d, call.statuss, cm, 'prognoze', nowStr()),
      log(db, 'Prognoze ' + cm.toFixed(1) + ' cm ' + lvD(d) + ' → izsaukums ' + (C.approve ? 'gaida apstiprinājumu' : 'aktīvs'))]);
    if (call.statuss === 'aktivs') await callVisits(db, call);
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
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=lv&q=' + encodeURIComponent(geoQuery(o.adrese)), { headers: { 'User-Agent': 'SH-sniegs/1.0 (+https://vaitkevix.cloud/sh/)', 'Accept-Language': 'lv' } });
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
  await snowCheck(db);
  if ((await kv(db, 'sniegs:ran')) === t) return;
  await db.batch([kvSet(db, 'sniegs:ran', t)]);
  await geocode(db, 5).catch(() => 0);
}

/* ---------- API ---------- */
const ROLE_W = { admin: 3, vaditajs: 2, izpilditajs: 1, skatitajs: 0 };
export async function api(request, env, X, fetchWx) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB;
  let me = await personByPin(db, b.pin);
  if (!me && b.pin) { const c = await companyBy(db, 'pass', b.pin); if (c && c.perms[KEY]) me = c; }
  const role = me && (me.company ? me.perms[KEY] : ((me.perms || {})[KEY] || ((me.perms || {}).portal === 'admin' ? 'admin' : 'skatitajs')));
  if (!me || !role) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN vai nav piekļuves: ' + NAME, code: 'auth' }); }
  const need = (r) => { if ((ROLE_W[role] || 0) < ROLE_W[r]) throw new Error('Jums ir tikai skatīšanās tiesības'); };
  const a = b.action;
  try {
    if (a === 'boot') {
      const t = today();
      const objects = (await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, o.piekluve, s.aktivs, s.brigade, s.piezime, s.seq, s.lat, s.lng FROM objects o LEFT JOIN sniegs_obj s ON s.anorm = o.anorm ORDER BY o.ord').all()).results || [];
      if (ROLE_W[role] < 1) objects.forEach(o => { o.piekluve = ''; });
      const calls = (await db.prepare('SELECT * FROM sniegs_call ORDER BY datums DESC, izveidots DESC LIMIT 12').all()).results || [];
      const ids = calls.slice(0, 6).map(c => c.id);
      let visits = ids.length ? ((await db.prepare('SELECT * FROM sniegs_visit WHERE izs IN (' + ids.map(() => '?').join(',') + ') ORDER BY brigade, seq, adrese').bind(...ids).all()).results || []) : [];
      if (me.company) visits = visits.filter(v => !v.brigade || v.brigade === me.name);   // SIA redz savu maršrutu
      const last = (await db.prepare("SELECT anorm, MAX(datums) d FROM sniegs_visit WHERE statuss = 'done' GROUP BY anorm").all()).results || [];
      const logs = ROLE_W[role] < 2 ? [] : ((await db.prepare('SELECT laiks, teksts FROM sniegs_log ORDER BY id DESC LIMIT 30').all()).results || []);
      const crews = ((await db.prepare('SELECT name, kinds FROM companies WHERE active = 1').all()).results || []).filter(c => String(c.kinds).split(',').indexOf(KIND) !== -1).map(c => c.name);
      return out({ ok: true, me: { name: me.name, role, company: !!me.company }, today: t, cfg: await cfgOf(db), wx: (await kv(db, 'wx')) || {}, objects, visits, calls, last, logs, crews,
        groups: (await groupsOf(db).catch(() => [])).map(g => ({ name: g.name, adreses: g.adreses })) });
    }
    if (a === 'obj') {
      const hist = (await db.prepare('SELECT id, datums, statuss, laiks, sakums, izpilditajs, foto, iemesls, piezime FROM sniegs_visit WHERE anorm = ? ORDER BY datums DESC LIMIT 40').bind(anorm(b.anorm || b.adrese)).all()).results || [];
      return out({ ok: true, hist });
    }
    if (a === 'geo') { need('vaditajs'); return out(Object.assign({ ok: true }, await geocode(db, 12))); }
    if (a === 'saveObj') {
      need('vaditajs');
      const list = (Array.isArray(b.objs) ? b.objs : [b]).slice(0, 500), st = [];
      for (const o of list) {
        const k = anorm(o.adrese || o.anorm); if (!k) continue;
        const act = !(o.aktivs === false || o.aktivs === 0), br = String(o.brigade || '').slice(0, 80), seq = Math.max(0, Math.min(9999, Math.round(+o.seq || 0)));
        st.push(db.prepare('INSERT INTO sniegs_obj (anorm, aktivs, brigade, piezime, seq) VALUES (?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET aktivs = excluded.aktivs, brigade = excluded.brigade, piezime = excluded.piezime, seq = excluded.seq')
          .bind(k, act ? 1 : 0, br, String(o.piezime || '').slice(0, 300), seq));
        st.push(db.prepare("UPDATE sniegs_visit SET brigade = ?, seq = ? WHERE anorm = ? AND statuss = 'plan' AND sakums = ''").bind(br, seq, k));   // aktīvajā izsaukumā arī
      }
      for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
      return out({ ok: true, added: 0, moved: 0 });
    }
    if (a === 'callNow') {
      need('vaditajs');
      const d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') ? b.datums : today();
      let c = await db.prepare("SELECT * FROM sniegs_call WHERE datums = ? AND statuss IN ('gaida', 'aktivs')").bind(d).first();
      if (!c) { c = { id: uid(), datums: d }; await db.batch([db.prepare("INSERT INTO sniegs_call (id, datums, statuss, cm, avots, izveidots, apstiprinaja) VALUES (?, ?, 'aktivs', ?, 'vaditajs', ?, ?)").bind(c.id, d, +((((await kv(db, 'wx')) || {})[d] || {}).s || 0), nowStr(), me.name), log(db, me.name + ' izsauca tīrīšanu ' + lvD(d))]); }
      else await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'aktivs', apstiprinaja = ? WHERE id = ?").bind(me.name, c.id)]);
      return out({ ok: true, added: await callVisits(db, c) });
    }
    if (a === 'approve' || a === 'cancel' || a === 'finish') {
      need('vaditajs');
      const c = await db.prepare('SELECT * FROM sniegs_call WHERE id = ?').bind(String(b.id || '')).first(); if (!c) throw new Error('Izsaukums nav atrasts');
      if (a === 'approve') { await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'aktivs', apstiprinaja = ? WHERE id = ?").bind(me.name, c.id), log(db, me.name + ' apstiprināja izsaukumu ' + lvD(c.datums))]); return out({ ok: true, added: await callVisits(db, c) }); }
      if (a === 'cancel') { await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'atcelts', beigts = ? WHERE id = ?").bind(nowStr(), c.id), db.prepare("DELETE FROM sniegs_visit WHERE izs = ? AND statuss = 'plan' AND sakums = ''").bind(c.id), log(db, me.name + ' atcēla izsaukumu ' + lvD(c.datums))]); return out({ ok: true }); }
      await db.batch([db.prepare("UPDATE sniegs_call SET statuss = 'beigts', beigts = ? WHERE id = ?").bind(nowStr(), c.id), log(db, me.name + ' pabeidza izsaukumu ' + lvD(c.datums))]);
      return out({ ok: true });
    }
    if (a === 'start' || a === 'done' || a === 'cant') {
      need('izpilditajs');
      const v = await db.prepare('SELECT * FROM sniegs_visit WHERE id = ?').bind(String(b.id || '')).first(); if (!v) throw new Error('Nav atrasts — atjaunojiet');
      const c = await db.prepare('SELECT statuss FROM sniegs_call WHERE id = ?').bind(v.izs).first();
      if (!c || c.statuss !== 'aktivs') throw new Error('Izsaukums nav aktīvs');
      if (me.company && v.brigade && v.brigade !== me.name) throw new Error('Šī adrese nav jūsu maršrutā');
      if (v.statuss === 'done') return out({ ok: true, already: true });
      if (a === 'start') { if (!v.sakums) await db.batch([db.prepare('UPDATE sniegs_visit SET sakums = ?, izpilditajs = ? WHERE id = ?').bind(nowStr().slice(11), me.name, v.id)]); return out({ ok: true }); }
      if (a === 'done') {
        const C = await cfgOf(db), photos = (b.photos || []).filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(String(p))).slice(0, 4);
        if (C.photoReq && !photos.length) throw new Error('Pievienojiet bildi pēc tīrīšanas');
        const ids = photos.length ? await X.savePhotos({ datums: v.datums, adrese: NAME + ' · ' + v.adrese }, photos) : [];
        await db.batch([db.prepare("UPDATE sniegs_visit SET statuss = 'done', sakums = CASE WHEN sakums = '' THEN ? ELSE sakums END, laiks = ?, izpilditajs = ?, foto = ?, piezime = ? WHERE id = ?")
          .bind(nowStr().slice(11), nowStr().slice(11), me.name, ids.join(','), String(b.piezime || '').slice(0, 300), v.id)]);
      } else {
        const why = String(b.iemesls || 'Nevar').slice(0, 60);
        await db.batch([db.prepare("UPDATE sniegs_visit SET statuss = 'cant', iemesls = ?, izpilditajs = ?, laiks = ? WHERE id = ?").bind(why, me.name, nowStr().slice(11), v.id), log(db, v.adrese + ': ' + why.toLowerCase() + ' (' + me.name + ')')]);
      }
      return out({ ok: true });
    }
    if (a === 'reopen') {   // «nevar» → atpakaļ maršrutā
      need('vaditajs');
      await db.batch([db.prepare("UPDATE sniegs_visit SET statuss = 'plan', iemesls = '' WHERE id = ? AND statuss = 'cant'").bind(String(b.id || ''))]);
      return out({ ok: true });
    }
    if (a === 'saveCfg') {
      need('admin'); const c = b.cfg || {}, n = Object.assign({}, await cfgOf(db));
      if (c.snowCm != null && c.snowCm !== '' && !isNaN(+c.snowCm)) n.snowCm = Math.max(0.5, Math.min(100, +c.snowCm));
      ['auto', 'approve', 'photoReq'].forEach(k => { if (typeof c[k] === 'boolean') n[k] = c[k]; });
      if (Array.isArray(c.veidi)) { const v = c.veidi.map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 12); if (v.length) n.veidi = v; }
      await db.batch([kvSet(db, 'sniegs:cfg', n)]);
      return out({ ok: true, cfg: n });
    }
    if (a === 'replan') { need('vaditajs'); await fetchWx(db).catch(() => 0); return out({ ok: true, added: await snowCheck(db), moved: 0 }); }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
