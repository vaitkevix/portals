/* SH | C8: e-pasts pārvaldniekiem reizi dienā — rīt plānotie darbi viņu objektos (pļaušana, logi, stāvvietas, dārzs) un aktīvs sniega izsaukums.
 * Pārvaldnieks = obj_info.parv (Mājas lieta → Objekts). E-pasta adreses un slēdzis — kv «mail:parv» (Administrēšana → E-pasts).
 * Adresātiem jābūt apstiprinātiem Cloudflare Email Routing; ja nav — kļūda žurnālā kv «mail:parvLog», nekas nekrīt. © VAITKEVIX, SIA */
import { today, addDays, nowStr, lvD, kv, kvSet } from './util.js';
import * as mail from './mail.js';

const DEF = { on: false, laiks: '16:00', emails: {} };
const APPS = [['pl', 'pl_visit', 'Zāles pļaušana'], ['logi', 'logi_visit', 'Logu mazgāšana'], ['stav', 'stav_visit', 'Pazemes stāvvietas mazgāšana'], ['darz', 'darz_visit', 'Dārzniecība']];
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function cfg(db) { const c = Object.assign({}, DEF, (await kv(db, 'mail:parv')) || {}); c.emails = c.emails || {}; return c; }
/** Administrēšanai: iestatījumi, pārvaldnieki ar objektu skaitu, žurnāls */
export async function info(db) {
  const c = await cfg(db), P = {};
  (await all(db, "SELECT parv, COUNT(*) n FROM obj_info WHERE parv != '' GROUP BY parv").catch(() => [])).forEach(r => P[r.parv] = r.n);
  Object.keys(c.emails).forEach(k => { if (!(k in P)) P[k] = 0; });
  return { cfg: c, parv: Object.keys(P).sort((a, b) => a.localeCompare(b, 'lv')).map(k => ({ name: k, objekti: P[k], epasts: c.emails[k] || '' })), log: ((await kv(db, 'mail:parvLog')) || []).slice(0, 30) };
}
export async function save(db, b) {
  const c = await cfg(db), was = JSON.parse(JSON.stringify(c));
  if (typeof b.on === 'boolean') c.on = b.on;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.laiks || ''))) c.laiks = b.laiks;
  if (b.emails && typeof b.emails === 'object') for (const k of Object.keys(b.emails).slice(0, 100)) {
    const L = String(b.emails[k] || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean), bad = L.find(x => !mail.valid(x));
    if (bad) throw new Error(k + ': nepareiza adrese «' + bad + '»');
    if (L.length) c.emails[String(k).slice(0, 120)] = [...new Set(L)].slice(0, 5).join(', '); else delete c.emails[k];
  }
  await kvSet(db, 'mail:parv', c).run();
  return { cfg: c, was };
}
async function logAdd(db, e) { const L = (await kv(db, 'mail:parvLog')) || []; L.unshift(Object.assign({ laiks: nowStr() }, e)); await kvSet(db, 'mail:parvLog', L.slice(0, 100)).run(); }

/** Rītdienas darbi pa pārvaldniekiem: { parv: [{ adrese, darbi: [..] }] } */
export async function plan(db, d) {
  const P = {}; (await all(db, "SELECT anorm, parv FROM obj_info WHERE parv != ''").catch(() => [])).forEach(r => P[r.anorm] = r.parv);
  const out = {}, add = (an, adrese, txt) => { const p = P[an]; if (!p) return; const L = out[p] || (out[p] = {}); (L[an] || (L[an] = { adrese, darbi: [] })).darbi.push(txt); };
  for (const [, T, name] of APPS) for (const r of await all(db, `SELECT anorm, adrese, laiks_no, laiks_lidz FROM ${T} WHERE datums = ? AND statuss = 'plan'`, d).catch(() => all(db, `SELECT anorm, adrese FROM ${T} WHERE datums = ? AND statuss = 'plan'`, d).catch(() => [])))
    add(r.anorm, r.adrese, name + (r.laiks_no ? ' (' + r.laiks_no + (r.laiks_lidz ? '–' + r.laiks_lidz : '') + ')' : ''));
  const calls = await all(db, "SELECT id, datums, statuss FROM sniegs_call WHERE datums >= ? AND datums <= ? AND statuss IN ('gaida', 'aktivs')", addDays(d, -1), d).catch(() => []);
  for (const c of calls) for (const r of await all(db, "SELECT anorm, adrese FROM sniegs_visit WHERE izs = ? AND statuss = 'plan'", c.id).catch(() => []))
    add(r.anorm, r.adrese, 'Sniega tīrīšana' + (c.statuss === 'gaida' ? ' (gaida apstiprinājumu)' : ''));
  const res = {}; for (const p in out) res[p] = Object.values(out[p]).sort((a, b) => a.adrese.localeCompare(b.adrese, 'lv'));
  return res;
}
function html(parv, d, L) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#17201c;max-width:640px"><div style="font-weight:800;letter-spacing:.08em;color:#0f6b5c;font-size:12px">SELECTUM HOME</div>
    <h2 style="margin:6px 0 4px;font-size:20px">Rīt, ${esc(lvD(d))}, plānotie darbi jūsu objektos</h2><p style="margin:0 0 14px;color:#4a534f">${esc(parv)} · ${L.length} ${L.length === 1 ? 'objekts' : 'objekti'}</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${L.map(o => `<tr><td style="padding:8px 6px;border-top:1px solid #dfe5e2;font-weight:700;vertical-align:top">${esc(o.adrese)}</td><td style="padding:8px 6px;border-top:1px solid #dfe5e2">${o.darbi.map(esc).join('<br>')}</td></tr>`).join('')}</table>
    <p style="margin:16px 0 0;font-size:12px;color:#6d7672">Laikapstākļu dēļ darbi var tikt pārcelti. Automātiska vēstule — neatbildiet. © VAITKEVIX, SIA</p></div>`;
}
/** Sūta visiem pārvaldniekiem ar e-pastu. force — neatkarīgi no laika/slēdža (poga «Nosūtīt tagad»). only — tikai šim pārvaldniekam */
export async function sendAll(env, force, only) {
  const db = env.DB, c = await cfg(db), d = addDays(today(), 1), P = await plan(db, d), res = [];
  for (const p of Object.keys(P)) {
    if (only && p !== only) continue;
    const to = c.emails[p]; if (!to) { res.push({ kam: p, ok: false, err: 'nav e-pasta' }); continue; }
    try { const r = await mail.send(env, { to, subject: 'Rīt ' + lvD(d) + ' plānotie darbi · ' + P[p].length + ' obj.', html: html(p, d, P[p]), fromName: 'SELECTUM HOME' });
      res.push({ kam: p, to, n: P[p].length, ok: !r.failed.length, err: r.failed.map(f => f.to + ': ' + f.error).join('; ').slice(0, 300) }); }
    catch (e) { res.push({ kam: p, to, n: P[p].length, ok: false, err: String(e && e.message || e).slice(0, 300) }); }
  }
  for (const r of res.filter(x => x.err !== 'nav e-pasta' || force)) await logAdd(db, Object.assign({ datums: d }, r)).catch(() => 0);
  if (!res.length) await logAdd(db, { datums: d, kam: '—', ok: true, err: 'rīt pārvaldnieku objektos darbu nav' }).catch(() => 0);
  return { datums: d, res };
}
/** Cron (ik 5 min): reizi dienā pēc iestatītā laika */
export async function cron(env) {
  const db = env.DB, c = await cfg(db); if (!c.on) return;
  const t = nowStr().slice(11, 16), d = today(); if (t < c.laiks) return;
  if ((await kv(db, 'mail:parv:last')) === d) return;
  await kvSet(db, 'mail:parv:last', d).run();   // atzīme pirms sūtīšanas — pie kļūdas neatkārto katras 5 min
  await sendAll(env, false);
}
