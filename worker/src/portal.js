import { summary as dlSummary, objStates as dlStates } from './darbalaiks.js';
import { backupD1 } from './backup.js';
import { closeCheck, closeLog } from './close.js';
import { SMS_F, smsCfg } from './darbalaiks.js';
import { dashboard } from './dashboard.js';
import { viewLink, viewTokens } from './view.js';
import { clientsData, saveClient, delClient, report, firma, saveFirma, invoiceNo, invoiceIssue, invoices, invoiceSet } from './klienti.js';
import { notify } from './webpush.js';
import { audit, diff, auditList } from './audit.js';
const AN = { portal: 'Portāls', aizv: 'Aizvietošana', izv: 'Izvešana', kais: 'Kaisāmmateriāls', pers: 'Personāls', budz: 'Budžets', pl: 'Pļaušana', logi: 'Logi', sniegs: 'Sniegs', darz: 'Dārzniecība', stav: 'Stāvvietas', dl: 'Darba laiks', ml: 'Mājas lieta' };
/* SH | Portāls — vienota ieeja, pilnvaras un kopsavilkums visām lietotnēm. © VAITKEVIX, SIA */
export const APPS_P = ['aizv', 'izv', 'kais', 'pers', 'budz'];
export const ROLES = {
  portal: ['', 'admin'],
  aizv: ['', 'admin', 'vaditajs', 'skatitajs'],
  izv: ['', 'admin', 'pieteicejs', 'skatitajs'],
  kais: ['', 'admin', 'pieteicejs', 'skatitajs'],
  pers: ['', 'admin', 'vaditajs', 'izpilditajs', 'skatitajs'],   // izpilditajs = apstrādā pieteikumus (personāla speciālists)
  budz: ['', 'admin', 'gatavotājs', 'vadība', 'skatitajs'],
  pl: ['', 'skatitajs', 'admin', 'vaditajs', 'izpilditajs'],
  logi: ['', 'skatitajs', 'admin', 'vaditajs', 'izpilditajs'],
  sniegs: ['', 'skatitajs', 'admin', 'vaditajs', 'izpilditajs'],
  darz: ['', 'skatitajs', 'admin', 'vaditajs', 'izpilditajs'],
  stav: ['', 'skatitajs', 'admin', 'vaditajs', 'izpilditajs'],
  dl: ['', 'skatitajs', 'admin', 'vaditajs'],
  ml: ['', 'skatitajs', 'admin', 'vaditajs']
};
const P_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const pj = (o) => new Response(JSON.stringify(o), { headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, P_CORS) });
async function h(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('portal|' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 40); }
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
export function cleanPerms(p) { const o = {}; for (const k in ROLES) { const v = String((p || {})[k] || ''); if (v && ROLES[k].indexOf(v) > 0) o[k] = v; } return o; }

export async function people(db) { return ((await db.prepare('SELECT * FROM people ORDER BY ord, name').all()).results || []).map(r => ({ name: r.name, pin: r.pin, color: r.color, phone: r.phone || '', email: r.email || '', ord: r.ord, active: !!r.active, perms: parse(r.perms) })); }
export async function personByPin(db, pin) { pin = String(pin || '').trim(); if (!pin) return null; return (await people(db)).find(p => p.active && p.pin === pin) || null; }

/** Pirmā reize: pilnvaras no Aizvietošanas lietotājiem */
export function seedFrom(users) {
  return users.map((u, i) => {
    const a = u.role === 'admin';
    return { name: u.name, pin: u.pin, color: u.color || '', ord: i, active: true,
      perms: cleanPerms({ portal: a ? 'admin' : '', aizv: u.role, izv: a ? 'admin' : 'pieteicejs', kais: a ? 'admin' : 'pieteicejs', pers: a ? 'admin' : 'vaditajs', budz: a ? 'admin' : '' }) };
  });
}
export function peopleStmts(db, list) {
  const st = [db.prepare('DELETE FROM people')];
  list.forEach((p, i) => st.push(db.prepare('INSERT INTO people (name, pin, color, ord, active, perms, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(p.name, String(p.pin), p.color || '', i, p.active === false ? 0 : 1, JSON.stringify(cleanPerms(p.perms)), p.phone || '', p.email || '')));
  return st;
}
/** Aizvietošanas lietotāji = cilvēki ar Aizvietošanas lomu */
export function usersStmts(db, list) {
  const st = [db.prepare('DELETE FROM users')];
  list.filter(p => p.active && p.perms.aizv).forEach((p, i) => st.push(db.prepare('INSERT OR REPLACE INTO users (name, role, pin, color, ord) VALUES (?, ?, ?, ?, ?)').bind(p.name, p.perms.aizv, p.pin, p.color || '', i)));
  return st;
}

/** Ja pilnvaru vēl nav — izveido no Aizvietošanas lietotājiem (vienreiz) */
async function ensureSeed(db) {
  const n = await db.prepare('SELECT COUNT(*) n FROM people').first();
  if (n && n.n) return;
  const us = (await db.prepare('SELECT name, role, pin, color FROM users ORDER BY ord, name').all()).results || [];
  if (!us.length) return;
  await db.batch([...peopleStmts(db, seedFrom(us)), db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('peopleDirty', '1')")]);
}
export async function session(env, t) {
  if (!t) return null;
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('sess:' + await h(t)).first();
  const s = r && parse(r.v); if (!s || !(s.name || s.company) || s.exp < Date.now()) return null;
  const me = s.company ? await companyBy(env.DB, 'name', s.company) : ((await people(env.DB)).find(p => p.active && p.name === s.name) || null);
  if (me && s.fp && s.fp !== await fpOf(me)) return null;   // PIN / parole nomainīta → vecā sesija vairs neder
  return me;
}
/** Sesijas nospiedums: hash no PIN vai SIA paroles — mainot tos, sesijas beidzas */
export async function fpOf(me) { return (await h('fp|' + String(me.company ? me.pass : me.pin || ''))).slice(0, 24); }
/** Izvedējs / kurjers (uzņēmums) ienāk ar savu SIA paroli */
export async function companyBy(db, field, v) {
  const c = await db.prepare('SELECT name, kinds, pass FROM companies WHERE active = 1 AND ' + (field === 'pass' ? 'pass' : 'name') + ' = ?').bind(String(v || '').trim().toUpperCase() && field === 'pass' ? String(v).trim().toUpperCase() : v).first();
  if (!c || !c.pass) return null;
  const k = String(c.kinds || '').split(',');
  const DO = { plausejs: 'pl', logu_mazg: 'logi', traktorists: 'sniegs', darznieks: 'darz', stav_mazg: 'stav' };
  if (k.indexOf('izvedejs') === -1 && k.indexOf('kurjers') === -1 && !k.some(x => DO[x])) return null;
  const perms = {};   // darbu izpildītāja pilnvaras pa projektiem
  if (k.indexOf('izvedejs') !== -1) perms.izv = 'izvedejs';
  if (k.indexOf('kurjers') !== -1) perms.kais = 'kurjers';
  k.forEach(x => { if (DO[x]) perms[DO[x]] = 'izpilditajs'; });
  return { name: c.name, company: true, pass: c.pass, color: '', perms };
}
const pub = (p) => p.company ? { name: p.name, company: true, perms: p.perms, admin: false, carrier: { name: p.name, pass: p.pass } }
  : { name: p.name, color: p.color, perms: p.perms, admin: p.perms.portal === 'admin' };

async function dash(env, me) {
  const out = {}, P = me.perms, kv = async (k) => { const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? parse(r.v) : null; };
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }), td = fmt.format(new Date()), tm = fmt.format(new Date(Date.now() + 864e5));
  if (P.aizv) {
    const all = P.aizv === 'admin' || P.aizv === 'skatitajs', mine = all ? '' : ' AND vaditajs = ?', args = all ? [] : [me.name];
    const q = async (d, extra) => (await env.DB.prepare('SELECT COUNT(*) n FROM jobs WHERE datums = ?' + mine + (extra || '')).bind(d, ...args).first()).n;
    out.aizv = { today: await q(td), open: await q(td, " AND statuss NOT IN ('izpildīts')"), tomorrow: await q(tm), unassigned: P.aizv === 'admin' ? await q(tm, " AND brigade = ''") : null };
    const d0 = td.slice(0, 8) + '01', d1 = fmt.format(new Date(Date.now() + 62 * 864e5));
    const rows = (await env.DB.prepare('SELECT datums, COUNT(*) n, SUM(CASE WHEN statuss = \'izpildīts\' THEN 1 ELSE 0 END) d FROM jobs WHERE datums >= ? AND datums <= ?' + mine + ' GROUP BY datums').bind(d0, d1, ...args).all()).results || [];
    out.aizv.days = {}; rows.forEach(r => out.aizv.days[r.datums] = [r.n, r.d]);
    out.aizv.next = ((await env.DB.prepare('SELECT datums, adrese, tips, brigade, statuss FROM jobs WHERE datums >= ? AND statuss != \'izpildīts\'' + mine + ' ORDER BY datums, seq LIMIT 4').bind(td, ...args).all()).results || []);
  }
  if (P.izv) {   // tieši no izv_task (agrāk — 300 KB kv kopija)
    const c = await env.DB.prepare("SELECT COUNT(*) n, SUM(steidzami) u, SUM(CASE WHEN lower(pasutitajs) LIKE ? THEN 1 ELSE 0 END) m FROM izv_task WHERE statuss = 'Neizpildīts'").bind(me.name.toLowerCase() + '%').first();
    const top = (await env.DB.prepare("SELECT adrese a, steidzami u, termins d FROM izv_task WHERE statuss = 'Neizpildīts' ORDER BY steidzami DESC, row LIMIT 3").all()).results || [];
    out.izv = { open: (c && c.n) || 0, urgent: (c && c.u) || 0, mine: P.izv === 'pieteicejs' ? (c && c.m) || 0 : null, top: top.map(x => ({ a: x.a, u: !!x.u, d: x.d || '' })) };
  }
  if (P.kais) {
    const c = await env.DB.prepare("SELECT COUNT(*) n FROM kais_task WHERE statuss NOT IN ('Piegādāts', 'Atcelts')").first();
    const top = (await env.DB.prepare("SELECT adrese a, materials m FROM kais_task WHERE statuss NOT IN ('Piegādāts', 'Atcelts') ORDER BY row LIMIT 3").all()).results || [];
    out.kais = { open: (c && c.n) || 0, top: top.map(x => ({ a: x.a, m: x.m || '' })) };
  }
  if (P.pers) out.pers = {};
  if (P.budz) out.budz = {};
  /* Grafika lietotnes: šodien, izdarīti, nokavēti, steidzami, dienas kalendāram, tuvākie. Cilvēki redz visas (skatīšanās), SIA — tikai pilnvarotās un savus darbus */
  const G = [['pl', 'pl_visit', false], ['logi', 'logi_visit', true], ['sniegs', 'sniegs_visit', true], ['darz', 'darz_visit', true], ['stav', 'stav_visit', true]];
  const d0 = td.slice(0, 8) + '01', d1 = fmt.format(new Date(Date.now() + 62 * 864e5));
  for (const [k, T, hasSt] of G) {
    if (me.company ? !P[k] : false) continue;
    const mine = me.company ? ' AND brigade = ?' : '', ar = me.company ? [me.name] : [];
    try {
      const c = await env.DB.prepare(`SELECT SUM(CASE WHEN datums = ? THEN 1 ELSE 0 END) today, SUM(CASE WHEN datums = ? AND statuss = 'done' THEN 1 ELSE 0 END) done,
        SUM(CASE WHEN datums < ? AND statuss = 'plan' THEN 1 ELSE 0 END) late, SUM(CASE WHEN statuss = 'cant' AND datums >= ? THEN 1 ELSE 0 END) cant,
        ${hasSt ? "SUM(CASE WHEN steidzami = 1 AND statuss = 'plan' THEN 1 ELSE 0 END)" : '0'} urgent FROM ${T} WHERE datums >= ?${mine}`).bind(td, td, td, fmt.format(new Date(Date.now() - 7 * 864e5)), fmt.format(new Date(Date.now() - 120 * 864e5)), ...ar).first();
      const rows = (await env.DB.prepare(`SELECT datums, COUNT(*) n, SUM(CASE WHEN statuss = 'done' THEN 1 ELSE 0 END) d FROM ${T} WHERE datums >= ? AND datums <= ?${mine} GROUP BY datums`).bind(d0, d1, ...ar).all()).results || [];
      const next = (await env.DB.prepare(`SELECT datums, adrese, statuss${hasSt ? ', steidzami' : ''} FROM ${T} WHERE datums >= ? AND statuss = 'plan'${mine} ORDER BY ${hasSt ? 'steidzami DESC, ' : ''}datums LIMIT 3`).bind(td, ...ar).all()).results || [];
      const days = {}; rows.forEach(r => days[r.datums] = [r.n, r.d]);
      out[k] = { today: c.today || 0, done: c.done || 0, late: k === 'sniegs' ? 0 : c.late || 0, cant: c.cant || 0, urgent: c.urgent || 0, days, next };
    } catch (e) { /* tabula vēl nav — izlaiž */ }
  }
  /* Darba laiks: objekti pa adresēm (SMS) — cik pilnībā darbā, kur trūkst */
  if (!me.company && (P.dl || P.portal === 'admin')) { try { const x = await dlSummary(env.DB, td); out.dl = Object.assign({ today: 0, done: 0, late: 0, cant: 0, urgent: 0, days: {}, next: [] }, x); } catch (e) { /* tabulas vēl nav */ } }
  /* Vadītāja panelis: mani objekti šodien (Darba laiks, aizvietošana, grafiki, izvešana, kaisāmmateriāls) */
  if (!me.company) { try { out.mine = await mineToday(env, me, td); } catch (e) { /* tabulas vēl nav */ } }
  return out;
}
async function mineToday(env, me, td) {
  const db = env.DB, all = async (q, ...a) => ((await db.prepare(q).bind(...a).all()).results || []);
  const O = await all('SELECT anorm, adrese FROM objects WHERE vaditajs = ? ORDER BY ord, adrese', me.name);
  if (!O.length) return null;
  const R = {}; O.forEach(o => R[o.anorm] = { a: o.adrese, k: o.anorm, dl: null, aizv: [0, 0], g: {}, izv: 0, kais: 0 });
  const S = await dlStates(db, td).catch(() => null);
  if (S) O.forEach(o => { const x = S.map[o.anorm]; if (x) R[o.anorm].dl = { u: x.uzk.statuss, s: x.set.statuss, t: x.trukst && S.darbaDiena }; });
  (await all("SELECT anorm, COUNT(*) n, SUM(CASE WHEN statuss != 'izpildīts' THEN 1 ELSE 0 END) o FROM jobs WHERE datums = ? GROUP BY anorm", td).catch(() => [])).forEach(r => { if (R[r.anorm]) R[r.anorm].aizv = [r.n, r.o]; });
  for (const [k, T] of [['pl', 'pl_visit'], ['logi', 'logi_visit'], ['sniegs', 'sniegs_visit'], ['darz', 'darz_visit'], ['stav', 'stav_visit']])
    (await all(`SELECT anorm, COUNT(*) n, SUM(CASE WHEN statuss = 'done' THEN 1 ELSE 0 END) d, SUM(CASE WHEN statuss = 'cant' THEN 1 ELSE 0 END) c FROM ${T} WHERE datums = ? GROUP BY anorm`, td).catch(() => []))
      .forEach(r => { if (R[r.anorm]) R[r.anorm].g[k] = [r.n, r.d, r.c]; });
  const an = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  (await all("SELECT adrese FROM izv_task WHERE statuss = 'Neizpildīts'").catch(() => [])).forEach(x => { const o = R[an(x.adrese)]; if (o) o.izv++; });
  (await all("SELECT adrese FROM kais_task WHERE statuss NOT IN ('Piegādāts', 'Atcelts')").catch(() => [])).forEach(x => { const o = R[an(x.adrese)]; if (o) o.kais++; });
  const list = Object.values(R), issue = (o) => (o.dl && o.dl.t ? 4 : 0) + (o.aizv[1] ? 2 : 0) + Object.values(o.g).reduce((n, g) => n + (g[0] - g[1] ? 1 : 0) + (g[2] ? 2 : 0), 0) + (o.izv || o.kais ? 1 : 0);
  list.forEach(o => o.i = issue(o)); list.sort((a, b) => b.i - a.i || a.a.localeCompare(b.a, 'lv'));
  return { n: list.length, problem: list.filter(o => o.i).length, trukst: list.filter(o => o.dl && o.dl.t).length, darbi: list.reduce((n, o) => n + o.aizv[0] + Object.values(o.g).reduce((m, g) => m + g[0], 0), 0), list };
}

export async function portal(request, env, ctx, hooks) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: P_CORS });
  if (request.method !== 'POST') return pj({ ok: true, app: 'SH | Portāls' });
  const b = parse(await request.text()), a = String(b.action || '');
  try {
    if (a === 'login' || a === 'check') await ensureSeed(env.DB);
    if (a === 'lists') return pj(Object.assign({ ok: true }, await hooks.lists()));
    if (a === 'login') {
      const me = await personByPin(env.DB, b.pin) || await companyBy(env.DB, 'pass', b.pin);
      if (!me) { await new Promise(r => setTimeout(r, 700)); return pj({ ok: false, error: 'Nepareizs PIN vai parole' }); }
      const t = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('sess:' + await h(t), JSON.stringify(Object.assign(me.company ? { company: me.name } : { name: me.name }, { fp: await fpOf(me), exp: Date.now() + 30 * 864e5 }))).run();
      return pj({ ok: true, token: t, me: pub(me), dash: await dash(env, me) });
    }
    if (a === 'check') {   // Personāls / Budžets pārbauda vienoto PIN
      const me = await personByPin(env.DB, b.pin), app = String(b.app || '');
      if (!me) return pj({ ok: true, known: false });
      const r = me.perms[app] || '';
      return pj({ ok: true, known: true, name: me.name, role: r === 'skatitajs' ? 'admin' : r, viewer: r === 'skatitajs' });   // skatītājs: redz visu, saglabāt neļauj Worker (pers/budz)
    }
    const me = await session(env, b.t);
    if (!me) return pj({ ok: false, error: 'SESIJA', code: 'auth' });
    if (a === 'me') return pj({ ok: true, me: pub(me), dash: await dash(env, me) });
    /* Push paziņojumi šai ierīcei (Web Push) */
    if (a === 'pushKey') return pj({ ok: true, key: env.VAPID_PUBLIC || '', on: !!env.VAPID_PRIVATE });
    if (a === 'pushSub') {
      const sb = b.sub || {}, k = sb.keys || {};
      if (!/^https:\/\//.test(String(sb.endpoint || '')) || !k.p256dh || !k.auth) throw new Error('Nederīgs abonements');
      await env.DB.prepare('INSERT INTO push_subs (endpoint, name, p256dh, auth, device, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET name = excluded.name, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device')
        .bind(String(sb.endpoint).slice(0, 800), me.name, String(k.p256dh).slice(0, 200), String(k.auth).slice(0, 100), String(b.device || '').slice(0, 120), new Date().toISOString()).run();
      return pj({ ok: true });
    }
    if (a === 'pushOff') { await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND name = ?').bind(String(b.endpoint || ''), me.name).run(); return pj({ ok: true }); }
    if (a === 'pushTest') return pj({ ok: true, sent: await notify(env, [me.name], { title: 'SH | Portāls', body: 'Paziņojumi strādā ✓', url: '/sh/' }) });
    if (a === 'logout') { await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('sess:' + await h(b.t)).run(); return pj({ ok: true }); }
    if (me.perms.portal !== 'admin') return pj({ ok: false, error: 'Tikai administratoram' });
    if (a === 'people') return pj({ ok: true, people: await people(env.DB), roles: ROLES });
    if (a === 'save') {
      const list = await people(env.DB), p = b.person || {};
      const name = String(p.name || '').replace(/\s+/g, ' ').trim(), pin = String(p.pin || '').trim(), old = String(p.oldName || '');
      if (!name) return pj({ ok: false, error: 'Ierakstiet vārdu' });
      if (!/^[0-9A-Za-z]{4,12}$/.test(pin)) return pj({ ok: false, error: 'PIN — 4 līdz 12 cipari vai burti' });
      if (list.some(x => x.name !== old && x.name.toLowerCase() === name.toLowerCase())) return pj({ ok: false, error: 'Šāds vārds jau ir' });
      if (list.some(x => x.name !== old && x.pin === pin)) return pj({ ok: false, error: 'Šāds PIN jau ir citam — izvēlieties citu' });
      if (await env.DB.prepare('SELECT 1 FROM companies WHERE UPPER(pass) = UPPER(?) AND pass != \'\'').bind(pin).first()) return pj({ ok: false, error: 'Šāds PIN sakrīt ar kāda uzņēmuma paroli — izvēlieties citu' });
      const rec = { name, pin, color: String(p.color || '').slice(0, 20), phone: String(p.phone || '').trim().slice(0, 40), email: String(p.email || '').trim().slice(0, 120), active: p.active !== false, perms: cleanPerms(p.perms) };
      if (old === me.name && rec.perms.portal !== 'admin') return pj({ ok: false, error: 'Sev administratora tiesības noņemt nevar' });
      const i = list.findIndex(x => x.name === old), prev = i >= 0 ? JSON.parse(JSON.stringify(list[i])) : null;
      if (i >= 0) list[i] = Object.assign(list[i], rec); else list.push(rec);
      await hooks.saved(list);
      { const flat = (p) => p && Object.assign({ name: p.name, color: p.color, phone: p.phone, email: p.email, active: p.active ? 'jā' : 'nē', pin: p.pin }, Object.fromEntries(Object.keys(ROLES).map(k => ['Tiesības: ' + (AN[k] || k), (p.perms || {})[k] || ''])));
        const F = ['name', 'phone', 'email', 'active', 'color', 'pin'].concat(Object.keys(ROLES).map(k => 'Tiesības: ' + (AN[k] || k)));
        await audit(env.DB, me.name, 'Cilvēki', name, prev ? diff(flat(prev), flat(rec), F, ['pin']) : [['izveidots', '', name]]); }
      return pj({ ok: true, people: await people(env.DB) });
    }
    if (a === 'del') {
      if (b.name === me.name) return pj({ ok: false, error: 'Sevi dzēst nevar' });
      const list = (await people(env.DB)).filter(x => x.name !== b.name);
      await hooks.saved(list);
      await audit(env.DB, me.name, 'Cilvēki', String(b.name || ''), ['dzēsts', String(b.name || ''), '']);
      return pj({ ok: true, people: await people(env.DB) });
    }
    /* Klienti un izpildes akti */
    if (a === 'clients') return pj(Object.assign({ ok: true }, await clientsData(env.DB)));
    if (a === 'saveClient') { await saveClient(env.DB, b.client || {}, me.name); return pj(Object.assign({ ok: true }, await clientsData(env.DB))); }
    if (a === 'delClient') { await delClient(env.DB, String(b.id || ''), me.name); return pj(Object.assign({ ok: true }, await clientsData(env.DB))); }
    if (a === 'firma') return pj(Object.assign({ ok: true }, { firma: await firma(env.DB) }));
    if (a === 'firmaSave') return pj({ ok: true, firma: await saveFirma(env.DB, b.firma, me.name) });
    if (a === 'invoiceNo') return pj(Object.assign({ ok: true }, await invoiceNo(env.DB, String(b.client || ''), String(b.ym || ''))));
    /* Mēneša slēgšana (D2): pārbaudes → slēgt; slēgtā mēnesī Worker atraida darbu/atzīmju izmaiņas */
    if (a === 'closeCheck') return pj(Object.assign({ ok: true }, await closeCheck(env.DB, String(b.ym || ''))));
    if (a === 'closeMonth') { const ym = String(b.ym || ''); if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('Nederīgs mēnesis');
      if (ym >= new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }).format(new Date()).slice(0, 7)) throw new Error('Slēgt var tikai pagājušu mēnesi');
      await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('close:' + ym, JSON.stringify({ kas: me.name, laiks: new Date().toISOString() })).run();
      await closeLog(env.DB, me.name + ' slēdza ' + ym); await audit(env.DB, me.name, 'Slēgšana', ym, ['statuss', 'atvērts', 'slēgts']); return pj(Object.assign({ ok: true }, await closeCheck(env.DB, ym))); }
    if (a === 'openMonth') { const ym = String(b.ym || ''); await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('close:' + ym).run(); await closeLog(env.DB, me.name + ' atvēra ' + ym + (b.iemesls ? ' — ' + String(b.iemesls).slice(0, 120) : '')); await audit(env.DB, me.name, 'Slēgšana', ym, ['statuss', 'slēgts', 'atvērts' + (b.iemesls ? ' — ' + String(b.iemesls).slice(0, 120) : '')]);
      return pj(Object.assign({ ok: true }, await closeCheck(env.DB, ym))); }
    if (a === 'invoiceIssue') { return pj({ ok: true, invoice: await invoiceIssue(env.DB, String(b.client || ''), String(b.ym || ''), me.name) }); }
    if (a === 'invoices') return pj(Object.assign({ ok: true }, await invoices(env.DB, { st: String(b.st || '') })));
    if (a === 'invoiceSet') return pj({ ok: true, invoice: await invoiceSet(env.DB, b, me.name) });
    if (a === 'clientReport') return pj(Object.assign({ ok: true }, await report(env.DB, String(b.client || ''), String(b.ym || ''))));
    if (a === 'viewLink') return pj(Object.assign({ ok: true }, await viewLink(env.DB, String(b.client || ''), !!b.revoke)));
    if (a === 'viewTokens') return pj({ ok: true, tokens: await viewTokens(env.DB) });
    /* SMS funkcijas — ieslēgt / izslēgt */
    if (a === 'smsCfg') { const c = await smsCfg(env.DB), m0 = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }).format(new Date()).slice(0, 8) + '01';
      const st = (await env.DB.prepare('SELECT virziens, COUNT(*) n FROM dl_sms WHERE laiks >= ? GROUP BY virziens').bind(m0).all().catch(() => ({ results: [] }))).results || [];
      const ping = await env.DB.prepare("SELECT v FROM kv WHERE k = 'dl:ping'").first().catch(() => null), dc = await env.DB.prepare("SELECT v FROM kv WHERE k = 'dl:cfg'").first().catch(() => null);
      return pj({ ok: true, list: SMS_F.map(([k, n, d]) => ({ k, n, d, on: c[k] })), stats: Object.fromEntries(st.map(r => [r.virziens, r.n])), ping: parse(ping && ping.v), varteja: !!(env.SMS_USER && env.SMS_PASS), laiki: parse(dc && dc.v) }); }
    if (a === 'smsCfgSave') { const cur = await smsCfg(env.DB), was = Object.assign({}, cur), inn = b.cfg || {}; SMS_F.forEach(([k]) => { if (typeof inn[k] === 'boolean') cur[k] = inn[k]; });
      await audit(env.DB, me.name, 'SMS', 'SMS funkcijas', SMS_F.filter(([k]) => was[k] !== cur[k]).map(([k, n]) => [n, was[k] ? 'ieslēgts' : 'izslēgts', cur[k] ? 'ieslēgts' : 'izslēgts']));
      await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('sms:cfg', ?)").bind(JSON.stringify(cur)).run(); return pj({ ok: true, cfg: cur }); }
    if (a === 'audit') return pj(Object.assign({ ok: true }, await auditList(env.DB, { modulis: b.modulis, kas: b.kas, q: b.q })));
    if (a === 'dashboard') return pj(Object.assign({ ok: true }, await dashboard(env.DB)));
    /* D1 rezerves kopija (R2 backup/) */
    if (a === 'backupInfo') { const g = async (k) => { const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? parse(r.v) : null; }; return pj({ ok: true, info: await g('backup:info'), health: await g('health:backup') }); }
    if (a === 'backupNow') return pj({ ok: true, info: await backupD1(env, true) });
    if (hooks.admin) { const r = await hooks.admin(a, b, me); if (r) return pj(r); }
    return pj({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return pj({ ok: false, error: String(e && e.message || e) }); }
}

/** Cron 1× dienā: izdzēš beigušās sesijas un vecos PIN mēģinājumu skaitītājus (rl:) */
export async function cleanSessions(db) {
  const now = Date.now(), del = [];
  for (const r of (await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'sess:%' OR k LIKE 'rl:%'").all()).results || []) {
    const v = parse(r.v) || {};
    if (r.k.startsWith('sess:') ? !(v.exp > now) : !(now - (v.t || 0) < 864e5)) del.push(db.prepare('DELETE FROM kv WHERE k = ?').bind(r.k));
  }
  for (let i = 0; i < del.length; i += 90) await db.batch(del.slice(i, i + 90));
  return del.length;
}
