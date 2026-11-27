/* SH | C11: sezonas maiņas vednis (Administrēšana → Sezona). Rudenī — sniega maršruti/brigādes objektiem ar sniega pakalpojumu,
 * traktoristu tālruņi, sāls/smilšu krājums; pavasarī — pļaušanas objekti un m², dārzs, pļāvēji. Tikai pārbaude + saites; krājumu ievada šeit (kv kais:krajums). © VAITKEVIX, SIA */
import { today, nowStr, kv, kvSet } from './util.js';
import { audit } from './audit.js';
import * as inv from './inv.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const MAT = [['sals', 'Sāls'], ['smilts', 'Smilts'], ['mix', 'Smilts + sāls']];
/* I8: krājums (t) = inventāra atlikums (Administrēšana → Inventārs); šeit ievadītais = inventarizācija */

export async function season(db, kind) {
  kind = kind === 'pavasaris' ? 'pavasaris' : 'rudens';
  const O = {}; (await all(db, 'SELECT anorm, adrese, vaditajs FROM objects')).forEach(o => O[o.anorm] = o);
  const C = await all(db, 'SELECT name, kinds, phone, active FROM companies WHERE active = 1').catch(() => []);
  const checks = [], items = [];
  const chk = (k, n, bad, total, d, app) => checks.push({ k, n, ok: !bad, v: bad, total, d: d || '', app: app || '' });
  if (kind === 'rudens') {
    const S = await all(db, "SELECT i.anorm, s.aktivs, s.brigade, s.lat FROM obj_info i LEFT JOIN sniegs_obj s ON s.anorm = i.anorm WHERE i.sniegs = 1").catch(() => []);
    const L = S.filter(x => O[x.anorm]);
    const noR = L.filter(x => x.aktivs == null || !x.aktivs), noB = L.filter(x => x.aktivs && !x.brigade), noG = L.filter(x => x.aktivs && (x.lat == null || x.lat === 0));
    chk('sn_obj', 'Objekti ar sniega pakalpojumu ir sniega maršrutā', noR.length, L.length, noR.slice(0, 6).map(x => O[x.anorm].adrese).join(', '), 'sniegs');
    chk('sn_br', 'Katram objektam norādīta brigāde / traktorists', noB.length, L.length, noB.slice(0, 6).map(x => O[x.anorm].adrese).join(', '), 'sniegs');
    chk('sn_geo', 'Objektiem ir koordinātas maršrutam', noG.length, L.length, noG.slice(0, 6).map(x => O[x.anorm].adrese).join(', '), 'sniegs');
    const T = C.filter(c => String(c.kinds).split(',').indexOf('traktorists') !== -1), used = [...new Set(L.map(x => x.brigade).filter(Boolean))];
    const noPh = T.filter(c => !c.phone);
    chk('sn_tel', 'Traktoristiem (SIA) ir tālrunis SMS izsaukumam', T.length ? noPh.length : 1, T.length, T.length ? noPh.map(c => c.name).join(', ') : 'Nav neviena uzņēmuma ar pilnvaru «Traktorists» (Uzņēmumi)', '');
    const unk = used.filter(b => !T.some(c => c.name === b));
    if (unk.length) chk('sn_unk', 'Maršrutu brigādes ir zināmas', unk.length, used.length, unk.join(', ') + ' — nav starp traktoristiem (var būt cilvēki ar PIN)', 'sniegs');
    const K = Object.assign({}, (await kv(db, 'kais:krajums')) || {}, await inv.krajums(db).catch(() => ({}))), low = MAT.filter(([k]) => !(+K[k] > 0));   // I8: atlikums no inventāra
    chk('kais', 'Sāls un smilšu krājums ievadīts', low.length, MAT.length, low.length ? 'Nav: ' + low.map(m => m[1].toLowerCase()).join(', ') : MAT.map(([k, n]) => n + ' ' + K[k] + ' t').join(' · ') + (K.atjaunots ? ' (' + K.atjaunots + ')' : ''), 'kais');
    const pend = await all(db, "SELECT COUNT(*) n FROM kais_task WHERE statuss NOT IN ('Piegādāts', 'Atcelts')").catch(() => [{ n: 0 }]);
    checks.push({ k: 'kais_open', n: 'Atvērtie kaisāmmateriāla pieteikumi', ok: true, v: pend[0].n, total: 0, d: '', app: 'kais', info: true });
    noR.concat(noB).slice(0, 60).forEach(x => items.push({ adrese: O[x.anorm].adrese, vaditajs: O[x.anorm].vaditajs, kas: x.aktivs == null || !x.aktivs ? 'nav sniega maršrutā' : 'nav brigādes', app: 'sniegs' }));
    return { kind, checks, items, krajums: K, mat: MAT };
  }
  const P = await all(db, 'SELECT i.anorm, p.aktivs, p.m2, p.brigade FROM obj_info i LEFT JOIN pl_obj p ON p.anorm = i.anorm WHERE i.zale = 1').catch(() => []);
  const L = P.filter(x => O[x.anorm]), noR = L.filter(x => x.aktivs == null || !x.aktivs), noM = L.filter(x => x.aktivs && !(x.m2 > 0)), noB = L.filter(x => x.aktivs && !x.brigade);
  chk('pl_obj', 'Objekti ar zālienu ir pļaušanas grafikā', noR.length, L.length, noR.slice(0, 6).map(x => O[x.anorm].adrese).join(', '), 'pl');
  chk('pl_m2', 'Pļaušanas objektiem norādīti m²', noM.length, L.length, noM.slice(0, 6).map(x => O[x.anorm].adrese).join(', '), 'pl');
  chk('pl_br', 'Pļaušanas objektiem norādīts izpildītājs', noB.length, L.length, noB.slice(0, 6).map(x => O[x.anorm].adrese).join(', '), 'pl');
  const m2 = L.filter(x => x.aktivs).reduce((n, x) => n + (+x.m2 || 0), 0);
  checks.push({ k: 'pl_sum', n: 'Kopā pļaujamā platība', ok: true, v: Math.round(m2) + ' m²', total: 0, d: '', app: 'pl', info: true });
  const D = await all(db, 'SELECT i.anorm, d.aktivs FROM obj_info i LEFT JOIN darz_obj d ON d.anorm = i.anorm WHERE i.darz = 1').catch(() => []), noD = D.filter(x => O[x.anorm] && (x.aktivs == null || !x.aktivs));
  chk('darz', 'Dārzniecības objekti ir grafikā', noD.length, D.length, noD.slice(0, 6).map(x => O[x.anorm].adrese).join(', '), 'darz');
  const PL = C.filter(c => String(c.kinds).split(',').indexOf('plausejs') !== -1), noPh = PL.filter(c => !c.phone);
  if (PL.length) chk('pl_tel', 'Pļāvējiem (SIA) ir tālrunis', noPh.length, PL.length, noPh.map(c => c.name).join(', '), '');
  noR.concat(noM, noB).slice(0, 60).forEach(x => items.push({ adrese: O[x.anorm].adrese, vaditajs: O[x.anorm].vaditajs, kas: x.aktivs == null || !x.aktivs ? 'nav pļaušanas grafikā' : !(x.m2 > 0) ? 'nav m²' : 'nav izpildītāja', app: 'pl' }));
  return { kind, checks, items };
}
export async function krajumsSave(db, who, b) {
  const K = (await kv(db, 'kais:krajums')) || {}, was = Object.assign({}, K), ch = [];
  for (const [k, n] of MAT) if (b[k] != null && b[k] !== '') { const v = Math.round(Math.max(0, Math.min(100000, parseFloat(String(b[k]).replace(',', '.')) || 0)) * 10) / 10; if (v !== +was[k]) ch.push([n + ', t', was[k] == null ? '' : String(was[k]), String(v)]); K[k] = v; }
  K.atjaunots = today(); K.kas = who; await kvSet(db, 'kais:krajums', K).run();
  await inv.setStock(db, who, b).catch(e => console.error('inv stock', e));   // I8: tas pats atlikums inventārā (inventarizācija)
  await audit(db, who, 'Sezona', 'Kaisāmmateriāla krājums', ch);
  return K;
}
