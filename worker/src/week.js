/* SH | C9 «Mana nedēļa» portālā: vadītājam 7 dienas × viņa objekti × visas lietotnes (aizvietošana, pļaušana, logi, sniegs, dārzs, stāvvietas)
 * + atvērtie izvešanas / kaisāmmateriāla pieteikumi. Grafika darbu (pļaušana, logi, dārzs, stāvvietas) var pārcelt uz citu dienu —
 * tā pati darbība kā lietotnē (datums, prio 1, parcelts+1); sniegam un aizvietošanai — saite uz lietotni. © VAITKEVIX, SIA */
import { today, addDays, nowStr, anorm, lvD, assertOpen } from './util.js';
import { audit } from './audit.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const nm = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const isMine = (vad, name) => { const a = nm(vad), b = nm(name); return !!a && !!b && (a === b || a === b.split(' ')[0] || b.startsWith(a + ' ') || a.startsWith(b + ' ')); };
const G = [['pl', 'pl_visit'], ['logi', 'logi_visit'], ['sniegs', 'sniegs_visit'], ['darz', 'darz_visit'], ['stav', 'stav_visit']];
export const MOVABLE = { pl: 'pl_visit', logi: 'logi_visit', darz: 'darz_visit', stav: 'stav_visit' };
const isD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const canApp = (me, app) => me.perms.portal === 'admin' || me.perms[app] === 'admin' || me.perms[app] === 'vaditajs';

async function myObjects(db, me) { return (await all(db, 'SELECT anorm, adrese, vaditajs FROM objects ORDER BY ord, adrese')).filter(o => isMine(o.vaditajs, me.name)); }
export async function week(db, me, from) {
  const t = today(), f = isD(from) ? from : t, to = addDays(f, 6), days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(f, i));
  const O = await myObjects(db, me); if (!O.length) return { from: f, days, objekti: [], open: [], today: t };
  const K = new Set(O.map(o => o.anorm)), R = {}; O.forEach(o => R[o.anorm] = { anorm: o.anorm, adrese: o.adrese, d: {} });
  const put = (an, d, x) => { const o = R[an]; if (!o) return; (o.d[d] || (o.d[d] = [])).push(x); };
  for (const j of await all(db, 'SELECT id, datums, anorm, tips, brigade, statuss FROM jobs WHERE datums >= ? AND datums <= ?', f, to).catch(() => []))
    if (K.has(j.anorm)) put(j.anorm, j.datums, { app: 'aizv', id: j.id, st: j.statuss === 'izpildīts' ? 'done' : j.statuss === 'nevar izpildīt' ? 'cant' : 'plan', t: j.tips + (j.brigade ? ' · ' + j.brigade : '') });
  for (const [app, T] of G) for (const v of await all(db, `SELECT id, anorm, datums, statuss FROM ${T} WHERE datums >= ? AND datums <= ?`, f, to).catch(() => []))
    if (K.has(v.anorm)) put(v.anorm, v.datums, { app, id: v.id, st: v.statuss, mv: !!MOVABLE[app] && v.statuss === 'plan' && v.datums >= t && canApp(me, app) });
  const open = [];
  for (const [app, sql] of [['izv', "SELECT adrese FROM izv_task WHERE statuss = 'Neizpildīts'"], ['kais', "SELECT adrese FROM kais_task WHERE statuss NOT IN ('Piegādāts', 'Atcelts')"]]) {
    const c = {}; for (const r of await all(db, sql).catch(() => [])) { const k = anorm(r.adrese); if (K.has(k)) c[k] = (c[k] || 0) + 1; }
    Object.keys(c).forEach(k => open.push({ app, adrese: R[k].adrese, n: c[k] }));
  }
  const L = Object.values(R).sort((a, b) => (Object.keys(b.d).length > 0) - (Object.keys(a.d).length > 0) || a.adrese.localeCompare(b.adrese, 'lv'));
  return { from: f, days, objekti: L, open, today: t };
}
export async function move(db, me, b) {
  const app = String(b.app || ''), T = MOVABLE[app]; if (!T) throw new Error('Šo darbu pārceļ lietotnē');
  if (!canApp(me, app)) throw new Error('Nav tiesību pārcelt šīs lietotnes darbus');
  const v = await db.prepare(`SELECT id, anorm, adrese, datums, statuss FROM ${T} WHERE id = ?`).bind(String(b.id || '')).first(); if (!v) throw new Error('Darbs nav atrasts — atjaunojiet');
  if (v.statuss !== 'plan') throw new Error('Darbs jau izpildīts vai atzīmēts');
  const o = await db.prepare('SELECT vaditajs FROM objects WHERE anorm = ?').bind(v.anorm).first();
  if (me.perms.portal !== 'admin' && me.perms[app] !== 'admin' && !(o && isMine(o.vaditajs, me.name))) throw new Error('Pārcelt var savos objektos');
  const d = String(b.datums || ''), t = today(); if (!isD(d) || d < t) throw new Error('Izvēlieties šodienu vai vēlāku dienu'); if (d > addDays(t, 120)) throw new Error('Pārāk tālu nākotnē');
  if (d === v.datums) return { ok: true };
  await assertOpen(db, v.datums); await assertOpen(db, d);
  await db.batch([db.prepare(`UPDATE ${T} SET datums = ?, prio = 1, parcelts = parcelts + 1${app === 'stav' ? ", pazinots = ''" : ''} WHERE id = ? AND statuss = 'plan'`).bind(d, v.id),
    db.prepare(`INSERT INTO ${app}_log (laiks, teksts) VALUES (?, ?)`).bind(nowStr(), v.adrese + ' → ' + lvD(d) + ' (pārcēla ' + me.name + ', Mana nedēļa)')]);
  await audit(db, me.name, 'Mana nedēļa', v.adrese, ['Datums (' + app + ')', v.datums, d]);
  return { ok: true };
}
