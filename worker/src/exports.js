/* SH | Eksporti grāmatvedībai (D6): Darba laika tabele un Personāla izmaiņas mēnesī. CSV veido pārlūks. Tikai portāla adminam. © VAITKEVIX, SIA */
import { workerHours } from './darbalaiks.js';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const iso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : /^\d{4}-\d\d-\d\d/.test(s || '') ? String(s).slice(0, 10) : ''; };
const okYm = (ym) => { if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis'); return ym; };

/** Tabele: vārds, tālrunis, stundas, dienas (tikai pabeigtie posmi skaitās stundās) */
export async function dlHoursMonth(db, ym) {
  okYm(ym); const H = await workerHours(db, ym + '-01', ym + '-31').catch(() => ({}));
  const names = {}; (await all(db, 'SELECT phone, vards FROM dl_worker').catch(() => [])).forEach(w => names[w.phone] = w.vards);
  return Object.values(H).map(h => ({ vards: names[h.phone] || h.vards || '', phone: h.phone || '', stundas: Math.round(h.min / 6) / 10, dienas: h.dienas, bezBeigam: h.navBeigu || 0 }))
    .sort((a, b) => a.vards.localeCompare(b.vards, 'lv'));
}
/** Personāla izmaiņas mēnesī: pieņemtie (sākuma datums), grozījumi (spēkā no), beigas (pēdējā diena) */
export async function persMonth(db, ym) {
  okYm(ym); const inM = (d) => iso(d).slice(0, 7) === ym, out = [];
  for (const r of await all(db, "SELECT * FROM pers_hire WHERE statuss NOT IN ('Dzēsts', 'Noraidīts')").catch(() => []))
    if (inM(r.sakums)) out.push({ id: r.id, veids: 'Pieņemšana', darbinieks: r.vards, datums: iso(r.sakums), sia: r.sia, objekts: r.objekts, amats: r.amats, alga: r.alga, slodze: '', iemesls: '', statuss: r.statuss });
  for (const r of await all(db, "SELECT * FROM pers_chg WHERE statuss NOT IN ('Dzēsts', 'Noraidīts')").catch(() => [])) {
    const d = r.beigu_datums || r.speka_no || r.iesniegts; if (!inM(d)) continue;
    out.push({ id: r.id, veids: r.veids || 'Grozījumi', darbinieks: r.darbinieks, datums: iso(d), sia: r.sia || r.sia_bija, objekts: r.objekts || r.objekts_bija, amats: r.amats, alga: r.alga, slodze: r.slodze, iemesls: r.iemesls, statuss: r.statuss });
  }
  return out.sort((a, b) => a.datums.localeCompare(b.datums) || String(a.darbinieks).localeCompare(String(b.darbinieks), 'lv'));
}
