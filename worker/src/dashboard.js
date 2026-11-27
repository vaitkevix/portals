/* SH | Vadības panelis: viens skats pār visām lietotnēm — izpildīts šonedēļ/mēnesī, plānots, nokavēts, 8 nedēļu tendence,
 * vecākie nokavētie darbi, atvērtie izvešanas/kaisāmmateriāla pieteikumi, Darba laiks šodien, rezerves kopija. Tikai portāla adminam. © VAITKEVIX, SIA */
import { today } from './util.js';
import { persTerms } from './perscard.js';
import { normaWarn } from './darbalaiks.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return addDays(d, -((w + 6) % 7)); };
const dmyIso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : /^\d{4}-\d\d-\d\d/.test(s || '') ? String(s).slice(0, 10) : ''; };
const parse = (s) => { try { return JSON.parse(s || 'null'); } catch (e) { return null; } };

const VIS = [['pl', 'pl_visit', 'Zāles pļaušana'], ['logi', 'logi_visit', 'Logu mazgāšana'], ['darz', 'darz_visit', 'Dārzniecība'], ['stav', 'stav_visit', 'Stāvvietas'], ['sniegs', 'sniegs_visit', 'Sniega tīrīšana']];

export async function dashboard(db) {
  const t = today(), wk = monday(t), m0 = t.slice(0, 7) + '-01', from = addDays(wk, -49), t7 = addDays(t, 7);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(from, i * 7));
  const trend = weeks.map(w => ({ wk: w, n: {} }));
  const bump = (app, d) => { if (!d || d < from || d > t) return; const i = Math.floor((Date.parse(d) - Date.parse(from)) / 6048e5); if (trend[i]) trend[i].n[app] = (trend[i].n[app] || 0) + 1; };
  const apps = [], late = [];

  for (const [app, tbl, name] of VIS) {
    const R = await all(db, `SELECT datums, statuss, adrese FROM ${tbl} WHERE datums >= ? OR statuss = 'plan'`, from < m0 ? from : m0).catch(() => []);
    const a = { app, name, doneW: 0, doneM: 0, today: 0, next7: 0, overdue: 0, cantM: 0 };
    for (const r of R) {
      if (r.statuss === 'done') { if (r.datums >= wk && r.datums <= t) a.doneW++; if (r.datums >= m0 && r.datums <= t) a.doneM++; bump(app, r.datums); }
      else if (r.statuss === 'plan') { if (r.datums < t) { a.overdue++; late.push({ app, adrese: r.adrese, datums: r.datums }); } else if (r.datums === t) a.today++; else if (r.datums <= t7) a.next7++; }
      else if ((r.statuss === 'cant' || r.statuss === 'skip') && r.datums >= m0) a.cantM++;
    }
    apps.push(a);
  }
  // Aizvietošana: jauns/piešķirts = atvērts; nokavēts, ja datums pagājis
  { const a = { app: 'aizv', name: 'Aizvietošana', doneW: 0, doneM: 0, today: 0, next7: 0, overdue: 0, cantM: 0 };
    for (const r of await all(db, "SELECT datums, statuss, adrese FROM jobs WHERE datums >= ? OR statuss IN ('jauns', 'piešķirts')", from < m0 ? from : m0)) {
      if (r.statuss === 'izpildīts') { if (r.datums >= wk && r.datums <= t) a.doneW++; if (r.datums >= m0 && r.datums <= t) a.doneM++; bump('aizv', r.datums); }
      else if (r.statuss === 'jauns' || r.statuss === 'piešķirts') { if (r.datums < t) { a.overdue++; late.push({ app: 'aizv', adrese: r.adrese, datums: r.datums }); } else if (r.datums === t) a.today++; else if (r.datums <= t7) a.next7++; }
      else if (r.statuss === 'nevar izpildīt' && r.datums >= m0) a.cantM++;
    }
    apps.unshift(a); }
  // Izvešana un Kaisāmmateriāls: pieteikumi bez plānota datuma — atvērtie un to vecums
  const open = {};
  for (const [app, sql, doneSt, doneCol, name] of [
    ['izv', 'SELECT datums, statuss, adrese, izpildits AS d FROM izv_task', 'Izpildīts', 'd', 'Izvešana'],
    ['kais', 'SELECT datums, statuss, adrese, piegadats AS d FROM kais_task', 'Piegādāts', 'd', 'Kaisāmmateriāls']]) {
    const a = { app, name, doneW: 0, doneM: 0, today: 0, next7: 0, overdue: 0, cantM: 0 }, o = { n: 0, vecakais: '', virs7: 0 };
    for (const r of await all(db, sql)) {
      if (r.statuss === doneSt) { const d = dmyIso(r[doneCol]); if (d >= wk && d <= t) a.doneW++; if (d >= m0 && d <= t) a.doneM++; bump(app, d); }
      else if (r.statuss === 'Neizpildīts' || r.statuss === 'Gaida piegādi') { const d = dmyIso(r.datums); o.n++; if (d && (!o.vecakais || d < o.vecakais)) o.vecakais = d; if (d && d < addDays(t, -7)) { o.virs7++; late.push({ app, adrese: r.adrese, datums: d }); } }
    }
    a.overdue = o.virs7; open[app] = o; apps.push(a);
  }
  late.sort((x, y) => x.datums.localeCompare(y.datums));
  const dl = await db.prepare('SELECT COUNT(DISTINCT vards) n FROM dl_mark WHERE datums = ?').bind(t).first().catch(() => null);
  const bk = await db.prepare("SELECT v FROM kv WHERE k = 'backup:info'").first().catch(() => null);
  const bh = await db.prepare("SELECT v FROM kv WHERE k = 'health:backup'").first().catch(() => null);
  // Līgumi (D5): beidzas ≤ 60 dienās (vai jau beidzies ≤ 30 d. atpakaļ); ar auto pagarināšanu — pēdējā uzteikuma diena
  const ligumi = [];
  for (const c of await all(db, "SELECT id, name, lig_lidz, lig_auto, lig_uzt FROM clients WHERE aktivs = 1 AND lig_lidz != ''").catch(() => [])) {
    const d = Math.round((Date.parse(c.lig_lidz) - Date.parse(t)) / 864e5); if (d > 60 || d < -30) continue;
    ligumi.push({ id: c.id, name: c.name, lidz: c.lig_lidz, dienas: d, auto: !!c.lig_auto, uzteikt: c.lig_uzt ? addDays(c.lig_lidz, -c.lig_uzt) : '' });
  }
  ligumi.sort((a, b) => a.dienas - b.dienas);
  const persT = await persTerms(db, t).catch(() => []);
  const normas = await normaWarn(db, t).catch(() => []);   // C6: pagājušā nedēļā fakts < 85 % normas
  return { t, wk, m0, apps, ligumi, persT, normas, trend, late: late.slice(0, 25), lateN: late.length, open, dlToday: dl ? dl.n : 0, backup: parse(bk && bk.v), backupHealth: parse(bh && bh.v) };
}
