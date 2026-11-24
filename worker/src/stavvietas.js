/* SH | Pazemes stāvvietu mazgāšana — grafiks pēc intervāla (slodze, sezona, iedzīvotāju paziņošana iepriekš), izpilde ar bildi. © VAITKEVIX, SIA
 * Maršruts POST /stav  { pin, action, … }.  Lomas portālā: perms.stav = admin | vaditajs | izpilditajs; portāla admins = admin, citi = skatitajs.
 * Objekti un grupas — no portāla (objects, groups); savas tabulas stav_obj, stav_visit, stav_log. Laikapstākļi — kopīgi (kv wx, sk. wx.js). */
import { personByPin, companyBy } from './portal.js';
import { groupsOf } from './master.js';
import { notify, managers, personNames } from './webpush.js';
import { today, addDays, dow, nowStr, uid, anorm, lvD, kv, kvSet, geoQuery, CORS, out } from './util.js';

export const KEY = 'stav', NAME = 'Pazemes stāvvietu mazgāšana', KIND = 'stav_mazg';
const WEATHER = [], MAX_INT = 400;
export const DEF_CFG = {"interval": 365, "maxQty": 6000, "season": ["01-01", "12-31"], "workdays": [1, 2, 3, 4, 5], "rainMm": 99, "wetDays": 0, "frostC": -50, "noticeDays": 5, "photoReq": true, "veidi": ["Grīda nomazgāta", "Notekas iztīrītas", "Sienas / kolonnas", "Atkritumi savākti"], "photoBefore": true, "laiksNo": "08:00", "laiksLidz": "16:00", "zina": "Cienījamie iedzīvotāji! {datums} no {no} līdz {lidz} notiks pazemes stāvvietas mazgāšana. Lūdzam līdz {no} izbraukt ar automašīnām no stāvvietas. Paldies par sapratni! SIA SELECTUM HOME"};

/* ---------- Stāvvietu specifika ---------- */
export const NOTEKAS = ['Kārtībā', 'Aizsērējušas', 'Ūdens uz grīdas'];
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const hm = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : '';
function cleanReq(d) { d = d || {}; return { limeni: int(d.limeni, 0, 10) }; }
function cleanObj(d) { d = d || {}; return { reizes: int(d.reizes, 0, 52), limeni: int(d.limeni, 1, 10) || 1, vieta: str(d.vieta, 120) }; }
function cleanDone(d) { d = d || {}; return { limeni: (Array.isArray(d.limeni) ? d.limeni : []).map(Number).filter(x => x >= 1 && x <= 10).slice(0, 10), auto: str(d.auto, 300), notekas: NOTEKAS.indexOf(d.notekas) !== -1 ? d.notekas : '' }; }

async function cfgOf(db) { return Object.assign({}, DEF_CFG, (await kv(db, 'stav:cfg')) || {}); }
const push = (X, env, p) => { const run = (async () => { try { await p(); } catch (e) { console.error('push', e); } })(); if (X && X.bg) X.bg(run); else return run; };
const log = (db, t) => db.prepare('INSERT INTO stav_log (laiks, teksts) VALUES (?, ?)').bind(nowStr(), String(t).slice(0, 300));

/* Diena nederīga laikapstākļu dēļ. wx: { datums: { r: mm, s: cm sniega, t: min °C } } */
function badWx(C, wx, d) {
  for (let i = 0; i <= (C.wetDays || 0); i++) { const x = wx[addDays(d, -i)] || {}; if (WEATHER.indexOf('rain') !== -1 && (x.r || 0) >= C.rainMm) return 'lietus'; }
  const x = wx[d] || {};
  if (WEATHER.indexOf('frost') !== -1 && x.t != null && x.t < C.frostC) return 'sals';
  return '';
}
export function nextDay(from, cfg, wx) {
  const C = Object.assign({}, DEF_CFG, cfg || {});
  let d = from; for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (C.workdays.indexOf(dow(d)) !== -1 && !badWx(C, wx, d)) return d;
  return from;
}

/* ---------- Grafika aprēķins (tīra funkcija) ----------
 * objs: [{anorm, adrese, qty, intervals, brigade}], visits: [{id, anorm, datums, statuss, prio}] → { moves, adds } */
export function plan(objs, visits, cfg, wx, t) {
  const C = Object.assign({}, DEF_CFG, cfg || {});
  const inSeason = (d) => { const md = d.slice(5); return C.season[0] <= C.season[1] ? md >= C.season[0] && md <= C.season[1] : md >= C.season[0] || md <= C.season[1]; };
  const okDay = (d) => C.workdays.indexOf(dow(d)) !== -1 && !badWx(C, wx, d);
  const qOf = {}; objs.forEach(o => qOf[o.anorm] = +o.qty || 0);
  const load = {}; const addLoad = (d, a) => { load[d] = (load[d] || 0) + (qOf[a] || 0); };
  const firstDay = (from, need) => { let d = from; for (let i = 0; i < 90; i++, d = addDays(d, 1)) if (okDay(d) && (load[d] || 0) + need <= C.maxQty) return d;
    d = from; for (let i = 0; i < 90; i++, d = addDays(d, 1)) if (okDay(d)) return d; return from; };
  const moves = [], adds = [];
  const plans = visits.filter(v => v.statuss === 'plan');
  plans.filter(v => v.datums < t).sort((a, b) => a.datums.localeCompare(b.datums)).forEach(v => {
    const d = firstDay(t, qOf[v.anorm] || 0); moves.push({ id: v.id, datums: d, why: 'nepaspēts ' + lvD(v.datums) }); v.datums = d; v.prio = 1; });
  plans.filter(v => v.datums >= t && v.datums <= addDays(t, 3) && C.workdays.indexOf(dow(v.datums)) !== -1 && badWx(C, wx, v.datums)).forEach(v => {
    const why = badWx(C, wx, v.datums), d = firstDay(addDays(v.datums, 1), qOf[v.anorm] || 0); moves.push({ id: v.id, datums: d, why: why + ' ' + lvD(v.datums) }); v.datums = d; v.prio = 1; });
  plans.filter(v => v.datums >= t).forEach(v => addLoad(v.datums, v.anorm));
  const sched = visits.filter(v => v.avots !== 'pieteikums');   // vienreizēji pieteikumi intervālu neietekmē
  /* Biežums pēc līguma: N reizes gadā → sadala pa sezonu, gadā ne vairāk par N */
  const seasonLen = (() => { const a = Date.parse('2001-' + C.season[0] + 'T12:00:00Z'), b = Date.parse('2001-' + C.season[1] + 'T12:00:00Z'); let n = Math.round((b - a) / 864e5) + 1; if (n <= 0) n += 365; return n; })();
  const reizesOf = (o) => { try { return Math.max(0, Math.min(52, Math.round(+JSON.parse(o.dati || '{}').reizes || 0))); } catch (e) { return 0; } };
  const perYear = {}; sched.forEach(v => { const k = v.anorm + '|' + v.datums.slice(0, 4); perYear[k] = (perYear[k] || 0) + 1; });
  const lastDone = {}; sched.filter(v => v.statuss === 'done').forEach(v => { if (!lastDone[v.anorm] || v.datums > lastDone[v.anorm]) lastDone[v.anorm] = v.datums; });
  const hasPlan = new Set(sched.filter(v => v.statuss === 'plan' && v.datums >= t).map(v => v.anorm));
  const earliest = addDays(t, C.noticeDays || 0);
  objs.filter(o => (+o.qty > 0) && !hasPlan.has(o.anorm))
    .map(o => { const n = reizesOf(o), iv = n ? Math.max(1, Math.floor(seasonLen / n)) : (+o.intervals || C.interval); return { o, n, due: lastDone[o.anorm] ? addDays(lastDone[o.anorm], iv) : t }; })
    .sort((a, b) => a.due.localeCompare(b.due))
    .forEach(({ o, n, due }) => {
      let from = due < earliest ? earliest : due;
      if (!inSeason(from)) { const y = +from.slice(0, 4), s = y + '-' + C.season[0]; from = from < s ? s : (y + 1) + '-' + C.season[0]; }
      if (n && (perYear[o.anorm + '|' + from.slice(0, 4)] || 0) >= n) from = (+from.slice(0, 4) + 1) + '-' + C.season[0];   // šī gada reizes izsmeltas
      if (from > addDays(t, 400)) return;
      const d = firstDay(from, +o.qty); adds.push({ anorm: o.anorm, adrese: o.adrese, datums: d, brigade: o.brigade || '' }); addLoad(d, o.anorm);
      perYear[o.anorm + '|' + d.slice(0, 4)] = (perYear[o.anorm + '|' + d.slice(0, 4)] || 0) + 1;
    });
  return { moves, adds };
}

export async function schedule(db) {
  const C = await cfgOf(db), t = today(), wx = (await kv(db, 'wx')) || {};
  const objs = (await db.prepare('SELECT s.anorm, o.adrese, s.qty, s.intervals, s.brigade, s.dati FROM stav_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.aktivs = 1').all()).results || [];
  const visits = (await db.prepare("SELECT id, anorm, datums, statuss, prio, avots FROM stav_visit WHERE statuss = 'plan' OR (statuss = 'done' AND datums >= ?)").bind(addDays(t, -800)).all()).results || [];
  const r = plan(objs, visits, C, wx, t), st = [];
  const adrOf = {}; objs.forEach(o => adrOf[o.anorm] = o.adrese); const vOf = {}; visits.forEach(v => vOf[v.id] = v);
  r.moves.forEach(m => { st.push(db.prepare('UPDATE stav_visit SET datums = ?, prio = 1, parcelts = parcelts + 1 WHERE id = ?').bind(m.datums, m.id));
    st.push(log(db, (adrOf[(vOf[m.id] || {}).anorm] || 'Adrese') + ' → ' + lvD(m.datums) + ' (' + m.why + ')')); });
  r.adds.forEach(a => st.push(db.prepare('INSERT INTO stav_visit (id, anorm, adrese, datums, brigade, izveidots) VALUES (?, ?, ?, ?, ?, ?)').bind(uid(), a.anorm, a.adrese, a.datums, a.brigade, nowStr())));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  return { moved: r.moves.length, added: r.adds.length };
}

/* Koordinātas: no citām lietotnēm (tā pati adrese), tad Nominatim (≤ 1/s) */
export async function geocode(db, max) {
  for (const T of ['pl_obj', 'logi_obj', 'darz_obj', 'stav_obj', 'sniegs_obj'].filter(x => x !== 'stav_obj'))
    await db.prepare(`UPDATE stav_obj SET lat = (SELECT x.lat FROM ${T} x WHERE x.anorm = stav_obj.anorm AND x.lat IS NOT NULL), lng = (SELECT x.lng FROM ${T} x WHERE x.anorm = stav_obj.anorm AND x.lat IS NOT NULL) WHERE lat IS NULL AND EXISTS (SELECT 1 FROM ${T} x WHERE x.anorm = stav_obj.anorm AND x.lat IS NOT NULL)`).run().catch(() => 0);
  const L = (await db.prepare('SELECT s.anorm, o.adrese FROM stav_obj s JOIN objects o ON o.anorm = s.anorm WHERE s.aktivs = 1 AND s.lat IS NULL LIMIT ?').bind(max || 10).all()).results || [];
  let ok = 0, miss = 0;
  for (const o of L) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=lv&q=' + encodeURIComponent(geoQuery(o.adrese)), { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'SH-stav/1.0 (+https://vaitkevix.cloud/sh/)', 'Accept-Language': 'lv' } });
      const j = r.ok ? await r.json() : [];
      if (j && j[0]) { await db.prepare('UPDATE stav_obj SET lat = ?, lng = ? WHERE anorm = ?').bind(+j[0].lat, +j[0].lon, o.anorm).run(); ok++; }
      else { await db.prepare('UPDATE stav_obj SET lat = 0, lng = 0 WHERE anorm = ?').bind(o.anorm).run(); miss++; }
    } catch (e) { break; }
    await new Promise(res => setTimeout(res, 1100));
  }
  const left = (await db.prepare('SELECT COUNT(*) n FROM stav_obj WHERE aktivs = 1 AND lat IS NULL').first()).n;
  return { found: ok, notFound: miss, left };
}

/* Cron: reizi dienā no 05:00 — grafiks + koordinātas */
export async function cron(env) {
  const db = env.DB, t = today(), h = +nowStr().slice(11, 13);
  if (h < 5 || (await kv(db, 'stav:ran')) === t) return;
  await schedule(db);
  await db.batch([kvSet(db, 'stav:ran', t)]);   // atzīme PĒC veiksmīga grafika — kļūdas gadījumā mēģina vēlreiz
  await geocode(db, 5).catch(() => 0);
  /* Atgādinājums vadītājiem: rīt jāpaziņo iedzīvotājiem */
  try { const C = await cfgOf(db), d = addDays(t, (C.noticeDays || 0) + 1);
    const L = (await db.prepare("SELECT adrese, datums FROM stav_visit WHERE statuss = 'plan' AND pazinots = '' AND datums <= ? AND datums >= ?").bind(d, t).all()).results || [];
    if (L.length) await notify(env, await managers(env, KEY), { title: 'Stāvvietas · jāpaziņo iedzīvotājiem', body: L.slice(0, 3).map(x => x.adrese + ' (' + lvD(x.datums) + ')').join(', ') + (L.length > 3 ? ' +' + (L.length - 3) : ''), url: '/sh/#stav' }); } catch (e) { console.error('stav notice', e); }
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
  if (GUEST) me = { name: 'Pārvaldnieks', perms: { [KEY]: 'skatitajs' } };   // darbu izpildītājs (SIA) ar pilnvaru
  const role = me && (me.company ? me.perms[KEY] : ((me.perms || {})[KEY] || ((me.perms || {}).portal === 'admin' ? 'admin' : 'skatitajs')));
  if (!me || !role) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN vai nav piekļuves: ' + NAME, code: 'auth' }); }
  const need = (r) => { if ((ROLE_W[role] || 0) < ROLE_W[r]) throw new Error('Jums ir tikai skatīšanās tiesības'); };
  const a = b.action;
  try {
    if (a === 'boot') {
      const t = today(), from = b.from || addDays(t, -7), to = b.to || addDays(t, 21);
      const objects = (await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, o.piekluve, s.qty, s.intervals, s.aktivs, s.brigade, s.piezime, s.veidi, s.dati, s.lat, s.lng FROM objects o LEFT JOIN stav_obj s ON s.anorm = o.anorm JOIN obj_info i ON i.anorm = o.anorm AND i.pazemes = 1 ORDER BY o.ord').all()).results || [];   // tikai objekti ar pazemes stāvvietu (Administrēšana → Objekti)
      if (ROLE_W[role] < 1) objects.forEach(o => { o.piekluve = ''; });
      let visits = (await db.prepare("SELECT * FROM stav_visit WHERE (datums >= ? AND datums <= ?) OR (avots = 'pieteikums' AND statuss = 'plan') ORDER BY datums, steidzami DESC, prio DESC, adrese").bind(from, to).all()).results || [];
      if (me.company) visits = visits.filter(v => !v.brigade || v.brigade === me.name);   // SIA redz savus darbus
      const last = (await db.prepare("SELECT anorm, MAX(datums) d FROM stav_visit WHERE statuss = 'done' GROUP BY anorm").all()).results || [];
      const logs = ROLE_W[role] < 2 ? [] : ((await db.prepare('SELECT laiks, teksts FROM stav_log ORDER BY id DESC LIMIT 30').all()).results || []);
      const crews = ((await db.prepare('SELECT name, kinds FROM companies WHERE active = 1').all()).results || []).filter(c => String(c.kinds).split(',').indexOf(KIND) !== -1).map(c => c.name);
      return out({ ok: true, me: { name: me.name, role, company: !!me.company }, today: t, cfg: await cfgOf(db), wx: (await kv(db, 'wx')) || {}, objects, visits, calls: [], last, logs, crews,
        groups: (await groupsOf(db).catch(() => [])).map(g => ({ name: g.name, adreses: g.adreses })) });
    }
    if (a === 'month') {
      const ym = String(b.ym || today().slice(0, 7)).slice(0, 7);
      const visits = (await db.prepare('SELECT id, anorm, adrese, datums, statuss, prio, parcelts, foto, izpilditajs, laiks, iemesls, pazinots, avots, steidzami FROM stav_visit WHERE substr(datums, 1, 7) = ? ORDER BY datums').bind(ym).all()).results || [];
      return out({ ok: true, visits });
    }
    if (a === 'obj') {
      const hist = (await db.prepare('SELECT id, datums, statuss, laiks, sakums, izpilditajs, foto, foto_pirms, iemesls, piezime, parcelts, avots, apraksts, izpilde FROM stav_visit WHERE anorm = ? ORDER BY datums DESC LIMIT 40').bind(anorm(b.anorm || b.adrese)).all()).results || [];
      return out({ ok: true, hist });
    }
    if (a === 'geo') { need('vaditajs'); return out(Object.assign({ ok: true }, await geocode(db, 12))); }
    if (a === 'saveObj') {
      need('vaditajs');
      const list = (Array.isArray(b.objs) ? b.objs : [b]).slice(0, 500), st = [], C = await cfgOf(db);
      for (const o of list) {
        const k = anorm(o.adrese || o.anorm); if (!k) continue;
        const act = !(o.aktivs === false || o.aktivs === 0), br = String(o.brigade || '').slice(0, 80);
        st.push(db.prepare('INSERT INTO obj_info (anorm, pazemes) VALUES (?, 1) ON CONFLICT(anorm) DO UPDATE SET pazemes = 1').bind(k));   // grafikā = ir pazemes stāvvieta
        st.push(db.prepare('INSERT INTO stav_obj (anorm, qty, intervals, aktivs, brigade, piezime, veidi, dati) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET qty = excluded.qty, intervals = excluded.intervals, aktivs = excluded.aktivs, brigade = excluded.brigade, piezime = excluded.piezime, veidi = excluded.veidi, dati = excluded.dati')
          .bind(k, Math.max(0, Math.min(1e6, +o.qty || 0)), Math.max(1, Math.min(MAX_INT, Math.round(+o.intervals || C.interval))), act ? 1 : 0, br, String(o.piezime || '').slice(0, 300),
            (Array.isArray(o.veidi) ? o.veidi : String(o.veidi || '').split(',')).map(x => String(x).trim()).filter(x => (C.veidi || []).indexOf(x) !== -1).join(','), JSON.stringify(cleanObj(o.dati))));
        st.push(act ? db.prepare("UPDATE stav_visit SET brigade = ? WHERE anorm = ? AND statuss = 'plan'").bind(br, k) : db.prepare("DELETE FROM stav_visit WHERE anorm = ? AND statuss = 'plan' AND avots != 'pieteikums'").bind(k));
      }
      for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
      return out(Object.assign({ ok: true }, await schedule(db)));
    }
    if (a === 'request') {   // vienreizējs pieteikums ārpus grafika
      need('vaditajs');
      const k = anorm(b.adrese); const o = k && await db.prepare('SELECT adrese FROM objects WHERE anorm = ?').bind(k).first(); if (!o) throw new Error('Izvēlieties adresi no saraksta');
      const t = today(), d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') && b.datums >= t ? b.datums : t, term = /^\d{4}-\d{2}-\d{2}$/.test(b.termins || '') ? b.termins : '';
      const id = uid(), C = await cfgOf(db);
      await db.batch([db.prepare("INSERT INTO stav_visit (id, anorm, adrese, datums, brigade, avots, termins, steidzami, apraksts, dati, prio, pieteica, laiks_no, laiks_lidz, izveidots) VALUES (?, ?, ?, ?, ?, 'pieteikums', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, k, o.adrese, d, String(b.brigade || '').slice(0, 80), term, b.steidzami ? 1 : 0, String(b.apraksts || '').slice(0, 500), JSON.stringify(cleanReq(b.dati)), b.steidzami ? 1 : 0, me.name, String(b.laiksNo || C.laiksNo || '').slice(0, 5), String(b.laiksLidz || C.laiksLidz || '').slice(0, 5), nowStr()),
        log(db, me.name + ' pieteica: ' + o.adrese + ' (' + lvD(d) + (b.steidzami ? ', steidzami' : '') + ')')]);
      if (b.steidzami) push(X, env, async () => { const who = await personNames(env, [String(b.brigade || '')]); await notify(env, who.length ? who.concat(await managers(env, KEY)) : await managers(env, KEY), { title: '⚡ Steidzami · ' + NAME, body: o.adrese + (b.apraksts ? ' — ' + String(b.apraksts).slice(0, 80) : '') + ' (' + me.name + ')', url: '/sh/#stav', urgent: true }); });
      return out({ ok: true, id });
    }
    if (a === 'editReq') {   // pieteikuma vai izbraukuma datums, laiks, izpildītājs
      need('vaditajs');
      const v = await db.prepare('SELECT * FROM stav_visit WHERE id = ?').bind(String(b.id || '')).first(); if (!v || v.statuss === 'done') throw new Error('Nav atrasts vai jau izpildīts');
      if (/^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') && b.datums < today() && b.datums !== v.datums) throw new Error('Datums nevar būt pagātnē');
      const d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') ? b.datums : v.datums, hmv = (x, y) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || '')) ? x : y;
      await db.batch([db.prepare('UPDATE stav_visit SET datums = ?, laiks_no = ?, laiks_lidz = ?, brigade = ?, apraksts = ?, steidzami = ? WHERE id = ?')
        .bind(d, hmv(b.laiksNo, v.laiks_no), hmv(b.laiksLidz, v.laiks_lidz), b.brigade != null ? String(b.brigade).slice(0, 80) : v.brigade, b.apraksts != null ? String(b.apraksts).slice(0, 500) : v.apraksts, b.steidzami != null ? (b.steidzami ? 1 : 0) : v.steidzami, v.id)]);
      return out({ ok: true });
    }
    if (a === 'start') {
      need('izpilditajs');
      const v = await db.prepare('SELECT id, sakums FROM stav_visit WHERE id = ?').bind(String(b.id || '')).first(); if (!v) throw new Error('Nav atrasts — atjaunojiet');
      if (!v.sakums) await db.batch([db.prepare('UPDATE stav_visit SET sakums = ?, izpilditajs = ? WHERE id = ?').bind(nowStr().slice(11), me.name, v.id)]);
      return out({ ok: true });
    }
    if (a === 'report') {   // mēneša kopsavilkums (rēķinam)
      need('vaditajs');
      const ym = String(b.ym || today().slice(0, 7)).slice(0, 7);
      const rows = (await db.prepare("SELECT id, adrese, datums, izpilditajs, brigade, sakums, laiks, izpilde, avots FROM stav_visit WHERE statuss = 'done' AND substr(datums, 1, 7) = ? ORDER BY datums").bind(ym).all()).results || [];
      return out({ ok: true, rows });
    }
    if (a === 'notice') {   // iedzīvotāji paziņoti (stāvvietām)
      need('vaditajs');
      await db.batch([db.prepare('UPDATE stav_visit SET pazinots = ? WHERE id = ?').bind(b.undo ? '' : today() + ' ' + me.name, String(b.id || ''))]);
      return out({ ok: true });
    }
    if (a === 'done' || a === 'cant') {
      need('izpilditajs');
      const v = await db.prepare('SELECT * FROM stav_visit WHERE id = ?').bind(String(b.id || '')).first();
      if (!v) throw new Error('Nav atrasts — atjaunojiet');
      if (me.company && v.brigade && v.brigade !== me.name) throw new Error('Šis darbs nav jūsu brigādei');
      if (v.statuss === 'done') return out({ ok: true, already: true });
      if (a === 'done') {
        const C = await cfgOf(db), photos = (b.photos || []).filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(String(p))).slice(0, 4);
        const before = (b.photosBefore || []).filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(String(p))).slice(0, 4);
        if (C.photoBefore && !before.length && !v.foto_pirms) throw new Error('Pievienojiet bildi pirms darba');
        if (C.photoReq && !photos.length) throw new Error('Pievienojiet bildi pēc darba');
        const ids = photos.length ? await X.savePhotos({ datums: v.datums, adrese: NAME + ' · ' + v.adrese }, photos) : [];
        const idsB = before.length ? await X.savePhotos({ datums: v.datums, adrese: NAME + ' · pirms · ' + v.adrese }, before) : [];
        await db.batch([db.prepare("UPDATE stav_visit SET statuss = 'done', datums = ?, laiks = ?, sakums = CASE WHEN sakums = '' THEN ? ELSE sakums END, izpilditajs = ?, foto = ?, foto_pirms = CASE WHEN ? = '' THEN foto_pirms ELSE ? END, piezime = ?, izpilde = ? WHERE id = ?")
          .bind(kadOf(b).d, kadOf(b).t, String(b.sakums || '').slice(0, 5), me.name, ids.join(','), idsB.join(','), idsB.join(','), String(b.piezime || '').slice(0, 300), JSON.stringify(cleanDone(b.izpilde)), v.id)]);
      } else {
        const why = String(b.iemesls || 'Nepaspēja').slice(0, 60), C = await cfgOf(db), wx = (await kv(db, 'wx')) || {};
        const d = nextDay(addDays(v.datums > today() ? v.datums : today(), 1), C, wx);
        await db.batch([db.prepare('UPDATE stav_visit SET datums = ?, prio = 1, parcelts = parcelts + 1, iemesls = ?, izpilditajs = ?, pazinots = \'\' WHERE id = ?').bind(d, why, me.name, v.id),
          log(db, v.adrese + ' → ' + lvD(d) + ' (' + why.toLowerCase() + ', ' + me.name + ')')]);
        push(X, env, async () => notify(env, (await managers(env, KEY)).filter(n => n !== me.name), { title: NAME + ' · nevar', body: v.adrese + ': ' + why + ' (' + me.name + ') → ' + lvD(d), url: '/sh/#stav' }));
      }
      return out(Object.assign({ ok: true }, await schedule(db)));
    }
    if (a === 'saveCfg') {
      need('admin'); const c = b.cfg || {}, C = await cfgOf(db), n = Object.assign({}, C);
      const num = (k, lo, hi) => { if (c[k] != null && c[k] !== '' && !isNaN(+c[k])) n[k] = Math.max(lo, Math.min(hi, +c[k])); };
      if (typeof c.photoBefore === 'boolean') n.photoBefore = c.photoBefore;
      ['laiksNo', 'laiksLidz'].forEach(k => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(c[k] || ''))) n[k] = c[k]; });
      if (typeof c.zina === 'string' && c.zina.trim()) n.zina = c.zina.trim().slice(0, 800);
      num('rainMm', 0, 99); num('wetDays', 0, 3); num('maxQty', 1, 1e6); num('interval', 1, MAX_INT); num('frostC', -50, 20); num('noticeDays', 0, 30);
      ['wetDays', 'interval', 'noticeDays'].forEach(k => n[k] = Math.round(n[k]));
      if (typeof c.photoReq === 'boolean') n.photoReq = c.photoReq;
      if (Array.isArray(c.workdays) && c.workdays.length) n.workdays = c.workdays.map(Number).filter(x => x >= 1 && x <= 7);
      if (Array.isArray(c.season) && /^\d\d-\d\d$/.test(c.season[0]) && /^\d\d-\d\d$/.test(c.season[1])) n.season = c.season;
      if (Array.isArray(c.veidi)) { const v = c.veidi.map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 12); if (v.length) n.veidi = v; }
      await db.batch([kvSet(db, 'stav:cfg', n)]);
      return out(Object.assign({ ok: true, cfg: n }, await schedule(db)));
    }
    if (a === 'replan') { need('vaditajs'); await fetchWx(db).catch(() => 0); return out(Object.assign({ ok: true }, await schedule(db))); }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
