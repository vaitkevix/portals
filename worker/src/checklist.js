/* SH | G1 kontrolsaraksts pirms «Izdarīts» grafika lietotnēs (pl, logi, sniegs, darz, stav, aizv). Admins iestata punktus (kv chk:<app>),
 * izpildītājs atzīmē; obligātie (req) bloķē izpildi; atzīmes saglabājas tabulā chk pie izpildes. Mazs palīgs — katra lietotne izsauc ar savu KEY. © VAITKEVIX, SIA */
import { kv, kvSet, nowStr } from './util.js';
import { audit } from './audit.js';

const clean = (L) => (Array.isArray(L) ? L : []).map(x => ({ t: String((x && x.t) || '').trim().slice(0, 80), req: !!(x && x.req), veids: String((x && x.veids) || '').trim().slice(0, 40) })).filter(x => x.t).slice(0, 20);
/** Lietotnes punkti (boot atbildei) */
export async function chkList(db, app) { return clean(await kv(db, 'chk:' + app)); }
/** Admins saglabā punktus */
export async function chkSave(db, app, name, who, list) {
  const old = await chkList(db, app), n = clean(list);
  await db.batch([kvSet(db, 'chk:' + app, n)]);
  await audit(db, who, name, 'Kontrolsaraksts', ['Punkti', old.map(x => x.t + (x.req ? '*' : '')).join('; '), n.map(x => x.t + (x.req ? '*' : '')).join('; ')]);
  return n;
}
/** Pārbauda izpildītāja atzīmes; veidi = darba veidi šim darbam (punkts ar veids rādās tikai tad). Atgriež stmt saglabāšanai vai null. */
export async function chkTake(db, app, visit, who, checks, veidi) {
  const L = (await chkList(db, app)).filter(p => !p.veids || (veidi || []).indexOf(p.veids) !== -1); if (!L.length) return null;
  const on = new Set((Array.isArray(checks) ? checks : []).map(String));
  const miss = L.filter(p => p.req && !on.has(p.t));
  if (miss.length) throw new Error('Kontrolsaraksts: atzīmējiet «' + miss.map(p => p.t).join('», «') + '»');
  const punkti = L.map(p => ({ t: p.t, ok: on.has(p.t), req: p.req }));
  return db.prepare('INSERT OR REPLACE INTO chk (app, visit, punkti, kas, laiks) VALUES (?, ?, ?, ?, ?)').bind(app, String(visit), JSON.stringify(punkti), String(who || '').slice(0, 80), nowStr());
}
/** Atzīmes vēsturei / aktam: { visitId: [{t, ok, req}] } */
export async function chkOf(db, app, ids) {
  ids = (ids || []).filter(Boolean); if (!ids.length) return {};
  const m = {};
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const r = (await db.prepare(`SELECT visit, punkti FROM chk WHERE app = ? AND visit IN (${part.map(() => '?').join(',')})`).bind(app, ...part).all().catch(() => ({ results: [] }))).results || [];
    r.forEach(x => { try { m[x.visit] = JSON.parse(x.punkti); } catch (e) {} });
  }
  return m;
}
