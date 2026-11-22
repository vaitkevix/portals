// SH | Personāls — bez Apps Script: pieņemšana darbā un atvaļinājumi D1 (pers_hire, pers_vac), e-pasts caur Cloudflare (mail.js). © VAITKEVIX, SIA
// Ieslēdz kv «pers:native» = '1' (pēc imports()). Darbības un atbildes — tādas pašas kā vecajam GAS doPost (lietotne nemainās).
// Google kalendārs (CALENDAR_ID) vairs netiek lietots — lietotnes kalendārs lasa D1.
import * as G from './sheets.js';
import * as M from './mail.js';
import { personByPin, people } from './portal.js';
import { master, publicLists } from './master.js';

const TAB = { hire: 'Personāls · Pieņemšana', vac: 'Personāls · Atvaļinājumi', users: '⚙ Personāls Lietotāji', lists: '⚙ Personāls Saraksti', set: '⚙ Personāls Iestatījumi' };
const HIRE_HEADERS = ['ID', 'Iesniegts', 'Iesniedza', 'Vārds, Uzvārds', 'Personas kods', 'Deklarētā adrese', 'Telefons', 'E-pasts', 'Invaliditāte', 'Pensionārs', 'Veselības pārbaude',
  'SIA', 'Objekts', 'Amats', 'Sāk strādāt', 'Alga (EUR)', 'Banka', 'IBAN', 'Piezīmes', 'Statuss', 'Admina komentārs', 'Kalendāra notikums', 'Begin Time'];
const HIRE_COLS = ['id', 'iesniegts', 'iesniedza', 'vards', 'pk', 'adrese', 'tel', 'epasts', 'inval', 'pens', 'vesel', 'sia', 'objekts', 'amats', 'sakums', 'alga', 'banka', 'iban',
  'piezimes', 'statuss', 'komentars', 'kal', 'begin_time'];
const VAC_HEADERS = ['ID', 'Iesniegts', 'Iesniedza', 'Darbinieks', 'SIA', 'Objekts', 'Amats', 'Veids', 'No', 'Līdz', 'Kalendārās dienas', 'Darba dienas', 'Aizvietotājs',
  'Piezīmes', 'Statuss', 'Admina komentārs', 'Kalendāra notikums'];
const VAC_COLS = ['id', 'iesniegts', 'iesniedza', 'darbinieks', 'sia', 'objekts', 'amats', 'veids', 'no', 'lidz', 'kal_dienas', 'darba_dienas', 'aizv', 'piezimes', 'statuss', 'komentars', 'kal'];
const BEGIN_TIME = ['Kodu kalkulators', 'Aplikācija viedtālrunī'];
const STATUSES = ['Jauns', 'Apstrādē', 'Apstiprināts', 'Noraidīts'];
const INVAL = ['NĒ', '1. grupa', '2. grupa', '3. grupa'];
const OBJ_SEP = '; ', AM_SEP = ' — ';
const READS = ['login', 'records', 'calendar', 'days'], WRITES = ['hire', 'vacation', 'status'];

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const kvSet = (db, k, v) => db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, v);
const kvJson = async (db, k, def) => { try { return JSON.parse((await kvGet(db, k)) || '') || def; } catch (e) { return def; } };
export const isNative = async (env) => (await kvGet(env.DB, 'pers:native')) === '1';

/* ---------- objekti: "Turaidas 10 — Apkopēja, Sētnieks — 600 EUR; ..." (tāpat kā GAS) ---------- */
const splitObj = (v) => String(v || '').split(';').map(s => s.trim()).filter(Boolean);
function objPair(entry) {
  const parts = String(entry).split('—').map(x => x.trim());
  const name = parts.shift() || '';
  let alga = null;
  const last = parts[parts.length - 1];
  if (last && /^\d+([.,]\d+)?\s*(EUR|€)?$/i.test(last)) { alga = Number(last.replace(/[^\d.,]/g, '').replace(',', '.')); parts.pop(); }
  const amati = (parts[0] || '').split(',').map(a => a.trim()).filter(Boolean);
  return { name, amati, alga };
}
const objNames = (v) => splitObj(v).map(e => objPair(e).name).filter(Boolean);
function objAmati(v) { const out = []; splitObj(v).forEach(e => objPair(e).amati.forEach(a => { if (out.indexOf(a) < 0) out.push(a); })); return out; }
function objEntry(o, withAlga) {
  let s = o.name;
  if (o.amati.length) s += AM_SEP + o.amati.join(', ');
  if (withAlga && o.alga != null) s += AM_SEP + String(o.alga).replace('.', ',') + ' EUR';
  return s;
}
const noAlga = (v) => splitObj(v).map(e => objEntry(objPair(e), false)).join(OBJ_SEP);
const objAlgaSum = (v) => Math.round(splitObj(v).reduce((s, e) => s + (objPair(e).alga || 0), 0) * 100) / 100;
const eur = (n) => (Math.round(n * 100) / 100).toString().replace('.', ',') + ' EUR';
function parseObj(v, hire) {
  const byName = {}, order = [];
  splitObj(v).forEach(e => {
    const p = objPair(e), name = p.name.replace(/[;—]/g, ',').trim();
    if (!name) return;
    const k = name.toLowerCase();
    if (!byName[k]) { byName[k] = { name, amati: [], alga: null }; order.push(k); }
    p.amati.forEach(a => { a = a.replace(/[;—,]/g, ' ').trim(); if (a && byName[k].amati.indexOf(a) < 0) byName[k].amati.push(a); });
    if (p.alga != null) byName[k].alga = (byName[k].alga || 0) + p.alga;
  });
  if (!order.length) throw new Error('Pievienojiet vismaz vienu objektu.');
  if (hire) {
    const noAm = order.filter(k => !byName[k].amati.length).map(k => byName[k].name);
    if (noAm.length) throw new Error('Izvēlieties amatu objektam: ' + noAm.join(', '));
    const noA = order.filter(k => !(byName[k].alga > 0)).map(k => byName[k].name);
    if (noA.length) throw new Error('Norādiet algu objektam: ' + noA.join(', '));
  }
  return order.map(k => objEntry(byName[k], hire)).join(OBJ_SEP);
}

/* ---------- datumi (UTC «kalendāra» datumi; laiks — Rīga) ---------- */
const p2 = (n) => ('0' + n).slice(-2);
const dmy = (d) => p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
const dm = (d) => p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1);
const iso = (d) => d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
function stamp() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return p.day + '.' + p.month + '.' + p.year + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
}
function parseDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Nepareizs datums.');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function toDate(v) { const m = String(v || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; }
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

/* ---------- validācija ---------- */
function normPK(pk) {
  const d = String(pk || '').replace(/\D/g, '');
  if (d.length !== 11) throw new Error('Personas kodam jābūt 11 cipariem (piem. 010190-12345).');
  if (!d.startsWith('32')) {   // vecā formāta kodiem pārbauda kontrolciparu
    const w = [1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    let s = 0;
    for (let i = 0; i < 10; i++) s += +d[i] * w[i];
    if ((1101 - s) % 11 !== +d[10]) throw new Error('Personas kods nav derīgs — pārbaudiet ciparus.');
  }
  return d.slice(0, 6) + '-' + d.slice(6);
}
function normIBAN(v) {
  const s = String(v || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) throw new Error('Nepareizs IBAN formāts.');
  if (s.startsWith('LV') && s.length !== 21) throw new Error('Latvijas IBAN jābūt 21 simbolam (LV00XXXX0000000000000).');
  const r = s.slice(4) + s.slice(0, 4);
  let m = 0;
  for (const ch of r) { const part = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch; for (const dg of part) m = (m * 10 + +dg) % 97; }
  if (m !== 1) throw new Error('IBAN kontrolsumma nesakrīt — pārbaudiet numuru.');
  return s;
}
function normPhone(kods, nr) {
  const k = (String(kods || '').match(/\+\d{1,4}/) || [''])[0];
  if (!k) throw new Error('Izvēlieties valsts kodu.');
  let n = String(nr || '').replace(/[\s\-()]/g, '');
  if (n.startsWith(k)) n = n.slice(k.length);
  else if (n.startsWith('00' + k.slice(1))) n = n.slice(k.length + 1);
  if (!/^\d{6,12}$/.test(n)) throw new Error('Nepareizs telefona numurs.');
  if (k === '+371' && n.length !== 8) throw new Error('Latvijas numuram jābūt 8 cipariem.');
  return k + ' ' + n;
}

/* ---------- Latvijas svētku dienas un darba dienas ---------- */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const HOL = {};
export function lvHolidays(y) {
  if (HOL[y]) return HOL[y];
  const set = new Set();
  [[1, 1], [5, 1], [6, 23], [6, 24], [12, 24], [12, 25], [12, 26], [12, 31]].forEach(([m, d]) => set.add(iso(new Date(Date.UTC(y, m - 1, d)))));
  [[5, 4], [11, 18]].forEach(([m, d]) => {   // 4. maijs un 18. novembris — ja brīvdienā, pārceļ uz pirmdienu
    let dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCDay() === 6) dt = addDays(dt, 2); else if (dt.getUTCDay() === 0) dt = addDays(dt, 1);
    set.add(iso(dt));
  });
  const e = easter(y);
  set.add(iso(addDays(e, -2))); set.add(iso(addDays(e, 1)));   // Lielā Piektdiena, Otrās Lieldienas
  return (HOL[y] = set);
}
export function countDays(from, to) {
  let cal = 0, work = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    cal++;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !lvHolidays(d.getUTCFullYear()).has(iso(d))) work++;
  }
  return { cal, work };
}

/* ---------- iestatījumi un lietotāji ---------- */
const settings = (db) => kvJson(db, 'pers:set', {});
const yes = (S, key, def) => { const v = (String(S[key] || '').trim() || def).toUpperCase(); return v === 'JĀ' || v === 'JA' || v === 'YES'; };

/** PIN → { name, role } (portāla pilnvaras perms.pers; ja PIN portālā nav — vecā lapa «Lietotāji», kv pers:users) */
async function pinUser(db, pin, login) {
  pin = String(pin || '').trim(); login = String(login || '').trim().toLowerCase();
  if (!pin) return null;
  const p = await personByPin(db, pin);
  if (p) { const r = (p.perms && p.perms.pers) || ''; return r ? { name: p.name, role: (r === 'admin' || r === 'skatitajs') ? 'admin' : 'vaditajs', viewer: r === 'skatitajs' } : null; }
  const rows = await kvJson(db, 'pers:users', []);
  const u = rows.find(r => String(r[0] || '').trim() && String(r[1] || '').trim() === pin && String(r[3] || '').trim().toUpperCase() !== 'NĒ' &&
    (!login || String(r[0]).trim().toLowerCase() === login));
  return u ? { name: String(u[0]).trim(), role: String(u[2] || '').trim().toLowerCase() === 'admin' ? 'admin' : 'vaditajs' } : null;
}
async function userEmail(db, name) {
  const n = String(name || '').trim().toLowerCase();
  const p = (await people(db)).find(x => x.name.trim().toLowerCase() === n && M.valid(x.email));
  if (p) return p.email.trim();
  const u = (await kvJson(db, 'pers:users', [])).find(r => String(r[0] || '').trim().toLowerCase() === n);
  return u && /@/.test(u[4] || '') ? String(u[4]).trim() : '';
}

/* ---------- ieraksti ---------- */
const rowsOf = (db, t) => all(db, 'SELECT * FROM ' + (t === 'hire' ? 'pers_hire' : 'pers_vac') + ' ORDER BY row');
const numOr = (v) => /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v;
async function nextId(db, prefix) {
  const tbl = prefix === 'P' ? 'pers_hire' : 'pers_vac';
  let n = Number(await kvGet(db, 'pers:seq:' + prefix) || 0);
  (await all(db, 'SELECT id FROM ' + tbl)).forEach(r => { const m = /^[A-Z]+-(\d+)$/.exec(r.id); if (m && +m[1] > n) n = +m[1]; });
  n++;
  await kvSet(db, 'pers:seq:' + prefix, String(n)).run();
  return prefix + '-' + String(n).padStart(4, '0');
}
async function insert(db, tbl, cols, vals) {
  const mx = await db.prepare('SELECT MAX(row) m FROM ' + tbl).first();
  const c = ['row', ...cols];
  await db.prepare('INSERT INTO ' + tbl + ' (' + c.join(', ') + ') VALUES (' + c.map(() => '?').join(',') + ')').bind(((mx && mx.m) || 1) + 1, ...vals).run();
}

async function masterLists(db) { try { return publicLists(await master(db)); } catch (e) { return null; } }

async function getInit(db, user) {
  const lv = await kvJson(db, 'pers:lists', {});
  const ML = await masterLists(db);
  const MK = { 'SIA': 'sia', 'Banka': 'bankas', 'Atvaļinājuma veids': 'veidi', 'Amats': 'amati', 'Tālruņa kods': 'kodi', 'Objekts': 'objekti' };
  const colVals = (name) => (ML && MK[name] && (ML[MK[name]] || []).length) ? ML[MK[name]].slice() : (lv[name] || []).map(s => String(s || '').trim()).filter(Boolean);
  const employees = {}, objekti = new Set(colVals('Objekts'));
  (await rowsOf(db, 'hire')).forEach(r => {
    if (r.statuss === 'Noraidīts' || !r.vards) return;
    employees[r.vards.toLowerCase()] = { name: r.vards, sia: r.sia, objekts: noAlga(r.objekts), amats: r.amats };
    objNames(r.objekts).forEach(o => objekti.add(o));
  });
  (await rowsOf(db, 'vac')).forEach(r => {
    const name = r.darbinieks;
    if (name && !employees[name.toLowerCase()]) employees[name.toLowerCase()] = { name, sia: r.sia, objekts: r.objekts, amats: r.amats };
    objNames(r.objekts).forEach(o => objekti.add(o));
  });
  return {
    user, statuses: STATUSES, inval: INVAL,
    lists: { sia: colVals('SIA'), bankas: colVals('Banka'), veidi: colVals('Atvaļinājuma veids'), amati: colVals('Amats'), kodi: colVals('Tālruņa kods'),
      objekti: [...objekti].sort((a, b) => a.localeCompare(b, 'lv')) },
    employees: Object.values(employees).sort((a, b) => a.name.localeCompare(b.name, 'lv'))
  };
}

const need = (f) => (k, label) => { const v = String(f[k] || '').trim(); if (!v) throw new Error('Aizpildiet lauku: ' + label); return v; };

async function submitHire(env, user, f) {
  const db = env.DB, req = need(f);
  const vards = req('vards', 'Vārds, Uzvārds');
  const pk = normPK(req('pk', 'Personas kods'));
  const adrese = req('adrese', 'Deklarētā adrese');
  const tel = normPhone(f.telKods, req('tel', 'Telefona numurs'));
  const epasts = String(f.epasts || '').trim();
  if (epasts && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epasts)) throw new Error('Nepareiza e-pasta adrese.');
  const inval = INVAL.indexOf(f.inval) >= 0 ? f.inval : 'NĒ';
  const pens = f.pens === 'JĀ' ? 'JĀ' : 'NĒ';
  const vesel = f.vesel === 'IR' ? 'IR' : 'NAV';
  const bt = BEGIN_TIME.indexOf(f.begintime) >= 0 ? f.begintime : '';
  if (!bt) throw new Error('Izvēlieties Begin Time: kodu kalkulators vai aplikācija viedtālrunī.');
  const sia = req('sia', 'SIA');
  const objekts = parseObj(f.objekts, true);
  const amats = objAmati(objekts).join(', ');
  const sakums = parseDate(req('sakums', 'Datums, ar kuru sāk strādāt'));
  const alga = objAlgaSum(objekts);
  const banka = req('banka', 'Banka');
  const iban = normIBAN(req('iban', 'IBAN'));
  const piez = String(f.piezimes || '').trim();

  const dup = (await all(db, "SELECT id, sakums FROM pers_hire WHERE pk = ? AND statuss != 'Noraidīts'", pk)).find(r => { const d = toDate(r.sakums); return d && d.getTime() === sakums.getTime(); });
  if (dup) throw new Error('Šis darbinieks ar šo datumu jau ir pieteikts (' + dup.id + ').');
  const id = await nextId(db, 'P');
  await insert(db, 'pers_hire', HIRE_COLS, [id, stamp(), user.name, vards, pk, adrese, tel, epasts, inval, pens, vesel, sia, objekts, amats, dmy(sakums), String(alga), banka, iban, piez, 'Jauns', '', '', bt]);

  const mailErr = await mailHire(env, { id, by: user.name, vards, pk, adrese, tel, epasts, inval, pens, vesel, sia, objekts, amats, sakums: dmy(sakums), alga, banka, iban, piez, bt });
  if (mailErr) await db.prepare('UPDATE pers_hire SET mail_err = ? WHERE id = ?').bind(mailErr, id).run();
  return { id, mailErr };
}

function previewDays(no, lidz) { const a = parseDate(no), b = parseDate(lidz); return b < a ? null : countDays(a, b); }

async function submitVacation(env, user, f) {
  const db = env.DB, req = need(f);
  const darb = req('darbinieks', 'Darbinieks');
  const sia = req('sia', 'SIA');
  const objekts = parseObj(f.objekts, false);
  const myObj = objNames(objekts).map(o => o.toLowerCase());
  const amats = objAmati(objekts).join(', ');
  const veids = req('veids', 'Atvaļinājuma veids');
  const no = parseDate(req('no', 'No'));
  const lidz = parseDate(req('lidz', 'Līdz'));
  if (lidz < no) throw new Error('Datums "Līdz" nevar būt agrāks par "No".');
  const aizv = String(f.aizvietotajs || '').trim();
  const piez = String(f.piezimes || '').trim();
  const days = countDays(no, lidz);
  const warnings = [];
  (await rowsOf(db, 'vac')).forEach(r => {
    if (r.statuss === 'Noraidīts') return;
    const a = toDate(r.no), b = toDate(r.lidz);
    if (!a || !b || a > lidz || b < no) return;
    const name = String(r.darbinieks), range = dm(a) + '–' + dmy(b);
    if (name.trim().toLowerCase() === darb.toLowerCase()) throw new Error(darb + ' jau ir atvaļinājums šajā periodā (' + range + ', ' + r.id + ').');
    const common = objNames(r.objekts).filter(o => myObj.indexOf(o.toLowerCase()) >= 0);
    if (common.length) warnings.push(name + ' (' + common.join(', ') + ') arī būs atvaļinājumā ' + range);
  });
  const id = await nextId(db, 'A');
  await insert(db, 'pers_vac', VAC_COLS, [id, stamp(), user.name, darb, sia, objekts, amats, veids, dmy(no), dmy(lidz), String(days.cal), String(days.work), aizv, piez, 'Jauns', '', '']);

  const mailErr = await mailVacation(env, { id, by: user.name, darb, sia, objekts, amats, veids, no: dmy(no), lidz: dmy(lidz), cal: days.cal, work: days.work, aizv, piez, warnings });
  if (mailErr) await db.prepare('UPDATE pers_vac SET mail_err = ? WHERE id = ?').bind(mailErr, id).run();
  return { id, days, warnings, mailErr };
}

async function getRecords(db, user, type) {
  const isHire = type === 'hire', headers = isHire ? HIRE_HEADERS : VAC_HEADERS, cols = isHire ? HIRE_COLS : VAC_COLS;
  let rows = (await rowsOf(db, type)).filter(r => r.id);
  if (user.role !== 'admin') rows = rows.filter(r => r.iesniedza === user.name);
  rows.reverse();
  return rows.slice(0, 400).map(r => { const o = {}; headers.forEach((h, i) => o[h] = String(r[cols[i]] == null ? '' : r[cols[i]])); return o; });
}

async function setStatus(env, user, type, id, status, comment) {
  const db = env.DB;
  if (user.role !== 'admin') throw new Error('Statusu var mainīt tikai administrators.');
  if (STATUSES.indexOf(status) < 0) throw new Error('Nezināms statuss.');
  const isHire = type === 'hire', tbl = isHire ? 'pers_hire' : 'pers_vac';
  const row = await db.prepare('SELECT * FROM ' + tbl + ' WHERE id = ?').bind(String(id == null ? '' : id)).first();
  if (!row) throw new Error('Ieraksts nav atrasts.');
  comment = String(comment || '').trim();
  await db.prepare('UPDATE ' + tbl + ' SET statuss = ?, komentars = ? WHERE id = ?').bind(status, comment, row.id).run();
  if (String(row.statuss) !== status && yes(await settings(db), 'ZINOT_VADITAJAM', 'JĀ')) {   // paziņojums darbu vadītājam
    const to = await userEmail(db, row.iesniedza);
    if (to) {
      const err = await mailStatus(env, to, type, row.id, isHire ? row.vards : row.darbinieks, status, comment);
      await db.prepare('UPDATE ' + tbl + ' SET mail_err = ? WHERE id = ?').bind(err ? 'statuss: ' + err : '', row.id).run();
    }
  }
  return true;
}

async function getCalendarRange(db, fromStr, toStr) {
  const from = parseDate(fromStr), to = parseDate(toStr);
  if (to < from) throw new Error('Nepareizs periods.');
  if ((to - from) / 864e5 > 400) throw new Error('Periods par garu.');
  const events = [];
  (await rowsOf(db, 'vac')).forEach(r => {
    const st = r.statuss;
    if (!r.id || st === 'Noraidīts') return;
    const a = toDate(r.no), b = toDate(r.lidz);
    if (!a || !b || a > to || b < from) return;
    events.push({ type: 'vac', id: r.id, name: r.darbinieks, sia: r.sia, objekts: r.objekts, amats: r.amats, veids: r.veids,
      no: iso(a), lidz: iso(b), work: numOr(r.darba_dienas), aizv: r.aizv, status: st, by: r.iesniedza });
  });
  (await rowsOf(db, 'hire')).forEach(r => {
    const st = r.statuss;
    if (!r.id || st === 'Noraidīts') return;
    const d = toDate(r.sakums);
    if (!d || d < from || d > to) return;
    events.push({ type: 'hire', id: r.id, name: r.vards, sia: r.sia, objekts: noAlga(r.objekts), amats: r.amats, no: iso(d), lidz: iso(d), status: st, by: r.iesniedza });
  });
  const holidays = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (lvHolidays(d.getUTCFullYear()).has(iso(d))) holidays.push(iso(d));
  return { events, holidays };
}

/* ---------- e-pasti (tas pats izskats kā GAS sendMail_) ---------- */
function recipients(S, type) {
  const list = [S.ADMIN_EMAIL || '', S[type === 'hire' ? 'EMAIL_PIENEMSANA' : 'EMAIL_ATVALINAJUMI'] || ''].join(',').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => /@/.test(s));
  return [...new Set(list)].join(',');
}
const webAppUrl = (S) => /^https:\/\/\S+$/.test(String(S.WEB_APP_URL || '').trim()) ? String(S.WEB_APP_URL).trim() : 'https://vaitkevix.github.io/personals/';
async function sendMail(env, S, to, subject, heading, sub, sections, note, accent, recId) {
  if (!to) return 'nav norādīts saņēmējs (Iestatījumi → ADMIN_EMAIL)';
  const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const color = accent || '#1f3a5f', base = webAppUrl(S);
  const url = recId ? base + (base.indexOf('?') < 0 ? '?' : '&') + 'id=' + encodeURIComponent(recId) : base;
  let html = '<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;padding:24px 12px">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e3e7ee">' +
    '<div style="background:' + color + ';color:#fff;padding:18px 22px">' +
    '<div style="font-size:12px;letter-spacing:.08em;opacity:.8;text-transform:uppercase">Personāla pieteikumi</div>' +
    '<div style="font-size:20px;font-weight:bold;margin-top:4px">' + e(heading) + '</div>' +
    (sub ? '<div style="font-size:14px;opacity:.9;margin-top:4px">' + e(sub) + '</div>' : '') + '</div>' +
    '<div style="padding:8px 22px 20px">';
  if (note) html += '<div style="background:#fdf3d8;color:#7a5400;border-radius:8px;padding:10px 12px;margin-top:14px;font-size:14px">' + note + '</div>';
  sections.forEach(sec => {
    html += '<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;color:' + color + ';margin:18px 0 6px">' + e(sec.title) + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">';
    sec.rows.filter(r => r[1] !== '' && r[1] != null).forEach(r => {
      html += '<tr><td style="padding:6px 0;color:#667085;width:42%;border-bottom:1px solid #f0f2f5;vertical-align:top">' + e(r[0]) +
        '</td><td style="padding:6px 0;border-bottom:1px solid #f0f2f5;font-weight:bold">' + e(r[1]).replace(/\n/g, '<br>') + '</td></tr>';
    });
    html += '</table>';
  });
  html += '<div style="margin-top:22px">' +
    '<a href="' + url + '" style="display:inline-block;background:' + color + ';color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;font-size:15px">' + (recId ? 'Atvērt pieteikumu' : 'Atvērt lietotni') + ' →</a>' +
    '</div></div></div>' +
    '<div style="text-align:center;font-size:11px;color:#98a2b3;margin-top:12px">Automātisks paziņojums — uz šo e-pastu nav jāatbild · © VAITKEVIX, SIA</div></div>';
  try {
    const r = await M.send(env, { to, subject, html, fromName: 'Personāla pieteikumi' });
    if (r.failed.length) console.warn('pers e-pasts: ' + r.failed.map(x => x.to + ' ' + x.error).join('; '));
    return r.sent.length ? '' : (r.failed.map(x => x.error).join('; ') || 'neizdevās nosūtīt');
  } catch (err) {
    console.warn('pers e-pasts: ' + (err && err.message || err));
    return String(err && err.message || err);
  }
}
async function mailHire(env, d) {
  const S = await settings(env.DB), full = yes(S, 'PILNI_DATI_EPASTA', 'NĒ'), objs = splitObj(d.objekts);
  return sendMail(env, S, recipients(S, 'hire'), 'Pieņemt darbā: ' + d.vards + ' — ' + d.sia + ', sāk ' + d.sakums, 'Pieņemt darbinieku', d.vards + ' · ' + d.id, [
    { title: 'DARBINIEKS', rows: [['Vārds, Uzvārds', d.vards], ['Personas kods', full ? d.pk : ''], ['Deklarētā adrese', full ? d.adrese : ''],
      ['Telefona numurs', d.tel], ['E-pasts', d.epasts], ['Invaliditāte', d.inval], ['Pensionārs', d.pens], ['Veselības pārbaude', d.vesel]] },
    { title: 'DARBS', rows: [['SIA', d.sia], ['Objekti un amati', objs.map(e => objEntry(objPair(e), false)).join('\n')], ['Sāk strādāt', d.sakums], ['Begin Time', d.bt]] },
    { title: 'ATALGOJUMS', rows: [['Alga', objs.length > 1 ? objs.map(e => { const p = objPair(e); return p.name + ': ' + eur(p.alga || 0); }).join('\n') + '\nKopā: ' + eur(d.alga) : eur(d.alga)],
      ['Banka', d.banka], ['IBAN', full ? d.iban : '']] },
    { title: 'PIETEIKUMS', rows: [['Iesniedza', d.by], ['Piezīmes', d.piez]] }
  ], full ? '' : 'Personas kods, adrese un IBAN redzami lietotnē.', '', d.id);
}
async function mailVacation(env, d) {
  const S = await settings(env.DB);
  return sendMail(env, S, recipients(S, 'vac'), 'Atvaļinājums: ' + d.darb + ' ' + d.no + ' – ' + d.lidz, 'Atvaļinājuma pieteikums', d.darb + ' · ' + d.id, [
    { title: 'DARBINIEKS', rows: [['Vārds, Uzvārds', d.darb], ['SIA', d.sia], ['Objekti un amati', splitObj(d.objekts).join('\n')]] },
    { title: 'ATVAĻINĀJUMS', rows: [['Veids', d.veids], ['No', d.no], ['Līdz', d.lidz], ['Ilgums', d.cal + ' kalendārās dienas, ' + d.work + ' darba dienas'], ['Aizvietotājs', d.aizv]] },
    { title: 'PIETEIKUMS', rows: [['Iesniedza', d.by], ['Piezīmes', d.piez]] }
  ], d.warnings.length ? '<b>Uzmanību:</b><br>' + d.warnings.map(w => String(w).replace(/</g, '&lt;')).join('<br>') : '', '#0e5e6f', d.id);
}
async function mailStatus(env, to, type, id, name, status, comment) {
  const colors = { 'Apstiprināts': '#1e7a4a', 'Noraidīts': '#b42318', 'Apstrādē': '#9a6a00', 'Jauns': '#1f3a5f' };
  return sendMail(env, await settings(env.DB), to, (type === 'hire' ? 'Pieņemšana' : 'Atvaļinājums') + ' — ' + name + ': ' + status,
    status, (type === 'hire' ? 'Pieņemšana darbā' : 'Atvaļinājums') + ' · ' + name + ' · ' + id,
    [{ title: 'STATUSS', rows: [['Pieteikums', id], ['Darbinieks', name], ['Jaunais statuss', status], ['Komentārs', comment]] }], '', colors[status], id);
}

/* ---------- /pers {action, pin, login, ...} → {ok, ...} ---------- */
export async function api(env, req) {
  const db = env.DB;
  try {
    const action = String(req.action || '');
    if (READS.indexOf(action) === -1 && WRITES.indexOf(action) === -1) return { ok: false, error: 'Nezināma darbība' };
    const u = await pinUser(db, req.pin, req.login);
    if (!u) { await new Promise(r => setTimeout(r, 600)); return { ok: false, error: 'Nepareizs PIN' }; }
    if (WRITES.indexOf(action) !== -1 && u.viewer) return { ok: false, error: 'Jums ir tikai skatīšanās tiesības' };
    const user = { name: u.name, role: u.role };
    let out;
    if (action === 'login') out = { user, meta: await getInit(db, user) };
    else if (action === 'hire') out = await submitHire(env, user, req.form || {});
    else if (action === 'vacation') out = await submitVacation(env, user, req.form || {});
    else if (action === 'days') out = { days: previewDays(req.no, req.lidz) };
    else if (action === 'records') out = { hire: await getRecords(db, user, 'hire'), vac: await getRecords(db, user, 'vac') };
    else if (action === 'status') { await setStatus(env, user, req.type, req.id, req.status, req.comment); out = {}; }
    else out = await getCalendarRange(db, req.from, req.to);
    return Object.assign({ ok: true }, out || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).replace(/^Error:\s*/, '') };
  }
}

/* ---------- vienreizējs imports no «SH | Dati» + pārslēgšana (kv pers:switch = '1') ---------- */
const DATE_COLS = { hire: { 1: 'dt', 14: 'd' }, vac: { 1: 'dt', 8: 'd', 9: 'd' } };
/** Neformatēta šūna → tas pats teksts, ko deva GAS getRecords (Date → 'dd.MM.yyyy[ HH:mm]', pārējais String(v)) */
function cell(v, kind) {
  if (v == null) return '';
  if (kind && typeof v === 'number') { const s = G.serial(v); return p2(s.d) + '.' + p2(s.m) + '.' + s.y + (kind === 'dt' ? ' ' + p2(s.H) + ':' + p2(s.M) : ''); }
  return String(v);
}
const importTab = async (env, type) => importRows(env, type, await G.readRaw(env, TAB[type], 'A1:' + (type === 'hire' ? 'W' : 'Q')));
/** Lapas rindas (readRaw, ar virsrakstu) → D1; esošos ID nepārraksta */
export async function importRows(env, type, v) {
  const db = env.DB, isHire = type === 'hire', cols = isHire ? HIRE_COLS : VAC_COLS, tbl = isHire ? 'pers_hire' : 'pers_vac';
  const have = new Set((await all(db, 'SELECT id FROM ' + tbl)).map(r => r.id)), st = [];
  v.forEach((r, i) => {
    const id = String(r[0] == null ? '' : r[0]).trim(); if (!i || !id || have.has(id)) return; have.add(id);
    const vals = cols.map((c, k) => k === 0 ? id : cell(r[k], DATE_COLS[type][k]));
    st.push(db.prepare('INSERT OR IGNORE INTO ' + tbl + ' (row, ' + cols.join(', ') + ') VALUES (?,' + cols.map(() => '?').join(',') + ')').bind(i + 1, ...vals));
  });
  for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
  return { lapa: Math.max(0, v.length - 1), ievesti: st.length };
}
export async function imports(env) {
  const db = env.DB;
  const hire = await importTab(env, 'hire'), vac = await importTab(env, 'vac');
  // iestatījumi (A: atslēga, B: vērtība), vecie lietotāji (A–E), saraksti (kolonnas pēc virsraksta) — kā GAS getDisplayValues
  const set = {}; (await G.read(env, TAB.set, 'A1:B')).forEach(r => { const k = String(r[0] || '').trim(); if (k) set[k] = String(r[1] == null ? '' : r[1]).trim(); });
  const users = (await G.read(env, TAB.users, 'A2:E')).map(r => [0, 1, 2, 3, 4].map(i => String(r[i] == null ? '' : r[i]))).filter(r => r[0].trim());
  const lv = await G.read(env, TAB.lists, 'A1:Z'), lists = {};
  (lv[0] || []).forEach((h, i) => { h = String(h || '').trim(); if (h) lists[h] = lv.slice(1).map(r => String(r[i] == null ? '' : r[i]).trim()).filter(Boolean); });
  await db.batch([kvSet(db, 'pers:set', JSON.stringify(set)), kvSet(db, 'pers:users', JSON.stringify(users)), kvSet(db, 'pers:lists', JSON.stringify(lists))]);
  return { hire, vac, iestatijumi: Object.keys(set).length, lietotaji: users.length, saraksti: Object.keys(lists).length };
}
export async function maybeSwitch(env) {
  const db = env.DB;
  if ((await kvGet(db, 'pers:switch')) !== '1' || await isNative(env) || !env.GOOGLE_SA) return;
  const r = await imports(env);
  await db.batch([kvSet(db, 'pers:native', '1'), kvSet(db, 'pers:switch', 'done'), kvSet(db, 'pers:switchLog', new Date().toISOString() + ' ' + JSON.stringify(r))]);
}
