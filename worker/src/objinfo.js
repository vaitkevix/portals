// SH | Objekta kartīte administrēšanā: viss par objektu vienuviet — algas pa amatiem, Darba laiks (kods, vajadzība, darbinieki),
// Personāla darbinieki, klients, grafiki. Algas izmanto Personāls (piedāvājums pieņemot darbā). © VAITKEVIX, SIA
import { anorm } from './util.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const GRAF = [['pl', 'pl_obj', 'Zāles pļaušana'], ['logi', 'logi_obj', 'Logu mazgāšana'], ['darz', 'darz_obj', 'Dārzniecība'], ['stav', 'stav_obj', 'Pazemes stāvvietas'], ['sniegs', 'sniegs_obj', 'Sniega tīrīšana']];
/* Pakalpojumi: karogs obj_info → lietotne, kurā objekts redzams */
export const SVC = { pazemes: ['stav_obj', 'stav_visit', 'Pazemes stāvvieta', 'stav'], zale: ['pl_obj', 'pl_visit', 'Zāliens (pļaušana)', 'pl'], logi: ['logi_obj', 'logi_visit', 'Logu mazgāšana', 'logi'],
  darz: ['darz_obj', 'darz_visit', 'Dārzniecība', 'darz'], sniegs: ['sniegs_obj', 'sniegs_visit', 'Sniega tīrīšana', 'sniegs'] };
const IP = ['stavi', 'kapnu', 'lifti', 'dzivokli'];
/* Pakalpojuma ieslēgšana kā vaicājumu saraksts (masveidam — batch) */
function svcStmts(db, k, key, on) {
  const [tbl, vis] = SVC[key];
  const st = [db.prepare('INSERT INTO obj_info (anorm, ' + key + ') VALUES (?, ?) ON CONFLICT(anorm) DO UPDATE SET ' + key + ' = excluded.' + key).bind(k, on ? 1 : 0)];
  if (!on) st.push(db.prepare('UPDATE ' + tbl + ' SET aktivs = 0 WHERE anorm = ?').bind(k),
    db.prepare('DELETE FROM ' + vis + " WHERE anorm = ? AND statuss = 'plan'" + (vis === 'pl_visit' ? '' : " AND avots != 'pieteikums'")).bind(k));   // pl_visit nav kolonnas avots
  return st;
}
async function setSvc(db, k, key, on) {
  const [tbl, vis] = SVC[key];
  await db.prepare('INSERT INTO obj_info (anorm, ' + key + ') VALUES (?, ?) ON CONFLICT(anorm) DO UPDATE SET ' + key + ' = excluded.' + key).bind(k, on ? 1 : 0).run();
  if (!on) {   // nav pakalpojuma → objekts pazūd no lietotnes, grafiks apturēts (vēsture paliek)
    await db.prepare('UPDATE ' + tbl + ' SET aktivs = 0 WHERE anorm = ?').bind(k).run().catch(() => 0);
    await db.prepare('DELETE FROM ' + vis + " WHERE anorm = ? AND statuss = 'plan' AND avots != 'pieteikums'").bind(k).run()
      .catch(() => db.prepare('DELETE FROM ' + vis + " WHERE anorm = ? AND statuss = 'plan'").bind(k).run().catch(() => 0));
  }
}
const pj = (s, d) => { try { return JSON.parse(s || '') || d; } catch (e) { return d; } };

/** Visas objektu algas: { anorm: [{ amats, alga, slodze }] } */
export async function allAlgas(db) {
  const o = {}; (await all(db, "SELECT anorm, algas FROM obj_info WHERE algas != '[]'").catch(() => [])).forEach(r => o[r.anorm] = pj(r.algas, [])); return o;
}

export async function info(db, adrese) {
  const k = anorm(adrese), out = { anorm: k };
  const oi = await first(db, 'SELECT * FROM obj_info WHERE anorm = ?', k).catch(() => null);
  out.algas = pj(oi && oi.algas, []); out.piezimes = (oi && oi.piezimes) || ''; out.pazemes = !!(oi && oi.pazemes);
  out.svc = Object.fromEntries(Object.keys(SVC).map(x => [x, !!(oi && oi[x])])); out.svcNames = Object.fromEntries(Object.keys(SVC).map(x => [x, SVC[x][2]]));
  out.ip = pj(oi && oi.ip, {}); out.parv = (oi && oi.parv) || '';
  const pl = await first(db, 'SELECT m2 FROM pl_obj WHERE anorm = ?', k).catch(() => null), lg = await first(db, 'SELECT qty FROM logi_obj WHERE anorm = ?', k).catch(() => null);
  out.apjoms = { zale_m2: pl ? pl.m2 : null, logi: lg ? lg.qty : null };
  const d = await first(db, 'SELECT kods, vajag_uzk, vajag_set, aktivs FROM dl_obj WHERE anorm = ?', k).catch(() => null);
  out.dl = { kods: d && d.aktivs ? d.kods : '', vajag_uzk: d ? !!d.vajag_uzk : true, vajag_set: d ? !!d.vajag_set : true,
    darbinieki: (await all(db, 'SELECT w.phone, w.vards, COALESCE(a.amats, w.amats) amats, w.aktivs FROM dl_worker w LEFT JOIN dl_assign a ON a.phone = w.phone AND a.anorm = ? WHERE a.anorm IS NOT NULL OR w.anorm = ? ORDER BY w.aktivs DESC, w.vards', k, k).catch(() => [])) };
  const c = await first(db, 'SELECT c.name FROM client_obj o JOIN clients c ON c.id = o.client WHERE o.anorm = ?', k).catch(() => null);
  out.klients = c ? c.name : '';
  out.grafiki = [];
  for (const [app, tbl, name] of GRAF) { const r = await first(db, 'SELECT aktivs FROM ' + tbl + ' WHERE anorm = ?', k).catch(() => null); if (r) out.grafiki.push({ app, name, aktivs: !!r.aktivs }); }
  // Personāls: apstiprināti/jauni pieņemšanas ieraksti ar šo objektu
  const low = String(adrese || '').trim().toLowerCase();
  out.personals = (await all(db, "SELECT id, vards, amats, objekts, statuss, sakums FROM pers_hire WHERE statuss NOT IN ('Noraidīts', 'Dzēsts')").catch(() => []))
    .filter(h => String(h.objekts || '').split(';').some(e => e.split('—')[0].trim().toLowerCase() === low)).map(h => ({ id: h.id, vards: h.vards, statuss: h.statuss, sakums: h.sakums,
      amats: (String(h.objekts).split(';').find(e => e.split('—')[0].trim().toLowerCase() === low) || '').split('—').slice(1).filter(x => !/\d\s*(EUR|€)?\s*$/i.test(x.trim())).join('').trim() }));
  return out;
}

export async function save(db, b) {
  const k = anorm(b.adrese); if (!k) throw new Error('Nav objekta');
  const algas = (Array.isArray(b.algas) ? b.algas : []).map(a => ({ amats: String(a.amats || '').trim(), alga: Math.round((parseFloat(String(a.alga || '').replace(',', '.')) || 0) * 100) / 100, slodze: String(a.slodze || '').trim().slice(0, 40) }))
    .filter(a => a.amats && a.alga > 0);
  const kods = b.dl ? String(b.dl.kods || '').trim().toUpperCase() : '';
  if (kods) {   // vispirms pārbauda — lai nekas netiek saglabāts pa pusei
    if (!/^[0-9A-Z-]{1,8}$/.test(kods)) throw new Error('Darba laika kods — līdz 8 cipariem/burtiem, piem. 104');
    if (await first(db, 'SELECT anorm FROM dl_obj WHERE kods = ? AND anorm != ?', kods, k)) throw new Error('Darba laika kods ' + kods + ' jau ir citam objektam');
  }
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO obj_info (anorm, algas, piezimes, atjaunots) VALUES (?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET algas = excluded.algas, piezimes = excluded.piezimes, atjaunots = excluded.atjaunots')
    .bind(k, JSON.stringify(algas), String(b.piezimes || '').trim().slice(0, 2000), now).run();
  if ('pazemes' in b && !b.svc) b.svc = { pazemes: !!b.pazemes };
  if (b.svc) for (const x of Object.keys(SVC)) if (x in b.svc) await setSvc(db, k, x, !!b.svc[x]);
  if (b.ip) { const ip = {}; IP.forEach(x => { const n = parseInt(b.ip[x], 10); if (n >= 0 && n < 10000) ip[x] = n; }); await db.prepare('UPDATE obj_info SET ip = ? WHERE anorm = ?').bind(JSON.stringify(ip), k).run(); }
  if ('parv' in b) await db.prepare('UPDATE obj_info SET parv = ? WHERE anorm = ?').bind(String(b.parv || '').trim().slice(0, 120), k).run();
  if (b.dl) {   // Darba laiks: SMS kods un vajadzība (tā pati loģika kā Darba laika Iestatījumos)
    if (!kods) await db.prepare('UPDATE dl_obj SET aktivs = 0 WHERE anorm = ?').bind(k).run();
    else {
      await db.prepare('INSERT INTO dl_obj (anorm, kods, vajag_uzk, vajag_set, aktivs) VALUES (?, ?, ?, ?, 1) ON CONFLICT(anorm) DO UPDATE SET kods = excluded.kods, vajag_uzk = excluded.vajag_uzk, vajag_set = excluded.vajag_set, aktivs = 1')
        .bind(k, kods, b.dl.vajag_uzk === false ? 0 : 1, b.dl.vajag_set === false ? 0 : 1).run();
    }
  }
  return info(db, b.adrese);
}

/** Vairākiem objektiem uzreiz: ieslēgt/izslēgt pakalpojumu. adreses → on (true/false) */
export async function bulk(db, key, list) {
  if (!SVC[key]) throw new Error('Nezināms pakalpojums');
  const L = (list || []).filter(x => anorm(x && x.adrese)); if (L.length > 300) throw new Error('Vienā reizē līdz 300 objektiem — sadaliet sarakstu');
  const st = []; L.forEach(x => st.push(...svcStmts(db, anorm(x.adrese), key, !!x.on)));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));   // D1: ≤1000 vaicājumu uz izsaukumu
  return L.length;
}
/** Kopsavilkums objektu sarakstam: { anorm: { pazemes, zale, ... } } */
export async function svcMap(db) {
  const o = {}; (await all(db, 'SELECT * FROM obj_info').catch(() => [])).forEach(r => { o[r.anorm] = Object.fromEntries(Object.keys(SVC).map(x => [x, !!r[x]])); o[r.anorm].parv = r.parv || ''; }); return o;
}

/** Vairākiem objektiem uzreiz: pārvaldnieks */
export async function bulkParv(db, parv, list) {
  const v = String(parv || '').trim().slice(0, 120); let n = 0;
  const ks = [...new Set((list || []).map(anorm).filter(Boolean))]; if (ks.length > 900) throw new Error('Vienā reizē līdz 900 objektiem — sadaliet sarakstu');
  const st = ks.map(k => db.prepare('INSERT INTO obj_info (anorm, parv) VALUES (?, ?) ON CONFLICT(anorm) DO UPDATE SET parv = excluded.parv').bind(k, v));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90)); n = ks.length;
  return n;
}

/* C6: plānotās stundas nedēļā no algām pa amatiem (slodze): pilna 40 h, nepilna / 0,5 — 20 h, 0,25 — 10 h; «NN h» — tieši. Bez slodzes — nav normas. */
export function normaNed(algas) {
  let h = 0;
  for (const a of algas || []) { const s = String(a.slodze || '').toLowerCase().replace(',', '.'); let x = 0;
    if (/(\d+(?:\.\d+)?)\s*h/.test(s)) x = +RegExp.$1; else if (/^0?\.\d+|^1(\.0+)?\b/.test(s)) x = 40 * parseFloat(s); else if (/nepiln/.test(s)) x = 20; else if (/piln/.test(s)) x = 40;
    h += x > 0 && x <= 80 ? x : 0; }
  return Math.round(h * 10) / 10;
}
/** { anorm: stundas nedēļā } objektiem, kam norādīta slodze */
export async function normas(db) {
  const o = {}, A = await allAlgas(db); for (const k in A) { const n = normaNed(A[k]); if (n > 0) o[k] = n; } return o;
}
