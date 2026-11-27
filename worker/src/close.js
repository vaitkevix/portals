/* SH | Mēneša slēgšana (D2): pārbaužu saraksts pirms slēgšanas un žurnāls. © VAITKEVIX, SIA */
import { workerHours } from './darbalaiks.js';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
export async function closeLog(db, t) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = 'close:log'").first(); let L = []; try { L = JSON.parse((r && r.v) || '[]'); } catch (e) {}
  L.unshift({ laiks: new Date().toISOString(), t }); await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('close:log', ?)").bind(JSON.stringify(L.slice(0, 100))).run();
}
export async function closeCheck(db, ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis');
  const d0 = ym + '-01', d1 = ym + '-31', checks = [];
  const H = await workerHours(db, d0, d1).catch(() => ({})), bez = Object.values(H).filter(h => h.navBeigu);
  checks.push({ k: 'stop', n: 'Darba laiks: posmi bez STOP', v: bez.reduce((s, h) => s + h.navBeigu, 0), d: bez.slice(0, 8).map(h => h.vards || h.phone).join(', '), app: 'dl' });
  const P = await db.prepare("SELECT v FROM kv WHERE k = 'dl:pending'").first(); let pend = []; try { pend = JSON.parse((P && P.v) || '[]').filter(p => p.tips === 'labot' && String(p.datums).slice(0, 7) === ym); } catch (e) {}
  checks.push({ k: 'pending', n: 'Darba laiks: neapstiprināti labojumi', v: pend.length, d: pend.slice(0, 6).map(p => p.vards).join(', '), app: 'dl' });
  let open = 0; for (const T of ['pl_visit', 'logi_visit', 'darz_visit', 'stav_visit', 'sniegs_visit']) { const r = await db.prepare(`SELECT COUNT(*) n FROM ${T} WHERE statuss = 'plan' AND datums >= ? AND datums <= ?`).bind(d0, d1).first().catch(() => null); open += (r && r.n) || 0; }
  const aj = await db.prepare("SELECT COUNT(*) n FROM jobs WHERE statuss IN ('jauns', 'piešķirts') AND datums >= ? AND datums <= ?").bind(d0, d1).first().catch(() => null);
  checks.push({ k: 'open', n: 'Neizpildīti darbi šajā mēnesī (grafiki + aizvietošana)', v: open + ((aj && aj.n) || 0), d: '', app: '' });
  const cl = await all(db, 'SELECT id, name, cenas FROM clients WHERE aktivs = 1').catch(() => []);
  const subC = new Set((await all(db, 'SELECT DISTINCT client FROM client_sub WHERE summa > 0').catch(() => [])).map(r => r.client));   // ar līgumcenu — nav «bez cenām»
  const noP = cl.filter(c => { if (subC.has(c.id)) return false; try { return !Object.values(JSON.parse(c.cenas || '{}')).some(v => +String(v).replace(',', '.') > 0); } catch (e) { return true; } });
  checks.push({ k: 'cenas', n: 'Klienti bez cenām', v: noP.length, d: noP.slice(0, 6).map(c => c.name).join(', '), app: '' });
  const inv = await all(db, 'SELECT client FROM invoice WHERE ym = ?', ym).catch(() => []), have = new Set(inv.map(r => r.client));
  const noInv = cl.filter(c => !have.has(c.id));
  checks.push({ k: 'rekini', n: 'Klienti bez izrakstīta rēķina', v: noInv.length, d: noInv.slice(0, 6).map(c => c.name).join(', '), app: '' });
  const c = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('close:' + ym).first(); let closed = null; try { closed = c ? JSON.parse(c.v) : null; } catch (e) { closed = c ? {} : null; }
  const lg = await db.prepare("SELECT v FROM kv WHERE k = 'close:log'").first(); let log = []; try { log = JSON.parse((lg && lg.v) || '[]').slice(0, 10); } catch (e) {}
  return { ym, checks, closed, log };
}
