/* Izpildītāju rēķini: izpildītāja SIA (piem. izvedējs) par mēnesi izraksta atsevišķu rēķinu ar aktu KATRAI pārvaldīšanas SIA,
 * kurai pieder objekti (Mājas lieta → obj_info.parv). Rindas = SIA «Mans mēnesis» (siaMonth); cenas — izpildītāja cenas (kv siaCen:<SIA>),
 * izvešanai + koeficienti (+10 % smagi maisi u.c.). Izrakstīt var tikai saskaņotu mēnesi. Rekvizīti — kv req:<nosaukums>.  © VAITKEVIX, SIA */
import { akey, splitAddr } from './util.js';
import { siaMonth } from './siadarbs.js';
import { ALL_UNITS } from './klienti.js';
import { audit, diff } from './audit.js';

const J = (s) => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
const r2 = (x) => Math.round((+x || 0) * 100) / 100;
const nowRiga = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }).format(new Date());
const addD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
export const REQ = ['nosaukums', 'regnr', 'pvnnr', 'adrese', 'banka', 'iban', 'swift', 'epasts', 'talrunis', 'apmaksa_dienas', 'prefikss', 'bezpvn'];
export const SIA_APPS = ['izv', 'kais', 'pl', 'logi', 'darz', 'stav', 'sniegs'];
export const INV_ST = ['izrakstīts', 'apmaksāts', 'anulēts'];

/** Uzņēmuma rekvizīti (izpildītājam un pārvaldniekam) */
export async function req(db, name) {
  const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('req:' + name).first(); const o = J(r && r.v);
  return Object.assign({ nosaukums: name, apmaksa_dienas: '14' }, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null)));
}
export async function reqSave(db, name, b, who) {
  if (!name) throw new Error('Nav uzņēmuma');
  const o = {}; REQ.forEach(k => { o[k] = k === 'bezpvn' ? !!(b || {})[k] : String((b || {})[k] || '').trim().slice(0, 200); });
  if (who) { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('req:' + name).first(); await audit(db, who, 'Rekvizīti', name, diff(J(r && r.v), o, REQ)); }
  await db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('req:' + name, JSON.stringify(o)).run(); return req(db, name);
}
/** Izpildītāja cenas €/vienību (bez PVN) */
export async function prices(db, company) { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('siaCen:' + company).first(); return J(r && r.v); }
export async function pricesSave(db, company, b, who) {
  const o = {}; SIA_APPS.forEach(a => { const v = Math.round(Math.max(0, +String((b || {})[a] || '').replace(',', '.') || 0) * 10000) / 10000; if (v) o[a] = v; });
  if (who) { const was = await prices(db, company); await audit(db, who, 'Izpildītāju cenas', company, SIA_APPS.filter(a => (was[a] || 0) !== (o[a] || 0)).map(a => [ALL_UNITS[a].name, String(was[a] || ''), String(o[a] || '')])); }
  await db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('siaCen:' + company, JSON.stringify(o)).run(); return o;
}
/** adrese → pārvaldīšanas SIA (Mājas lieta). Apvienotā objekta mājas arī. Neviennozīmīgs → '' */
async function parvOf(db) {
  const O = await all(db, "SELECT o.adrese, COALESCE(i.parv, '') parv FROM objects o LEFT JOIN obj_info i ON i.anorm = o.anorm");
  const m = {}, put = (k, p) => { if (!k) return; if (!(k in m)) m[k] = p; else if (m[k] !== p) m[k] = ''; };
  O.forEach(o => { put(akey(o.adrese), o.parv); });
  O.forEach(o => splitAddr(o.adrese).forEach(x => { const k = akey(x.adrese); if (k && !(k in m)) m[k] = o.parv; }));
  return (adr) => m[akey(adr)] || '';
}
const pct = (s) => { let p = 0; String(s || '').replace(/([+-]?\d+(?:[.,]\d+)?)\s*%/g, (_, n) => { p += +n.replace(',', '.'); return _; }); return p; };

/** Mēneša pārskats izpildītājam: rindas sagrupētas pa pārvaldniekiem, cenas, jau izrakstītie rēķini */
export async function siaInvMonth(db, company, ym) {
  const M = await siaMonth(db, company, ym), P = await prices(db, company), pv = await parvOf(db);
  const G = {}, nav = [];
  for (const r of M.rows) {
    const parv = pv(r.adrese), cena = +P[r.app] || 0, k = r.app === 'izv' ? 1 + pct(r.koef) / 100 : 1;
    const x = { app: r.app, datums: r.datums, adrese: r.adrese, daudz: r.daudz, koef: r.app === 'izv' ? r.koef || '' : '', cena, summa: r2((+r.daudz || 0) * cena * k), piez: r.piez || '', foto: r.foto || [] };
    if (!parv) { nav.push(x); continue; }
    (G[parv] = G[parv] || []).push(x);
  }
  const issued = {}; (await all(db, 'SELECT nr, parv, statuss, ar_pvn, datums FROM sia_inv WHERE company = ? AND ym = ?', company, ym)).forEach(i => issued[i.parv] = i);
  const groups = Object.keys(G).sort().map(parv => { const rows = G[parv], sm = sumUp(rows), tot = r2(sm.reduce((a, s) => a + s.summa, 0)); return { parv, rows, sum: sm, total: tot, inv: issued[parv] || null }; });
  Object.keys(issued).filter(p => !G[p]).forEach(p => groups.push({ parv: p, rows: [], sum: [], total: 0, inv: issued[p] }));
  return { company, ym, saskanots: M.saskanots, cenas: P, groups, nav, bezCenas: SIA_APPS.filter(a => M.rows.some(r => r.app === a) && !P[a]) };
}
function sumUp(rows) {
  const s = {}; rows.forEach(r => { const u = ALL_UNITS[r.app] || { name: r.app, unit: '' }, k = r.app + '|' + r.cena; const x = s[k] = s[k] || { app: r.app, name: u.name, unit: u.unit, reizes: 0, daudz: 0, cena: r.cena, summa: 0 };
    x.reizes++; x.daudz = r2(x.daudz + (+r.daudz || 0)); x.summa = r2(x.summa + r.summa); });
  return Object.values(s);
}
/** Izraksta rēķinu vienam pārvaldniekam (atkārtoti — atdod esošo) */
export async function siaInvIssue(db, company, ym, parv, who) {
  parv = String(parv || '').trim(); if (!parv) throw new Error('Nav norādīts pārvaldnieks');
  const ex = await db.prepare('SELECT * FROM sia_inv WHERE company = ? AND parv = ? AND ym = ?').bind(company, parv, ym).first(); if (ex) return row(ex);
  const M = await siaInvMonth(db, company, ym);
  if (!M.saskanots) throw new Error('Mēnesis vēl nav saskaņots — rēķinu var izrakstīt pēc saskaņošanas');
  if (M.bezCenas.length) throw new Error('Nav ievadītas cenas: ' + M.bezCenas.map(a => ALL_UNITS[a].name).join(', '));
  const g = M.groups.find(x => x.parv === parv); if (!g || !g.rows.length || !(g.total > 0)) throw new Error('Šim pārvaldniekam šajā mēnesī nav darbu ar summu');
  const F = await req(db, company), T = await req(db, parv), d = nowRiga(), y = d.slice(0, 4);
  const pre = (F.prefikss || company.replace(/^SIA\s+/i, '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'R').replace(/[^\wĀ-ž-]/g, '');
  const sq = await db.prepare("INSERT INTO kv (k, v) VALUES (?, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1 RETURNING v").bind('siaInvSeq:' + company + ':' + y).first();
  const nr = pre + '-' + y + '-' + String(+((sq && sq.v) || 1)).padStart(3, '0');
  const likme = F.bezpvn ? 0 : 21, pvn = r2(g.total * likme / 100);
  const dati = JSON.stringify({ from: F, to: T, likme, rows: g.rows.map(r => Object.assign({}, r, { foto: (r.foto || []).slice(0, 4) })), sum: g.sum });
  await db.prepare('INSERT OR IGNORE INTO sia_inv (nr, company, parv, ym, datums, termins, summa, pvn, ar_pvn, dati, izveidots, kas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(nr, company, parv, ym, d, addD(d, Math.max(0, +F.apmaksa_dienas || 14)), g.total, pvn, r2(g.total + pvn), dati, new Date().toISOString(), String(who || '')).run();
  await audit(db, who || company, 'Izpildītāju rēķini', nr + ' · ' + company + ' → ' + parv, ['izrakstīts', '', String(r2(g.total + pvn)) + ' €']);
  return row(await db.prepare('SELECT * FROM sia_inv WHERE company = ? AND parv = ? AND ym = ?').bind(company, parv, ym).first());
}
function row(r) { if (!r) return null; const o = Object.assign({}, r); o.dati = J(r.dati); return o; }
export async function siaInvGet(db, nr, company) {
  const r = await db.prepare('SELECT * FROM sia_inv WHERE nr = ?').bind(String(nr || '')).first(); if (!r || (company && r.company !== company)) throw new Error('Rēķins nav atrasts'); return row(r);
}
export async function siaInvList(db, f) {
  f = f || {}; const w = [], a = [];
  if (f.company) { w.push('company = ?'); a.push(f.company); } if (f.parv) { w.push('parv = ?'); a.push(f.parv); } if (f.ym) { w.push('ym = ?'); a.push(f.ym); }
  const L = await all(db, 'SELECT nr, company, parv, ym, datums, termins, summa, pvn, ar_pvn, statuss, apmaksats, piezime FROM sia_inv' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY datums DESC, nr DESC LIMIT 500', ...a);
  const t = nowRiga(); L.forEach(o => { o.kave = o.statuss === 'izrakstīts' && o.termins && o.termins < t ? Math.round((Date.parse(t) - Date.parse(o.termins)) / 864e5) : 0; });
  return { list: L };
}
/** Pārvaldnieka puse (admins): apmaksāts / anulēts (anulēts → izpildītājs var izrakstīt no jauna) */
export async function siaInvSet(db, b, who) {
  const r = await db.prepare('SELECT * FROM sia_inv WHERE nr = ?').bind(String(b.nr || '')).first(); if (!r) throw new Error('Rēķins nav atrasts');
  const st = INV_ST.indexOf(b.statuss) !== -1 ? b.statuss : r.statuss, d = st === 'apmaksāts' ? (/^\d{4}-\d{2}-\d{2}$/.test(b.apmaksats || '') ? b.apmaksats : (r.apmaksats || nowRiga())) : '';
  if (st === 'anulēts') {   // atbrīvo vietu jaunam (unikāls company+parv+ym): anulēto pārdēvē ar sufiksu
    await db.prepare("UPDATE sia_inv SET statuss = 'anulēts', ym = ym || '·anul·' || ?, piezime = ? WHERE nr = ?").bind(String(Date.now()), String(b.piezime || r.piezime || '').slice(0, 300), r.nr).run();
  } else await db.prepare('UPDATE sia_inv SET statuss = ?, apmaksats = ?, piezime = ? WHERE nr = ?').bind(st, d, String(b.piezime != null ? b.piezime : r.piezime).slice(0, 300), r.nr).run();
  await audit(db, who, 'Izpildītāju rēķini', r.nr + ' · ' + r.company + ' → ' + r.parv, ['statuss', r.statuss, st]);
  return row(await db.prepare('SELECT * FROM sia_inv WHERE nr = ?').bind(r.nr).first());
}
/** Pārvaldīšanas SIA saraksts (Uzņēmumi ar «darba_devejs» + Mājas lietā ierakstītie) */
export async function parvList(db) {
  const a = (await all(db, "SELECT name FROM companies WHERE active = 1 AND kinds LIKE '%darba_devejs%' ORDER BY ord, name")).map(r => r.name);
  (await all(db, "SELECT DISTINCT parv FROM obj_info WHERE parv != ''").catch(() => [])).forEach(r => { if (a.indexOf(r.parv) === -1) a.push(r.parv); });
  return a;
}
