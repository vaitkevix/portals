/* SH | «Neieradās» — Darba laikā līdz iestatītam laikam (dl:cfg.noshow, noklusējums 08:00) darbiniekam ar piesaisti objektam nav START.
 * Prombūtnē (atvaļinājums, slimības lapa u.c. — prombutnes.absMap) un brīvdienās/svētkos neziņo.
 * notStarted() izmanto arī Rīta ziņa (rits.js). Cron (SMS_F «neieradas», noklusējumā izslēgts) → vadītājam push + aizvietošanas MELNRAKSTS
 * šodienai tiem objektiem (C4 mehānisms: standing.melnraksts = '1'); publicē tikai vadītājs (standingApprove). © VAITKEVIX, SIA */
import { today, dow, nowStr, kv, kvSet } from './util.js';
import { lvHolidays } from './personals.js';
import { absMap, vkey, standingDrafts } from './prombutnes.js';
import { notify, managers } from './webpush.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : -1; };
export const isWorkday = (d) => dow(d) <= 5 && !lvHolidays(+d.slice(0, 4)).has(d);

/** Kas līdz `cutoff` (HH:MM) dienā d nav sācis darbu savos objektos. only — objektu anorm kopa (vadītājam). Atgriež [{ phone, vards, sak, objs:[{anorm, adrese, vaditajs, amats}] }] */
export async function notStarted(db, d, cutoff, only) {
  const A = await all(db, `SELECT w.phone, w.vards, a.anorm, a.amats FROM dl_assign a JOIN dl_worker w ON w.phone = a.phone WHERE w.aktivs = 1
    UNION SELECT w.phone, w.vards, w.anorm, w.amats FROM dl_worker w WHERE w.aktivs = 1 AND w.anorm != '' AND NOT EXISTS (SELECT 1 FROM dl_assign x WHERE x.phone = w.phone)`).catch(() => []);
  if (!A.length) return [];
  const O = {}; (await all(db, 'SELECT o.anorm, o.adrese, o.vaditajs FROM objects o JOIN dl_obj d ON d.anorm = o.anorm WHERE d.aktivs = 1').catch(() => [])).forEach(o => O[o.anorm] = o);
  const first = {}; (await all(db, "SELECT phone, MIN(laiks) l FROM dl_mark WHERE datums = ? AND veids = 'sak' AND phone != '' GROUP BY phone", d).catch(() => [])).forEach(r => first[r.phone] = r.l);
  const AB = await absMap(db, d, d).catch(() => ({})), cm = mins(cutoff), by = {};
  for (const r of A) {
    const o = O[r.anorm]; if (!o || (only && !only.has(r.anorm))) continue;
    if ((AB[vkey(r.vards)] || {})[d]) continue;   // prombūtnē / atvaļinājumā
    const f = first[r.phone]; if (f && mins(f) <= cm) continue;
    const x = by[r.phone] || (by[r.phone] = { phone: r.phone, vards: r.vards || r.phone, sak: f || '', objs: [] });
    if (!x.objs.some(z => z.anorm === o.anorm)) x.objs.push({ anorm: o.anorm, adrese: o.adrese, vaditajs: o.vaditajs, amats: r.amats });
  }
  return Object.values(by).sort((a, b) => a.vards.localeCompare(b.vards, 'lv'));
}

/** Cron (ik 5 min, darbalaiks): vienreiz dienā pēc dl:cfg.noshow; tikai, ja SMS_F «neieradas» ieslēgts. force — testam/pogai */
export async function noShowCron(env, force) {
  const db = env.DB, d = today(), t = nowStr().slice(11, 16);
  const F = (await kv(db, 'sms:cfg')) || {}; if (F.neieradas !== true && !force) return { skip: 'izslēgts' };
  if (!isWorkday(d) && !force) return { skip: 'brīvdiena' };
  const C = Object.assign({ noshow: '08:00' }, (await kv(db, 'dl:cfg')) || {}), cut = /^\d\d:\d\d$/.test(C.noshow) ? C.noshow : '08:00';
  if (!force && (t < cut || mins(t) > mins(cut) + 180)) return { skip: 'laiks' };
  if (!force && (await kv(db, 'noshow:last')) === d) return { skip: 'jau' };
  await kvSet(db, 'noshow:last', d).run();   // atzīme pirms — kļūdas gadījumā nesūta katras 5 min
  const L = await notStarted(db, d, cut), res = [];
  const adm = await managers(env, 'aizv').catch(() => []);
  for (const w of L) {
    const n = await standingDrafts(env, { src: 'noshow:' + d + ':' + w.phone, vards: w.vards, no: d, lidz: d, prombutne: '', objs: w.objs, silent: true, apraksts: 'Neieradās: ' + w.vards }).catch(e => { console.error('noshow draft', e); return 0; });
    const mg = [...new Set(w.objs.map(o => o.vaditajs).filter(Boolean))];
    const to = mg.length ? mg : adm;
    await notify(env, to, { title: w.vards + ' nav atnācis: ' + w.objs.length + ' ' + (w.objs.length === 1 ? 'objekts' : 'objekti'),
      body: w.objs.slice(0, 3).map(o => o.adrese).join(', ') + (w.objs.length > 3 ? '…' : '') + (w.sak ? ' · START ' + w.sak : ' · nav START') + ' — atveriet aizvietošanas melnrakstu', url: '/sh/#aizv', urgent: true }).catch(() => 0);
    res.push({ vards: w.vards, objekti: w.objs.length, melnraksti: n });
  }
  await kvSet(db, 'noshow:log', { datums: d, laiks: nowStr(), res }).run();
  return { datums: d, res };
}
