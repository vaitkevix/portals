/* SH | Darba laiks — sētnieki un uzkopējas atzīmē «Sāku darbu» / «Beidzu darbu» brigāžu saitē (arī kolēģa vietā, ja nav viedtālruņa),
 * vadītājs var atzīmēt pēc zvana. Portālā: kas tagad strādā. Maršruts POST /dl. Lomas: perms.dl = admin | vaditajs (pieteicējs) | skatitajs. © VAITKEVIX, SIA */
import { personByPin } from './portal.js';
import { today, addDays, nowStr, uid, CORS, out } from './util.js';

export const KEY = 'dl';
const ROLE_W = { admin: 3, vaditajs: 2, skatitajs: 0 };
const split = (s) => String(s || '').split('|').map(x => x.trim()).filter(Boolean);
async function all(db, sql, ...a) { return (await db.prepare(sql).bind(...a).all()).results || []; }
async function teamKey(db) { const r = await db.prepare("SELECT v FROM kv WHERE k = 'teamKey'").first(); return r ? r.v : ''; }

/* Dienas cilvēki: vienību sastāvs šai dienai + pārējie darbinieki no saraksta */
async function day(db, d) {
  const units = (await all(db, 'SELECT name, persons FROM crew WHERE datums = ? ORDER BY id', d)).map(r => ({ name: r.name, persons: split(r.persons) }));
  const staff = await all(db, 'SELECT name, brigade FROM staff ORDER BY ord, name');
  const marks = await all(db, 'SELECT vards, veids, laiks, vieniba, avots, kas FROM dl_mark WHERE datums = ? ORDER BY laiks, izveidots', d);
  const inUnit = new Set(units.flatMap(u => u.persons));
  const people = units.flatMap(u => u.persons.map(p => ({ vards: p, vieniba: u.name }))).concat(staff.filter(s => !inUnit.has(s.name)).map(s => ({ vards: s.name, vieniba: '' })));
  people.forEach(p => { const m = marks.filter(x => x.vards === p.vards); const s = m.filter(x => x.veids === 'sak'), e = m.filter(x => x.veids === 'beidz');
    p.sak = s.length ? s[0].laiks : ''; p.beidz = e.length && (!s.length || e[e.length - 1].laiks >= s[s.length - 1].laiks) ? e[e.length - 1].laiks : '';
    p.statuss = p.sak && !p.beidz ? 'strada' : p.sak && p.beidz ? 'beidza' : 'nav'; p.atz = m; });
  return { datums: d, units, people };
}
async function mark(db, b, kas, avots) {
  const d = today(), vards = String(b.vards || '').trim(), veids = b.veids === 'beidz' ? 'beidz' : 'sak';
  const D = await day(db, d); if (!D.people.some(p => p.vards === vards)) throw new Error('Šāds darbinieks šodien nav sarakstā');
  const laiks = /^([01]\d|2[0-3]):[0-5]\d$/.test(b.laiks || '') ? b.laiks : nowStr().slice(11, 16);
  await db.prepare('INSERT INTO dl_mark (id, datums, vards, veids, laiks, vieniba, avots, kas, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), d, vards, veids, laiks, String(b.vieniba || '').slice(0, 80), avots, String(kas || '').slice(0, 80), nowStr()).run();
  return day(db, d);
}
export async function cron() {}
export async function api(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB, a = b.action;
  try {
    /* Brigāžu saite (?k=) — redz savas dienas cilvēkus un atzīmē (arī kolēģa vietā) */
    if (a === 'team' || a === 'teamMark') {
      const k = await teamKey(db); if (!k || b.key !== k) return out({ ok: false, error: 'Vajag brigādes saiti no vadītāja', code: 'teamkey' });
      if (a === 'teamMark') return out(Object.assign({ ok: true }, await mark(db, b, b.kas || 'brigāde', 'brigāde')));
      return out(Object.assign({ ok: true }, await day(db, today())));
    }
    let me = b.pin ? await personByPin(db, b.pin) : null;
    if (b.pin && !me) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN', code: 'auth' }); }
    if (!me) me = { name: 'Pārvaldnieks', perms: { dl: 'skatitajs' } };   // skatīšanās bez ielogošanās
    const role = me.perms.dl || (me.perms.portal === 'admin' ? 'admin' : 'skatitajs');
    if (a === 'boot') { const d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') ? b.datums : today(); return out(Object.assign({ ok: true, me: { name: me.name, role }, today: today() }, await day(db, d))); }
    if (a === 'mark') { if ((ROLE_W[role] || 0) < 2) throw new Error('Atzīmēt citu var pieteicējs vai administrators'); return out(Object.assign({ ok: true }, await mark(db, b, me.name, 'vadītājs'))); }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
