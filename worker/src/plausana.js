/* SH | Zāles pļaušana — grafiks, kas veidojas pats (intervāls, slodze, lietus, nepaspētie), izpilde ar bildi. © VAITKEVIX, SIA
 * Maršruts POST /pl  { pin, action, … }.  Lomas portālā: perms.pl = admin | vaditajs | izpilditajs.
 * Objekti un grupas — no portāla (tabulas objects, groups); pļaušanai savas tabulas pl_obj, pl_visit, pl_log. */
import { personByPin, companyBy } from './portal.js';
import { groupsOf } from './master.js';

const TZ = 'Europe/Riga';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS) });
const fmtD = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtT = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const today = () => fmtD.format(new Date());
const nowStr = () => fmtT.format(new Date()).replace(',', '').slice(0, 16);
export const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };   // 1 = P … 7 = Sv
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const anorm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const lvD = (d) => { const [y, m, dd] = d.split('-'); return +dd + '.' + m + '.'; };

export const DEF_CFG = { rainMm: 3, wetDays: 1, maxM2: 6000, workdays: [1, 2, 3, 4, 5], interval: 10, season: ['04-15', '10-15'], photoReq: true };

async function kv(db, k) { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); try { return r ? JSON.parse(r.v) : null; } catch (e) { return null; } }
const kvSet = (db, k, v) => db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, JSON.stringify(v));
async function cfgOf(db) { return Object.assign({}, DEF_CFG, (await kv(db, 'pl:cfg')) || {}); }
const log = (db, t) => db.prepare('INSERT INTO pl_log (laiks, teksts) VALUES (?, ?)').bind(nowStr(), String(t).slice(0, 300));

/* Nākamā darba diena bez lietus / slapja zāliena, sākot ar «from» */
export function nextDay(from, cfg, rain) {
  const C = Object.assign({}, DEF_CFG, cfg || {});
  const wet = (d) => { for (let i = 0; i <= C.wetDays; i++) if ((rain[addDays(d, -i)] || 0) >= C.rainMm) return true; return false; };
  let d = from; for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (C.workdays.indexOf(dow(d)) !== -1 && !wet(d)) return d;
  return from;
}

/* ---------- Grafika aprēķins (tīra funkcija — testējama bez D1) ----------
 * objs: [{anorm, adrese, m2, intervals, brigade}], visits: [{id, anorm, datums, statuss, prio}], rain: {datums: mm}
 * atgriež { moves: [{id, datums, why}], adds: [{anorm, adrese, datums, brigade}] } */
export function plan(objs, visits, cfg, rain, t) {
  const C = Object.assign({}, DEF_CFG, cfg || {});
  const wet = (d) => { for (let i = 0; i <= C.wetDays; i++) if ((rain[addDays(d, -i)] || 0) >= C.rainMm) return true; return false; };
  const inSeason = (d) => { const md = d.slice(5); return md >= C.season[0] && md <= C.season[1]; };
  const okDay = (d) => C.workdays.indexOf(dow(d)) !== -1 && !wet(d);
  const m2Of = {}; objs.forEach(o => m2Of[o.anorm] = +o.m2 || 0);
  const load = {}; const addLoad = (d, a) => { load[d] = (load[d] || 0) + (m2Of[a] || 0); };
  const firstDay = (from, need) => { let d = from; for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (okDay(d) && (load[d] || 0) + need <= C.maxM2) return d;
    d = from; for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (okDay(d)) return d; return from; };   // pārpildīts → vismaz darba diena
  const moves = [], adds = [];
  const plans = visits.filter(v => v.statuss === 'plan');
  // 1) nepaspētie no pagātnes → pirmā derīgā diena no šodienas, pirmie rindā
  plans.filter(v => v.datums < t).sort((a, b) => a.datums.localeCompare(b.datums)).forEach(v => {
    const d = firstDay(t, m2Of[v.anorm] || 0); moves.push({ id: v.id, datums: d, why: 'nepaspēts ' + lvD(v.datums) }); v.datums = d; v.prio = 1; });
  // 2) lietus / slapjš zāliens tuvākajās dienās → nākamā sausā
  plans.filter(v => v.datums >= t && v.datums <= addDays(t, 3) && !okDay(v.datums) && C.workdays.indexOf(dow(v.datums)) !== -1).forEach(v => {
    const d = firstDay(addDays(v.datums, 1), m2Of[v.anorm] || 0); moves.push({ id: v.id, datums: d, why: 'lietus ' + lvD(v.datums) }); v.datums = d; v.prio = 1; });
  plans.filter(v => v.datums >= t).forEach(v => addLoad(v.datums, v.anorm));
  // 3) jauni izbraukumi objektiem bez nākotnes plāna — no pēdējās īstās pļaušanas + intervāls
  const lastDone = {}; visits.filter(v => v.statuss === 'done').forEach(v => { if (!lastDone[v.anorm] || v.datums > lastDone[v.anorm]) lastDone[v.anorm] = v.datums; });
  const hasPlan = new Set(plans.filter(v => v.datums >= t).map(v => v.anorm));
  objs.filter(o => (+o.m2 > 0) && !hasPlan.has(o.anorm))
    .map(o => ({ o, due: lastDone[o.anorm] ? addDays(lastDone[o.anorm], +o.intervals || C.interval) : t }))
    .sort((a, b) => a.due.localeCompare(b.due))
    .forEach(({ o, due }) => {
      let from = due < t ? t : due;
      if (!inSeason(from)) { const y = from.slice(0, 4), s = y + '-' + C.season[0]; if (from < s) from = s; else return; }
      const d = firstDay(from, +o.m2); adds.push({ anorm: o.anorm, adrese: o.adrese, datums: d, brigade: o.brigade || '' }); addLoad(d, o.anorm);
    });
  return { moves, adds };
}

export async function schedule(db) {
  const C = await cfgOf(db), t = today(), rain = (await kv(db, 'pl:rain')) || {};
  const objs = (await db.prepare('SELECT p.anorm, o.adrese, p.m2, p.intervals, p.brigade FROM pl_obj p JOIN objects o ON o.anorm = p.anorm WHERE p.aktivs = 1').all()).results || [];
  const visits = (await db.prepare("SELECT id, anorm, datums, statuss, prio FROM pl_visit WHERE statuss = 'plan' OR (statuss = 'done' AND datums >= ?)").bind(addDays(t, -120)).all()).results || [];
  const r = plan(objs, visits, C, rain, t), st = [];
  const adrOf = {}; objs.forEach(o => adrOf[o.anorm] = o.adrese); const vOf = {}; visits.forEach(v => vOf[v.id] = v);
  r.moves.forEach(m => { st.push(db.prepare('UPDATE pl_visit SET datums = ?, prio = 1, parcelts = parcelts + 1 WHERE id = ?').bind(m.datums, m.id));
    st.push(log(db, (adrOf[(vOf[m.id] || {}).anorm] || 'Adrese') + ' → ' + lvD(m.datums) + ' (' + m.why + ')')); });
  r.adds.forEach(a => st.push(db.prepare('INSERT INTO pl_visit (id, anorm, adrese, datums, brigade, izveidots) VALUES (?, ?, ?, ?, ?, ?)').bind(uid(), a.anorm, a.adrese, a.datums, a.brigade, nowStr())));
  if (st.length) await db.batch(st);
  return { moved: r.moves.length, added: r.adds.length };
}

/* Lietus prognoze (Open-Meteo, bez atslēgas) — Rīga; mm pa dienām */
export async function fetchRain(db) {
  const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11&daily=precipitation_sum&timezone=Europe%2FRiga&past_days=2&forecast_days=5');
  if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  const j = await r.json(), m = {};
  (j.daily && j.daily.time || []).forEach((d, i) => m[d] = +(j.daily.precipitation_sum[i] || 0));
  await db.batch([kvSet(db, 'pl:rain', m)]);
  return m;
}
/* Koordinātas no adreses (OpenStreetMap Nominatim, ≤ 1 pieprasījums sekundē) — tikai pļaušanas objektiem bez koordinātām */
function geoQuery(adr) {
  let a = String(adr || '').trim(), city = 'Rīga';
  if (/^\s*j\s*\|/i.test(a)) city = 'Jūrmala';
  a = a.replace(/^\s*(j|vn[iī])\s*\|\s*/i, '').replace(/,?\s*latvija.*$/i, '').replace(/,?\s*lv-?\d{4}\b/i, '');
  a = a.replace(/(\d+[a-z]?)\s*,\s*\d+[a-z]?(\s*,\s*\d+[a-z]?)*/i, '$1').replace(/\s+k-\d+/i, '');   // «4, 6» → «4»; korpusus nost
  if (!/r[iī]ga|j[uū]rmala|mārupe|marupe|ķekava|kekava|salaspils|ādaži|adazi/i.test(a)) a += ', ' + city;
  return a + ', Latvija';
}
export async function geocode(db, max) {
  const L = (await db.prepare("SELECT p.anorm, o.adrese FROM pl_obj p JOIN objects o ON o.anorm = p.anorm WHERE p.aktivs = 1 AND p.m2 > 0 AND p.lat IS NULL LIMIT ?").bind(max || 10).all()).results || [];
  let ok = 0, miss = 0;
  for (const o of L) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=lv&q=' + encodeURIComponent(geoQuery(o.adrese)), { headers: { 'User-Agent': 'SH-plausana/1.0 (+https://vaitkevix.cloud/sh/)', 'Accept-Language': 'lv' } });
      const j = r.ok ? await r.json() : [];
      if (j && j[0]) { await db.prepare('UPDATE pl_obj SET lat = ?, lng = ? WHERE anorm = ?').bind(+j[0].lat, +j[0].lon, o.anorm).run(); ok++; }
      else { await db.prepare('UPDATE pl_obj SET lat = 0, lng = 0 WHERE anorm = ?').bind(o.anorm).run(); miss++; }
    } catch (e) { break; }
    await new Promise(res => setTimeout(res, 1100));
  }
  const left = (await db.prepare('SELECT COUNT(*) n FROM pl_obj WHERE aktivs = 1 AND m2 > 0 AND lat IS NULL').first()).n;
  return { found: ok, notFound: miss, left };
}

/* Cron: reizi dienā no 05:00 (Rīgas laiks) — prognoze + grafiks */
export async function plCron(env) {
  const db = env.DB, t = today(), h = +fmtT.format(new Date()).slice(11, 13);
  if (h < 5 || (await kv(db, 'pl:ran')) === t) return;
  await db.batch([kvSet(db, 'pl:ran', t)]);
  await fetchRain(db).catch(e => console.error('pl rain', e));
  await schedule(db);
  await geocode(db, 20).catch(e => console.error('pl geo', e));
}

/* ---------- API ---------- */
const ROLE_W = { admin: 3, vaditajs: 2, izpilditajs: 1, skatitajs: 0 };
export async function plausana(request, env, X) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB;
  let me = await personByPin(db, b.pin);
  if (!me && b.pin) { const c = await companyBy(db, 'pass', b.pin); if (c && c.perms.pl) me = c; }   // darbu izpildītājs (SIA) ar pilnvaru pļaušanai
  const role = me && (me.company ? me.perms.pl : ((me.perms || {}).pl || ((me.perms || {}).portal === 'admin' ? 'admin' : 'skatitajs')));
  if (!me || !role) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN vai nav piekļuves pļaušanai', code: 'auth' }); }
  const need = (r) => { if ((ROLE_W[role] || 0) < ROLE_W[r]) throw new Error('Jums ir tikai skatīšanās tiesības'); };
  const a = b.action;
  try {
    if (a === 'boot') {
      const t = today(), from = b.from || addDays(t, -7), to = b.to || addDays(t, 14);
      const objects = (await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, o.piekluve, p.m2, p.intervals, p.aktivs, p.brigade, p.piezime, p.lat, p.lng FROM objects o LEFT JOIN pl_obj p ON p.anorm = o.anorm ORDER BY o.ord').all()).results || [];
      if (ROLE_W[role] < 1) objects.forEach(o => { o.piekluve = ''; });   // vārtu / atslēgu kodi — tikai izpildītājam un vadītājam
      const visits = (await db.prepare('SELECT * FROM pl_visit WHERE datums >= ? AND datums <= ? ORDER BY datums, prio DESC, adrese').bind(from, to).all()).results || [];
      const last = (await db.prepare("SELECT anorm, MAX(datums) d FROM pl_visit WHERE statuss = 'done' GROUP BY anorm").all()).results || [];
      const logs = ROLE_W[role] < 2 ? [] : ((await db.prepare('SELECT laiks, teksts FROM pl_log ORDER BY id DESC LIMIT 30').all()).results || []);
      return out({ ok: true, me: { name: me.name, role }, today: t, cfg: await cfgOf(db), rain: (await kv(db, 'pl:rain')) || {}, objects, visits, last, logs,
        groups: (await groupsOf(db).catch(() => [])).map(g => ({ name: g.name, adreses: g.adreses })) });
    }
    if (a === 'month') {
      const ym = String(b.ym || today().slice(0, 7)).slice(0, 7);
      const visits = (await db.prepare("SELECT id, anorm, adrese, datums, statuss, prio, parcelts, foto, izpilditajs, laiks, iemesls FROM pl_visit WHERE substr(datums, 1, 7) = ? ORDER BY datums").bind(ym).all()).results || [];
      return out({ ok: true, visits });
    }
    if (a === 'obj') {
      const k = anorm(b.anorm || b.adrese);
      const hist = (await db.prepare('SELECT id, datums, statuss, laiks, izpilditajs, foto, iemesls, piezime, parcelts FROM pl_visit WHERE anorm = ? ORDER BY datums DESC LIMIT 40').bind(k).all()).results || [];
      return out({ ok: true, hist });
    }
    if (a === 'geo') { need('vaditajs'); return out(Object.assign({ ok: true }, await geocode(db, 12))); }
    if (a === 'saveObj') {
      need('vaditajs');
      const list = (Array.isArray(b.objs) ? b.objs : [b]).slice(0, 500), st = [];
      for (const o of list) {
        const k = anorm(o.adrese || o.anorm); if (!k) continue;
        st.push(db.prepare('INSERT INTO pl_obj (anorm, m2, intervals, aktivs, brigade, piezime) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET m2 = excluded.m2, intervals = excluded.intervals, aktivs = excluded.aktivs, brigade = excluded.brigade, piezime = excluded.piezime')
          .bind(k, Math.max(0, Math.min(1e6, +o.m2 || 0)), Math.max(1, Math.min(90, Math.round(+o.intervals || 10))), o.aktivs === false || o.aktivs === 0 ? 0 : 1, String(o.brigade || '').slice(0, 60), String(o.piezime || '').slice(0, 300)));
        if (o.aktivs === false || o.aktivs === 0) st.push(db.prepare("DELETE FROM pl_visit WHERE anorm = ? AND statuss = 'plan'").bind(k));
      }
      if (st.length) await db.batch(st);
      return out(Object.assign({ ok: true }, await schedule(db)));
    }
    if (a === 'done' || a === 'cant') {
      need('izpilditajs');
      const v = await db.prepare('SELECT * FROM pl_visit WHERE id = ?').bind(String(b.id || '')).first();
      if (!v) throw new Error('Izbraukums nav atrasts — atjaunojiet');
      if (v.statuss === 'done') return out({ ok: true, already: true });
      if (a === 'done') {
        const C = await cfgOf(db), photos = (b.photos || []).filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(String(p))).slice(0, 4);
        if (C.photoReq && !photos.length) throw new Error('Pievienojiet bildi pēc pļaušanas');
        const ids = photos.length ? await X.savePhotos({ datums: v.datums, adrese: 'Pļaušana · ' + v.adrese }, photos) : [];
        await db.batch([db.prepare("UPDATE pl_visit SET statuss = 'done', datums = ?, laiks = ?, izpilditajs = ?, foto = ?, piezime = ? WHERE id = ?")
          .bind(today(), nowStr().slice(11), me.name, ids.join(','), String(b.piezime || '').slice(0, 300), v.id)]);
      } else {
        const why = String(b.iemesls || 'Nepaspēja').slice(0, 60), C = await cfgOf(db), rain = (await kv(db, 'pl:rain')) || {};
        const d = nextDay(addDays(v.datums > today() ? v.datums : today(), 1), C, rain);
        await db.batch([db.prepare('UPDATE pl_visit SET datums = ?, prio = 1, parcelts = parcelts + 1, iemesls = ?, izpilditajs = ? WHERE id = ?').bind(d, why, me.name, v.id),
          log(db, v.adrese + ' → ' + lvD(d) + ' (' + why.toLowerCase() + ', ' + me.name + ')')]);
      }
      return out(Object.assign({ ok: true }, await schedule(db)));
    }
    if (a === 'saveCfg') {
      need('admin'); const c = b.cfg || {}, C = await cfgOf(db);
      const n = { rainMm: Math.max(0, +c.rainMm || C.rainMm), wetDays: Math.max(0, Math.min(3, Math.round(+c.wetDays))), maxM2: Math.max(100, +c.maxM2 || C.maxM2),
        interval: Math.max(1, Math.min(90, Math.round(+c.interval || C.interval))), photoReq: c.photoReq !== false,
        workdays: Array.isArray(c.workdays) && c.workdays.length ? c.workdays.map(Number).filter(x => x >= 1 && x <= 7) : C.workdays,
        season: Array.isArray(c.season) && /^\d\d-\d\d$/.test(c.season[0]) && /^\d\d-\d\d$/.test(c.season[1]) ? c.season : C.season };
      if (isNaN(n.wetDays)) n.wetDays = C.wetDays;
      await db.batch([kvSet(db, 'pl:cfg', n)]);
      return out(Object.assign({ ok: true, cfg: n }, await schedule(db)));
    }
    if (a === 'replan') { need('vaditajs'); await fetchRain(db).catch(() => 0); return out(Object.assign({ ok: true }, await schedule(db))); }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
