/* SH | Rentabilitāte (D9): mēnesī pa klientiem un objektiem — ieņēmumi (atskaite + līgumcena) − izmaksas
 * (Darba laika stundas × stundas likme no iestatījuma, izvešanas izmaksas no izv_task). Citas izmaksas netiek izdomātas: ja nav datu — null. © VAITKEVIX, SIA */
import { report } from './klienti.js';
import { objMinutes } from './darbalaiks.js';
import { anorm } from './util.js';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const r2 = (n) => Math.round(n * 100) / 100;
const eurN = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d,.-]/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
const dmyIso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; };

export async function rentCfg(db) { const r = await db.prepare("SELECT v FROM kv WHERE k = 'rent:likme'").first(); const v = r ? +r.v : 0; return { likme: v > 0 ? v : null }; }
export async function rentCfgSave(db, likme) { const v = eurN(likme); await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('rent:likme', ?)").bind(v > 0 ? String(r2(v)) : '').run(); return rentCfg(db); }

export async function profit(db, ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis');
  const d0 = ym + '-01', d1 = ym + '-31', { likme } = await rentCfg(db);
  const objs = await all(db, 'SELECT anorm, adrese FROM objects'), adr = Object.fromEntries(objs.map(o => [o.anorm, o.adrese]));
  const own = Object.fromEntries((await all(db, 'SELECT anorm, client FROM client_obj')).map(r => [r.anorm, r.client]));
  const mins = await objMinutes(db, d0, d1).catch(() => ({}));
  const izv = {};   // izvešanas izmaksas pa objektiem (pēc izpildes datuma)
  for (const t of await all(db, "SELECT adrese, izmaksas, bez_pvn, izpildits FROM izv_task WHERE statuss = 'Izpildīts'").catch(() => [])) {
    const d = dmyIso(t.izpildits); if (!d || d < d0 || d > d1) continue;
    const v = eurN(t.izmaksas) != null ? eurN(t.izmaksas) : eurN(t.bez_pvn); if (v == null) continue; const k = anorm(t.adrese); izv[k] = r2((izv[k] || 0) + v);
  }
  const clients = await all(db, 'SELECT id, name FROM clients WHERE aktivs = 1 ORDER BY ord, name'), out = [];
  const objRow = (k, a) => ({ anorm: k, adrese: a || adr[k] || k, ien: 0, h: null, darbs: null, izv: null, izm: null, pelna: null });
  const fill = (o) => { const m = mins[o.anorm]; if (m) { o.h = Math.round(m / 6) / 10; o.darbs = likme ? r2(o.h * likme) : null; } if (izv[o.anorm] != null) o.izv = izv[o.anorm];
    o.izm = o.darbs == null && o.izv == null ? null : r2((o.darbs || 0) + (o.izv || 0)); o.pelna = o.izm == null ? null : r2(o.ien - o.izm); return o; };
  const used = new Set();
  for (const c of clients) {
    const R = await report(db, c.id, ym), by = {};
    Object.keys(own).filter(k => own[k] === c.id).forEach(k => by[k] = objRow(k));
    let lig = 0;
    for (const r of R.rows) { if (r.app === 'ligums' && r.adrese === 'Visi objekti') { lig = r2(lig + r.summa); continue; } const k = anorm(r.adrese); (by[k] = by[k] || objRow(k, r.adrese)).ien = r2(by[k].ien + (r.summa || 0)); }
    const L = Object.values(by).map(fill); L.forEach(o => used.add(o.anorm));
    const izm = L.some(o => o.izm != null) ? r2(L.reduce((s, o) => s + (o.izm || 0), 0)) : null;
    out.push({ id: c.id, name: c.name, ien: R.total, ligVisi: lig, izm, pelna: izm == null ? null : r2(R.total - izm), objekti: L.filter(o => o.ien || o.h || o.izv).sort((a, b) => b.ien - a.ien) });
  }
  // izmaksas objektos bez klienta (vai neaktīva klienta) — lai redz, ka darbs ir, bet ieņēmumu nav
  const bez = [...new Set(Object.keys(mins).concat(Object.keys(izv)))].filter(k => !used.has(k)).map(k => fill(objRow(k))).filter(o => o.h || o.izv);
  return { ym, likme, clients: out, bezKlienta: bez.sort((a, b) => (b.izm || 0) - (a.izm || 0)).slice(0, 100) };
}
