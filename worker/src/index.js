/**
 * SH | Aizvietošana — API uz Cloudflare Workers + D1.
 * Tā pati JSON saskarne kā Apps Script versijai (POST {action, pin, ...} → {ok, ...}).
 * Bildes (Google Drive), AI un push paziņojumi iet caur Apps Script „tiltu” (env.GAS_URL + BRIDGE_KEY).
 * © VAITKEVIX, SIA
 */

import { portal, people, personByPin, seedFrom, peopleStmts, usersStmts, session } from './portal.js';
import { plausana, plCron } from './plausana.js';
import * as logi from './logi.js';
import * as sniegs from './sniegs.js';
import * as darznieciba from './darznieciba.js';
import * as stavvietas from './stavvietas.js';
import * as darbalaiks from './darbalaiks.js';
import { fetchWx, wxCron } from './wx.js';
import { notify as wpNotify } from './webpush.js';
import { cleanAddr } from './util.js';
import * as gsheets from './sheets.js';
import * as ai from './ai.js';
import * as foto from './foto.js';
import * as kais from './kaisammaterials.js';
/** kv «noGoogle» = '1': sistēma strādā tikai Cloudflare — Worker vairs nelasa/neraksta «SH | Dati» (2026-11-22). © VAITKEVIX, SIA */
const noGoogle = async (db) => (await kvGet(db, 'noGoogle')) === '1';
const GS_OPS = new Set(['config', 'people', 'master', 'addObjects', 'importObjects']);
/* Grafika lietotnes — katra savā failā: maršruts /<KEY> → modulis */
const GRAF = { logi, sniegs, darz: darznieciba, stav: stavvietas, dl: darbalaiks };
import { master, importAll as importMaster, legacyPayload, publicLists, objectsStmts, personCanon, companiesStmts, listsStmts, typesStmts, kvGet, kvSet, resolveReview, clearInfoReview, autoMergePrefixed, groupsOf, groupsStmts } from './master.js';
const TZ = 'Europe/Riga';
const PROMBUTNE = ['Atvaļinājums', 'DNL', 'Vakance'];
const STAND_PROMB = ['DNL', 'Vakance'];
const JOB_F = ['id', 'datums', 'adrese', 'tips', 'apraksts', 'vaditajs', 'brigade', 'statuss', 'publicets', 'izpildits', 'izveidots', 'komentars', 'foto', 'iemesls', 'lidz', 'serija', 'prombutne', 'steidzami', 'laiks', 'parbaude', 'parbKom', 'grupa'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

/* ---------------- HTTP ---------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/izv' || url.pathname.endsWith('/izv')) return izv(request, url, env, ctx, 'izv');
    if (url.pathname === '/kais' || url.pathname.endsWith('/kais')) return izv(request, url, env, ctx, 'kais');
    if (url.pathname === '/pers' || url.pathname.endsWith('/pers')) return pers(request, env, ctx);
    if (url.pathname === '/budz' || url.pathname.endsWith('/budz')) return budz(request, env, ctx);
    if (url.pathname === '/pl' || url.pathname.endsWith('/pl')) return plausana(request, env, new Ctx(env, ctx));
    if (url.pathname === '/dl/sms' || url.pathname.endsWith('/dl/sms')) return darbalaiks.hook(request, env, new Ctx(env, ctx), url);   // SMS vārtejas webhook
    { const sk = url.pathname.replace(/^.*\//, ''); if (GRAF[sk] && !url.pathname.startsWith('/sh')) return GRAF[sk].api(request, env, new Ctx(env, ctx), fetchWx); }
    if (url.pathname === '/who' || url.pathname.endsWith('/who')) return who(request, env);
    if (url.pathname === '/portal' || url.pathname.endsWith('/portal')) { const X = new Ctx(env, ctx); return portal(request, env, ctx, { saved: (list) => peopleSaved(X, list), admin: (a, b, me) => masterAdmin(X, a, b, me), lists: async () => publicLists(await master(env.DB)) }); }
    if (url.pathname === '/img' || url.pathname.endsWith('/img')) return img(url, ctx, env);
    // vaitkevix.cloud/shaizvietosana, /shizvesana → lietotnes (GitHub Pages); …/api → šis API
    for (const base in SITES) {
      if (url.pathname === base) return Response.redirect(url.origin + base + '/' + url.search, 301);
      if (url.pathname.startsWith(base + '/') && url.pathname !== base + '/api') {
        // Viena saite: lietotnes atveras tikai portālā (rāmī). Tieša atvēršana → vaitkevix.cloud/sh/
        const rest = url.pathname.slice(base.length);
        if (base !== '/sh' && SITE_KEY[base] && (rest === '/' || rest === '/index.html') && request.headers.get('Sec-Fetch-Dest') === 'document' && !(base === '/shaizvietosana' && url.searchParams.get('k')))
          return Response.redirect(url.origin + '/sh/#' + SITE_KEY[base], 302);
        return site(request, url, base);
      }
    }
    if (request.method === 'GET') return json({ ok: true, app: 'SH | Aizvietošana', time: new Date().toISOString() });
    let req;
    try { req = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, error: 'Nederīgs pieprasījums' }); }
    const X = new Ctx(env, ctx);
    try {
      if (req.action === 'import') return json(Object.assign({ ok: true }, await importAll(X, req)));
      if (req.action === 'syncConfig') { checkKey(env, req.key); return json(Object.assign({ ok: true }, await syncConfig(X))); }
      if (req.action === 'export') return json(Object.assign({ ok: true }, await exportTable(X, req)));
      if (req.action === 'teamView') return json(Object.assign({ ok: true }, await teamView(X, req, await teamOk(X, req))));
      if (/^team(Done|Cant|Problem)$/.test(req.action) && !(await teamOk(X, req))) return json({ ok: false, error: 'Lai atzīmētu, vajag brigādes saiti no vadītāja vai PIN', code: 'teamkey' });
      if (req.action === 'teamDone') return json(Object.assign({ ok: true }, await teamDone(X, req)));
      if (req.action === 'teamCant') return json(Object.assign({ ok: true }, await teamCant(X, req)));
      if (req.action === 'teamProblem') return json(Object.assign({ ok: true }, await teamProblem(X, req)));
      const user = await X.auth(req.pin);
      if (!user) return json({ ok: false, error: 'Nepareizs PIN' });
      const fn = ACTIONS[req.action];
      if (!fn) return json({ ok: false, error: 'Nezināma darbība' });
      return json(Object.assign({ ok: true }, (await fn(X, user, req)) || {}));
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) });
    }
  },

  /** Cron: lietotāji, darbu veidi un objekti no Google tabulas */
  async scheduled(event, env, ctx) {
    if (event.cron !== '*/5 * * * *') ctx.waitUntil(syncConfig(new Ctx(env, ctx)).catch(e => console.error('syncConfig', e)));
    if (event.cron !== '*/5 * * * *') ctx.waitUntil(mirrorSheets(new Ctx(env, ctx)).catch(e => console.error('mirror', e)));
    if (event.cron !== '*/5 * * * *') return;   // :00 un :30 nostrādā abi trigeri — pārējais tikai vienreiz (*/5)
    ctx.waitUntil(izvDrain(env, ctx, 60000).catch(e => console.error('izvDrain', e)));
    ctx.waitUntil(plCron(env).catch(e => console.error('plCron', e)));
    ctx.waitUntil(kais.maybeSwitch(env).then(() => kais.pushSheet(env)).catch(e => console.error('kais', e)));
    ctx.waitUntil((async () => { await wxCron(env).catch(e => console.error('wx', e)); for (const k in GRAF) await GRAF[k].cron(env).catch(e => console.error('cron ' + k, e)); })());
  }
};

/* ---------------- Izvešana un Kaisāmmateriāls: ātrais starpnieks uz Apps Script ----------------
 * Google tabula paliek galvenā (no tās taisa rēķinus). Lasīšana nāk no kešatmiņas D1 (uzreiz), atjaunojas fonā;
 * izmaiņas apstiprina uzreiz un nosūta uz Google fonā (rinda ar atkārtojumiem). POST /izv|/kais?fn=..., ķermenis = argumentu masīvs.
 */
const APPS = {
  izv: { gas: 'IZV_GAS_URL', reads: ['getBoot', 'getTasks', 'getInitialData'], boot: 'getBoot',
    fns: ['getBoot', 'getTasks', 'getInitialData', 'saveTask', 'updateTask', 'setTaskCancelled', 'getAccess', 'checkCarrierPin', 'completeTask', 'reportProblem', 'reportPdf',
      'geocodeAddresses', 'aiParseMessage', 'aiCheckPhoto', 'aiCompare', 'aiAsk', 'aiMonthSummary', 'saveFileToDrive'],
    async: ['saveTask', 'completeTask', 'reportProblem', 'updateTask', 'setTaskCancelled'], open: ['getBoot', 'getTasks', 'getInitialData', 'reportPdf', 'checkCarrierPin'], pinFns: ['completeTask', 'reportProblem'], idRe: /^TASK-\d{10,}$/, idPrefix: 'TASK-' },
  kais: { gas: 'KAIS_GAS_URL', reads: ['getTasks', 'getInitialData'], boot: null,
    fns: ['getTasks', 'getInitialData', 'saveTask', 'completeTask', 'saveFileToDrive'],
    async: ['saveTask', 'completeTask'], open: ['getTasks', 'getInitialData'], pinFns: [], idRe: /^KM-\d{10,}$/, idPrefix: 'KM-' }
};
const IZV_FRESH_MS = 20000;
/* Bildes no Google Drive caur Cloudflare kešatmiņu: pirmā reize ~1 s, pēc tam ~0,1 s */
const IMG_SIZES = ['w300', 'w400', 'w600', 'w1600'];
function imgKey(id, sz) { return new Request('https://img.cache/' + id + '/' + sz); }
async function imgFetch(id, sz, ctx) {
  const cache = caches.default, key = imgKey(id, sz);
  let r = await cache.match(key);
  if (r) return r;
  const g = await fetch('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=' + sz, { redirect: 'follow' });
  if (!g.ok || !/^image\//.test(g.headers.get('content-type') || '')) return new Response('Nav bildes', { status: 404, headers: CORS });
  r = new Response(g.body, { headers: Object.assign({ 'Content-Type': g.headers.get('content-type'), 'Cache-Control': 'public, max-age=31536000, immutable' }, CORS) });
  ctx.waitUntil(cache.put(key, r.clone()));
  return r;
}
async function img(url, ctx, env) {
  const id = url.searchParams.get('id') || '', sz = url.searchParams.get('sz') || 'w600';
  if (!/^[\w-]{20,80}$/.test(id) || IMG_SIZES.indexOf(sz) === -1) return new Response('Nederīgs', { status: 400, headers: CORS });
  if (id.startsWith('r2-') && env && env.FOTO) {   // R2 (jaunās bildes) — oriģināls, ilgs kešs
    const o = await env.FOTO.get(id);
    if (!o) return new Response('Nav bildes', { status: 404, headers: CORS });
    return new Response(o.body, { headers: Object.assign({ 'Content-Type': (o.httpMetadata && o.httpMetadata.contentType) || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }, CORS) });
  }
  return imgFetch(id, sz, ctx);
}
/** Pēc saraksta atjaunošanas iepriekš ielādē jaunāko pieteikumu bildes (lai arī pirmā atvēršana ir ātra) */
async function imgPrewarm(text, ctx) {
  const ids = []; const re = /\/d\/([\w-]{20,80})|[?&]id=([\w-]{20,80})/g; let m;
  const tail = text.length > 400000 ? text.slice(-400000) : text;
  while ((m = re.exec(tail)) && ids.length < 400) ids.push(m[1] || m[2]);
  const uniq = [...new Set(ids)].slice(-15);
  for (const id of uniq) { try { const r = await caches.default.match(imgKey(id, 'w600')); if (!r) await imgFetch(id, 'w600', ctx); } catch (e) {} }
}
/** Ieeja ar PIN visos servisos: pieteicēji — Aizvietošanas lietotāju PIN; izvedēji/kurjeri — sava SIA parole */
const WHO_LABEL = { admin: 'Administrators', vaditajs: 'Pieteicējs', izvedejs: 'Izvedējs', kurjers: 'Kurjers' };
async function who(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST' });
  let b = {}; try { b = JSON.parse(await request.text() || '{}'); } catch (e) {}
  const pin = String(b.pin || '').trim(), app = String(b.app || '');
  if (!pin || pin.length > 64) return json({ ok: false, error: 'Ievadiet PIN' });
  let pp = await personByPin(env.DB, pin);
  if (!pp) {   // pilnvaras vēl nav izveidotas → Aizvietošanas lietotāji
    const u = await env.DB.prepare("SELECT name, role FROM users WHERE pin = ? AND pin != ''").bind(pin).first();
    if (u && (u.role === 'admin' || u.role === 'vaditajs') && !(await env.DB.prepare('SELECT COUNT(*) n FROM people').first()).n) pp = { name: u.name, perms: { [app]: u.role === 'admin' ? 'admin' : 'pieteicejs' } };
  }
  if (pp) {
    const r = pp.perms[app] || '';
    if (!r) { await new Promise(r => setTimeout(r, 400)); return json({ ok: false, error: 'Jums nav piekļuves šai lietotnei' }); }
    if (r === 'skatitajs') return json({ ok: false, error: 'Jums ir tikai skatīšanās tiesības' });
    return json({ ok: true, user: { name: pp.name, role: r, kind: r === 'admin' ? 'admin' : 'pieteicejs', kindLabel: r === 'admin' ? 'Administrators' : 'Pieteicējs' } });
  }
  try {
    if (app === 'kais' && await kais.isNative(env)) {
      const c = await kais.courierByPassword(env.DB, pin);
      if (c) return json({ ok: true, user: { name: c, role: 'kurjers', kind: 'kurjers', kindLabel: WHO_LABEL.kurjers } });
    } else if (app === 'izv' || app === 'kais') {
      const t = JSON.parse(await appGas(env, app, 'whoByPassword', JSON.stringify([pin])));
      const w = t.ok && t.result;
      if (w && w.kind === 'pieteicejs') return json({ ok: true, user: { name: w.name, role: 'pieteicejs', kind: 'pieteicejs', kindLabel: WHO_LABEL.vaditajs } });
      if (w && w.kind === 'izvedejs') { const cp = w.name + '\n' + pin.toUpperCase(); await pinRemember(env, cp).catch(() => 0);
        return json({ ok: true, user: { name: w.name, role: 'izvedejs', kind: 'izvedejs', kindLabel: WHO_LABEL.izvedejs }, carrierPin: cp }); }
      if (w && w.kind === 'kurjers') return json({ ok: true, user: { name: w.name, role: 'kurjers', kind: 'kurjers', kindLabel: WHO_LABEL.kurjers } });
    }
  } catch (e) { return json({ ok: false, error: 'Neizdevās pārbaudīt, mēģiniet vēlreiz' }); }
  await new Promise(r => setTimeout(r, 700));
  return json({ ok: false, error: 'Nepareizs PIN' });
}
async function appGas(env, app, fn, body) {
  const r = await fetch(env[APPS[app].gas] + '?fn=' + encodeURIComponent(fn) + '&key=' + encodeURIComponent(env.BRIDGE_KEY),
    { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
  const t = await r.text();
  if (!t.startsWith('{"ok":')) throw new Error('Google atbilde: ' + r.status);
  return t;
}
async function appRefresh(env, app, fn, ctx) {
  const t = await appGas(env, app, fn, '[]');
  if (t.startsWith('{"ok":true')) await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?), (?, ?)').bind(app + ':' + fn, t, app + 't:' + fn, String(Date.now())).run();
  if (ctx && app === 'izv' && fn === 'getBoot') ctx.waitUntil(imgPrewarm(t, ctx).catch(() => 0));
  return t;
}

/* ---- Saglabāšana fonā ---- */
const Q_PART = 1500000;
const rigaNow = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])); return { d: p.day + '.' + p.month + '.' + p.year, t: p.hour + ':' + p.minute, y: +p.year, m: +p.month, day: +p.day }; };
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('izv|' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32); }
async function pinKnown(env, pin) { const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('izvpin:' + await sha(pin)).first(); return r && Date.now() - +r.v < 12 * 3600e3; }
async function pinRemember(env, pin) { await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('izvpin:' + await sha(pin), String(Date.now())).run(); }

/** Optimistiskās izmaiņas sarakstā (kamēr Google vēl nav apstiprinājis) */
function appPatch(app, fn, a) {
  const n = rigaNow(), st = n.d + ' ' + n.t, d = a[0] || {};
  if (app === 'kais') {
    if (fn === 'saveTask') return { add: { rowIndex: 900000 + (Date.now() % 90000), id: d.id, date: st, address: String(d.address || ''), requester: String(d.requester || ''), material: String(d.material || ''),
      bagsEst: String(d.bagsEst === undefined ? '' : d.bagsEst), comment: String(d.comment || ''), photoBefore: '', status: 'Gaida piegādi', sia: '', photoAfter: '', m3Hauled: '', carrierComment: '', deliveredAt: '', pending: true } };
    if (fn === 'completeTask') return { rowIndex: +d.rowIndex, set: { status: 'Piegādāts', sia: String(d.sia || ''), m3Hauled: String(d.m3Hauled === undefined ? '' : d.m3Hauled), carrierComment: String(d.carrierComment || ''), deliveredAt: st, pending: true } };
    return null;
  }
  if (fn === 'saveTask') {
    let due = new Date(Date.UTC(n.y, n.m - 1, n.day + 7));
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.deadline || '')); if (m) { const x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (x < due && x >= new Date(Date.UTC(n.y, n.m - 1, n.day))) due = x; }
    const dd = ('0' + due.getUTCDate()).slice(-2) + '.' + ('0' + (due.getUTCMonth() + 1)).slice(-2) + '.' + due.getUTCFullYear();
    return { add: { rowIndex: 0, id: d.id, date: st, address: String(d.address || ''), requester: String(d.requester || ''), bagsEst: String(d.bagsEst || ''), comment: String(d.comment || ''),
      photoBefore: '', status: 'Neizpildīts', sia: '', photoAfter: '', m3Hauled: '', carrierComment: '', urgent: !!d.urgent, deadline: dd, problem: '',
      history: st + ' · Izveidots' + (d.requester ? ' (' + d.requester + ')' : ''), doneAt: '', bagsHauled: '', coefNote: '', pending: true } };
  }
  if (fn === 'completeTask') {
    let m3 = d.m3Hauled, bags = '', coef = '';
    if (d.bagsHauled !== undefined && d.bagsHauled !== null && d.bagsHauled !== '') { bags = parseInt(d.bagsHauled, 10); const c = (d.heavy ? 0.10 : 0) + (d.mixed ? 0.05 : 0);
      m3 = Math.round(bags * 0.15 * (1 + c) * 100) / 100; coef = [d.heavy ? '+10% smagi maisi' : '', d.mixed ? '+5% sadzīves atkritumi' : ''].filter(Boolean).join('; '); }
    const sia = String(d.pin || '').split('\n')[0].replace(/\s+/g, ' ').trim();
    return { id: d.id, set: { status: 'Izpildīts', sia, m3Hauled: String(m3 === 0 ? '0' : (m3 || '')), carrierComment: String(d.carrierComment || ''), doneAt: st, bagsHauled: String(bags || ''), coefNote: coef, pending: true } };
  }
  if (fn === 'reportProblem') return { id: d.id, set: { problem: st + ' · ' + String(d.reason || '').trim() + (d.comment ? ' — ' + String(d.comment).trim() : ''), pending: true } };
  if (fn === 'updateTask') return { id: d.id, set: { address: String(d.address || ''), requester: String(d.requester || ''), bagsEst: String(d.bagsEst || ''), comment: String(d.comment || ''), urgent: !!d.urgent, pending: true } };
  if (fn === 'setTaskCancelled') return { id: a[0], set: { status: a[1] ? 'Atcelts' : 'Neizpildīts', pending: true } };
  return null;
}
function applyPatches(tasks, patches) {
  for (const p of patches) {
    if (p.add) { if (!tasks.some(t => t.id === p.add.id)) tasks.push(p.add); }
    else { const t = tasks.find(x => p.id !== undefined ? x.id === p.id : x.rowIndex === p.rowIndex); if (t) Object.assign(t, p.set); }
  }
  return tasks;
}
const qName = (app, fn) => app === 'izv' ? fn : app + '|' + fn;
const qSplit = (s) => s.indexOf('|') > 0 ? s.split('|') : ['izv', s];
async function appPending(env, app) {
  const all = ((await env.DB.prepare("SELECT qid, fn, patch, created, err FROM izv_q WHERE part = 0 ORDER BY created").all()).results || []);
  return app ? all.filter(q => qSplit(q.fn)[0] === app) : all;
}
const parsePatches = (q) => q.filter(x => !x.err).map(x => { try { return JSON.parse(x.patch); } catch (e) { return null; } }).filter(Boolean);
/** Viena rindas ieraksta nosūtīšana uz Google (ar slēdzeni pret dubultu sūtīšanu) */
async function appProcess(env, ctx, qid) {
  const now = Date.now();
  const lk = await env.DB.prepare("UPDATE izv_q SET lock = ?, tries = tries + 1 WHERE qid = ? AND part = 0 AND err = '' AND lock < ?").bind(now, qid, now - 90000).run();
  if (!lk.meta || !lk.meta.changes) return;
  const parts = (await env.DB.prepare('SELECT fn, data FROM izv_q WHERE qid = ? ORDER BY part').bind(qid).all()).results || [];
  if (!parts.length) return;
  const [app, fn] = qSplit(parts[0].fn), body = parts.map(p => p.data).join('');
  let t;
  try { t = await appGas(env, app, fn, body); }
  catch (e) { await env.DB.prepare('UPDATE izv_q SET lock = 0 WHERE qid = ? AND part = 0').bind(qid).run(); return; }   // atkārtos vēlāk
  let res = null; try { res = JSON.parse(t); } catch (e) {}
  const r = res && res.result, ok = res && res.ok && r && (r.status === 'success' || /jau ir atzīmēts/.test(r.message || ''));
  if (ok) {
    await env.DB.prepare('DELETE FROM izv_q WHERE qid = ?').bind(qid).run();
    if (app === 'izv' && r.tasks) { const boot = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('izv:getBoot').first();
      if (boot) { try { const b = JSON.parse(boot.v); b.result.tasks = r.tasks; await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?), (?, ?), (?, ?)').bind('izv:getBoot', JSON.stringify(b), 'izv:getTasks', JSON.stringify({ ok: true, result: r.tasks }), 'izvt:getBoot', String(Date.now())).run(); } catch (e) {} } }
    else await appRefresh(env, app, 'getTasks', ctx).catch(() => 0);
    if (APPS[app].pinFns.indexOf(fn) !== -1) { try { await pinRemember(env, JSON.parse(body)[0].pin); } catch (e) {} }
  } else {
    await qFail(env, qid, (res && (res.error || (r && r.message))) || 'Google kļūda');
  }
}
async function izvDrain(env, ctx, maxAgeMs) {
  const list = (await appPending(env)).filter(q => !q.err && Date.now() - q.created > (maxAgeMs || 0)).slice(0, 3);
  for (const q of list) { if (q.fn.startsWith('budz|')) await budzProcess(env, ctx, q.qid); else await appProcess(env, ctx, q.qid); }
  // kļūdainie ieraksti netiek dzēsti automātiski (datu zudums) — tos redz lietotājs un var nodzēst pats
}
/* Pārejoša Google kļūda (slēdzene, kvota, taimauts) → mēģina vēlreiz (līdz 12 reizēm ik pēc 5 min); citādi atzīmē kļūdu */
const TRANSIENT = /lock|timeout|timed out|too many|exceeded|try again|busy|unavailable|kvot|quota|Google atbilde: 5\d\d|Service/i;
async function qFail(env, qid, msg) {
  const m = String(msg || 'Google kļūda').slice(0, 300);
  const row = await env.DB.prepare('SELECT tries FROM izv_q WHERE qid = ? AND part = 0').bind(qid).first();
  if (TRANSIENT.test(m) && row && row.tries < 12) return env.DB.prepare('UPDATE izv_q SET lock = 0 WHERE qid = ? AND part = 0').bind(qid).run();
  return env.DB.prepare('UPDATE izv_q SET err = ?, lock = 0 WHERE qid = ? AND part = 0').bind(m, qid).run();
}

async function izv(request, url, env, ctx, app) {
  const H = Object.assign({ 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }, CORS);
  const fn = url.searchParams.get('fn') || '', A = APPS[app];
  try {
    if (A.fns.indexOf(fn) === -1) throw new Error('Nezināma darbība');
    if (app === 'kais' && await kais.isNative(env)) {   // bez Apps Script (D1 + tabulas kopija)
      if (A.open.indexOf(fn) === -1) {
        const me = await session(env, url.searchParams.get('t') || '');
        if (!me || !((me.perms || {}).kais || (me.perms || {}).portal === 'admin')) throw Object.assign(new Error('Lai pieteiktu vai atzīmētu, ienāciet portālā vaitkevix.cloud/sh'), { code: 'login' });
        if ((me.perms || {}).kais === 'skatitajs' && (me.perms || {}).portal !== 'admin') throw new Error('Jums ir tikai skatīšanās tiesības');
      }
      let a = []; try { a = JSON.parse((await request.text()) || '[]'); } catch (e) {}
      const r = await kais.handle(env, ctx, fn, a, (f, body) => appGas(env, 'kais', f, body));
      if (r !== undefined) return new Response(JSON.stringify({ ok: true, result: r }), { headers: H });
    }
    if (!env[A.gas]) throw new Error('Serveris nav iestatīts');
    if (A.reads.indexOf(fn) !== -1) {
      const rows = (await env.DB.prepare('SELECT k, v FROM kv WHERE k IN (?, ?)').bind(app + ':' + fn, app + 't:' + fn).all()).results || [];
      let v = (rows.find(r => r.k === app + ':' + fn) || {}).v; const t = +((rows.find(r => r.k === app + 't:' + fn) || {}).v || 0);
      if (!v) v = await appRefresh(env, app, fn, ctx);
      else if (Date.now() - t > IZV_FRESH_MS || url.searchParams.get('fresh')) ctx.waitUntil(appRefresh(env, app, fn, ctx).catch(e => console.error(e)));
      const q = await appPending(env, app);
      if (q.length && fn !== 'getInitialData') {
        ctx.waitUntil(izvDrain(env, ctx, 45000).catch(() => 0));
        const patches = parsePatches(q);
        const notices = q.filter(x => x.err).map(x => { let p = {}; try { p = JSON.parse(x.patch); } catch (e) {} return { id: x.qid, text: 'Neizdevās saglabāt' + (p.add ? ' jaunu pieteikumu ' + p.add.address : '') + ': ' + x.err }; });
        if (patches.length || notices.length) {
          const o = JSON.parse(v);
          if (patches.length && o.ok && o.result) { if (fn === 'getBoot') applyPatches(o.result.tasks || (o.result.tasks = []), patches); else if (Array.isArray(o.result)) applyPatches(o.result, patches); }
          if (notices.length) o.notices = notices;
          v = JSON.stringify(o);
        }
      }
      return new Response(v, { headers: H });
    }
    /* Mainīt (pieteikt, izvest, atzīmēt, AI, faili) — tikai ar portāla sesiju; skatīties var visi */
    if (A.open.indexOf(fn) === -1) {
      const me = await session(env, url.searchParams.get('t') || '');
      if (!me || !((me.perms || {})[app] || (me.perms || {}).portal === 'admin')) throw Object.assign(new Error('Lai pieteiktu vai atzīmētu, ienāciet portālā vaitkevix.cloud/sh'), { code: 'login' });
      if ((me.perms || {})[app] === 'skatitajs' && (me.perms || {}).portal !== 'admin') throw new Error('Jums ir tikai skatīšanās tiesības');
      if (/^ai/.test(fn) && !((me.perms || {})[app] === 'admin' || (me.perms || {}).portal === 'admin' || (me.perms || {})[app] === 'pieteicejs')) throw new Error('Nav atļauts');
    }
    const body = await request.text();
    if (A.async.indexOf(fn) !== -1) {
      let a; try { a = JSON.parse(body); } catch (e) { a = null; }
      const d = Array.isArray(a) ? a : null;
      let fast = !!d;
      if (fast && fn === 'saveTask') {
        const x = d[0] || {}; if (!String(x.address || '').trim()) throw new Error('Nav norādīta adrese');
        if (app === 'izv') { const ph = x.photos || x.photo; if (!ph || (Array.isArray(ph) && !ph.length)) throw new Error('Pievienojiet bildi pirms izvešanas'); }
        if (!A.idRe.test(String(x.id || ''))) x.id = A.idPrefix + Date.now();
      }
      if (fast && app === 'kais' && fn === 'completeTask' && +((d[0] || {}).rowIndex) >= 900000) throw new Error('Pieteikums vēl saglabājas — mēģiniet pēc dažām sekundēm');
      if (fast && A.pinFns.indexOf(fn) !== -1) fast = await pinKnown(env, (d[0] || {}).pin);   // nezināma parole → pārbauda Google uzreiz
      if (fast) {
        const qid = crypto.randomUUID().replace(/-/g, ''), patch = appPatch(app, fn, d), raw = fn === 'saveTask' ? JSON.stringify(d) : body, now = Date.now();
        const st = [];
        for (let i = 0, k = 0; i < raw.length; i += Q_PART, k++) st.push(env.DB.prepare('INSERT INTO izv_q (qid, part, fn, data, patch, created) VALUES (?, ?, ?, ?, ?, ?)').bind(qid, k, qName(app, fn), raw.slice(i, i + Q_PART), k ? '' : JSON.stringify(patch), now));
        await env.DB.batch(st);
        ctx.waitUntil(appProcess(env, ctx, qid).catch(e => console.error(e)));
        const result = { status: 'success', queued: true };
        if (fn === 'saveTask') result.id = d[0].id;
        if (A.boot) {   // atbilde ar optimistiski izmainītu sarakstu
          const boot = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(app + ':' + A.boot).first();
          if (boot) { try { const b = JSON.parse(boot.v); result.tasks = applyPatches(b.result.tasks || [], parsePatches(await appPending(env, app))); } catch (e) {} }
        }
        return new Response(JSON.stringify({ ok: true, result }), { headers: H });
      }
    }
    const t = await appGas(env, app, fn, body);
    if (A.pinFns.indexOf(fn) !== -1 && t.startsWith('{"ok":true') && !/"code":"pin"/.test(t)) { try { ctx.waitUntil(pinRemember(env, JSON.parse(body)[0].pin)); } catch (e) {} }
    if (fn === 'checkCarrierPin' && t.startsWith('{"ok":true,"result":true')) { try { ctx.waitUntil(pinRemember(env, JSON.parse(body)[0])); } catch (e) {} }
    if (!/^(getAccess|checkCarrierPin|reportPdf|geocodeAddresses|ai)/.test(fn)) ctx.waitUntil(Promise.all(A.reads.filter(f => f !== 'getInitialData').map(f => appRefresh(env, app, f, ctx).catch(() => 0))));
    return new Response(t, { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e), code: (e && e.code) || '' }), { headers: H });
  }
}

/* ---------------- Personāls: ātrais starpnieks (Google tabula paliek galvenā) ----------------
 * Lasīšana (login, records, calendar, days) — no kešatmiņas pēc PIN (atceras pēc veiksmīgas pieslēgšanās Google pusē, 2 h),
 * atjaunojas fonā. Iesniegšana (hire, vacation, status) — uzreiz uz Google (pārbaudes, ID, e-pasts), pēc tam kešatmiņa atjaunojas.
 */
const PERS_READS = ['login', 'records', 'calendar', 'days'];
const PERS_WRITES = ['hire', 'vacation', 'status'];
async function persGas(env, body) {
  const r = await fetch(env.PERS_GAS_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
  const t = await r.text();
  if (!t.startsWith('{')) throw new Error('Google atbilde: ' + r.status);
  return t;
}
async function pers(request, env, ctx) {
  const H = Object.assign({ 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }, CORS);
  try {
    if (!env.PERS_GAS_URL) throw new Error('Serveris nav iestatīts');
    const body = await request.text();
    let req; try { req = JSON.parse(body); } catch (e) { throw new Error('Nederīgs pieprasījums'); }
    const action = String(req.action || '');
    if (PERS_READS.indexOf(action) === -1 && PERS_WRITES.indexOf(action) === -1) throw new Error('Nezināma darbība');
    const ph = 'perspin:' + await sha('pers|' + String(req.login || '').trim().toLowerCase() + '|' + String(req.pin || '').trim());
    const known = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(ph).first();
    let user = null; if (known) { try { const o = JSON.parse(known.v); if (Date.now() - o.t < 2 * 3600e3) user = o.user; } catch (e) {} }
    const remember = (t) => { if (action === 'login') { try { const o = JSON.parse(t); if (o.ok && o.user) return env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(ph, JSON.stringify({ user: o.user, t: Date.now() })).run(); } catch (e) {} }
      if (/"error":"Nepareizs PIN"/.test(t)) return env.DB.prepare('DELETE FROM kv WHERE k = ?').bind(ph).run(); };
    if (PERS_READS.indexOf(action) !== -1) {
      const ck = 'pers:' + (user ? user.name : '?') + ':' + action + ':' + [req.from, req.to, req.no, req.lidz].map(x => x || '').join('|');
      const refresh = async () => { const t = await persGas(env, body); await remember(t);
        if (t.startsWith('{"ok":true')) await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?), (?, ?)').bind(ck, t, 'perst:' + ck.slice(5), String(Date.now())).run();
        return t; };
      if (user) {
        const rows = (await env.DB.prepare('SELECT k, v FROM kv WHERE k IN (?, ?)').bind(ck, 'perst:' + ck.slice(5)).all()).results || [];
        const v = (rows.find(r => r.k === ck) || {}).v, t = +((rows.find(r => r.k !== ck) || {}).v || 0);
        if (v && t) { if (Date.now() - t > IZV_FRESH_MS) ctx.waitUntil(refresh().catch(() => 0)); return new Response(v, { headers: H }); }
        return new Response(await refresh(), { headers: H });
      }
      const t = await persGas(env, body); await remember(t);
      if (action === 'login' && t.startsWith('{"ok":true')) { try { const o = JSON.parse(t); const k2 = 'pers:' + o.user.name + ':login:|||';
        await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?), (?, ?)').bind(k2, t, 'perst:' + k2.slice(5), String(Date.now())).run(); } catch (e) {} }
      return new Response(t, { headers: H });
    }
    // iesniegšana — uzreiz uz Google; pēc tam visiem saraksti/kalendārs tiek atjaunoti fonā
    { const pp = await personByPin(env.DB, req.pin); if (pp && pp.perms.pers === 'skatitajs') throw new Error('Jums ir tikai skatīšanās tiesības'); }
    const t = await persGas(env, body); ctx.waitUntil(remember(t) || Promise.resolve());
    if (t.startsWith('{"ok":true')) ctx.waitUntil(env.DB.prepare("DELETE FROM kv WHERE k LIKE 'perst:%'").run());
    return new Response(t, { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }), { headers: H });
  }
}

/* ---------------- Budžets: ātrā lasīšana + saglabāšana fonā (Google tabula paliek galvenā) ---------------- */
const BUDZ_READS = ['login', 'tplList', 'tplGet', 'list', 'get', 'versions'];
async function budzGas(env, body) {
  const r = await fetch(env.BUDZ_GAS_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
  const t = await r.text();
  if (!t.startsWith('{')) throw new Error('Google atbilde: ' + r.status);
  return t;
}
const budzCk = (user, req) => 'budz:' + user + ':' + req.action + ':' + [req.id, req.versija].map(x => x || '').join('|');
async function budzStore(env, ck, t) { await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?), (?, ?)').bind(ck, t, 'budzt:' + ck.slice(5), String(Date.now())).run(); }
/** Pēc saglabāšanas Google pusē — svaigs saraksts un šis budžets kešatmiņā */
async function budzAfter(env, user, pin, id) {
  for (const q of [{ action: 'list', pin }, { action: 'get', pin, id }]) {
    try { const t = await budzGas(env, JSON.stringify(q)); if (t.startsWith('{"ok":true')) await budzStore(env, budzCk(user, q), t); } catch (e) {}
  }
}
async function budzPending(env, user) {
  return ((await env.DB.prepare("SELECT qid, fn, patch, created, err FROM izv_q WHERE part = 0 AND fn = ? ORDER BY created").bind('budz|' + user).all()).results || []);
}
async function budzProcess(env, ctx, qid) {
  const head = await env.DB.prepare("SELECT fn, patch, created FROM izv_q WHERE qid = ? AND part = 0 AND err = ''").bind(qid).first();
  if (!head) return;
  let P = {}; try { P = JSON.parse(head.patch); } catch (e) {}
  // secība: vispirms vecākās tā paša budžeta izmaiņas
  const older = ((await env.DB.prepare("SELECT qid, patch FROM izv_q WHERE part = 0 AND fn = ? AND err = '' AND created < ? ORDER BY created").bind(head.fn, head.created).all()).results || [])
    .filter(x => { try { return JSON.parse(x.patch).bid === P.bid; } catch (e) { return false; } });
  if (older.length) return budzProcess(env, ctx, older[0].qid);
  const now = Date.now();
  const lk = await env.DB.prepare("UPDATE izv_q SET lock = ?, tries = tries + 1 WHERE qid = ? AND part = 0 AND err = '' AND lock < ?").bind(now, qid, now - 90000).run();
  if (!lk.meta || !lk.meta.changes) return;
  const parts = (await env.DB.prepare('SELECT data FROM izv_q WHERE qid = ? ORDER BY part').bind(qid).all()).results || [];
  const body = parts.map(p => p.data).join('');
  let t; try { t = await budzGas(env, body); } catch (e) { await env.DB.prepare('UPDATE izv_q SET lock = 0 WHERE qid = ? AND part = 0').bind(qid).run(); return; }
  let res = null; try { res = JSON.parse(t); } catch (e) {}
  if (res && res.ok) {
    await env.DB.prepare('DELETE FROM izv_q WHERE qid = ?').bind(qid).run();
    let pin = ''; try { pin = JSON.parse(body).pin; } catch (e) {}
    await budzAfter(env, head.fn.slice(5), pin, P.bid);
    const next = (await budzPending(env, head.fn.slice(5))).find(x => !x.err && (() => { try { return JSON.parse(x.patch).bid === P.bid; } catch (e) { return false; } })());
    if (next) await budzProcess(env, ctx, next.qid);
  } else {
    await qFail(env, qid, (res && res.error) || 'Google kļūda');
  }
}
function budzApply(action, req, o, pend) {
  for (const p of pend) {
    if (action === 'get' && String(req.id) === String(p.bid) && !req.versija && o.meta) { Object.assign(o.meta, p.meta); o.data = p.data; }
    if (action === 'list' && Array.isArray(o.items)) { const it = o.items.find(x => String(x.id) === String(p.bid)); if (it) Object.assign(it, p.meta, p.item); }
  }
}
async function budz(request, env, ctx) {
  const H = Object.assign({ 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }, CORS);
  try {
    if (!env.BUDZ_GAS_URL) throw new Error('Serveris nav iestatīts');
    const body = await request.text();
    let req; try { req = JSON.parse(body); } catch (e) { throw new Error('Nederīgs pieprasījums'); }
    const action = String(req.action || '');
    const ph = 'budzpin:' + await sha('budz|' + String(req.pin || '').trim());
    const known = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(ph).first();
    let user = null; if (known) { try { const o = JSON.parse(known.v); if (Date.now() - o.t < 2 * 3600e3) user = o.user; } catch (e) {} }
    const remember = async (t) => {
      if (action === 'login') { try { const o = JSON.parse(t); if (o.ok && o.user) { user = o.user; await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(ph, JSON.stringify({ user: o.user, t: Date.now() })).run(); } } catch (e) {} }
      if (/"error":"Nepareizs PIN"/.test(t)) await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind(ph).run();
    };
    if (BUDZ_READS.indexOf(action) === -1) { const pp = await personByPin(env.DB, req.pin); if (pp && pp.perms.budz === 'skatitajs') throw new Error('Jums ir tikai skatīšanās tiesības'); }
    if (BUDZ_READS.indexOf(action) !== -1) {
      if (!user) { const t = await budzGas(env, body); await remember(t); if (user && t.startsWith('{"ok":true')) await budzStore(env, budzCk(user.name, req), t); return new Response(t, { headers: H }); }
      const ck = budzCk(user.name, req);
      const refresh = async () => { const t = await budzGas(env, body); await remember(t); if (t.startsWith('{"ok":true')) await budzStore(env, ck, t); return t; };
      const rows = (await env.DB.prepare('SELECT k, v FROM kv WHERE k IN (?, ?)').bind(ck, 'budzt:' + ck.slice(5)).all()).results || [];
      let v = (rows.find(r => r.k === ck) || {}).v; const ts = +((rows.find(r => r.k !== ck) || {}).v || 0);
      if (v && ts) { if (Date.now() - ts > IZV_FRESH_MS) ctx.waitUntil(refresh().catch(() => 0)); } else v = await refresh();
      if (action === 'get' || action === 'list') {
        const q = await budzPending(env, user.name);
        if (q.length) {
          ctx.waitUntil((async () => { for (const x of q.filter(x => !x.err && Date.now() - x.created > 45000).slice(0, 2)) await budzProcess(env, ctx, x.qid); })().catch(() => 0));
          const o = JSON.parse(v);
          budzApply(action, req, o, q.filter(x => !x.err).map(x => { try { return JSON.parse(x.patch); } catch (e) { return null; } }).filter(Boolean));
          const errs = q.filter(x => x.err);
          if (errs.length) o.notices = errs.map(x => ({ id: x.qid, text: 'Neizdevās saglabāt budžetu: ' + x.err }));
          v = JSON.stringify(o);
        }
      }
      return new Response(v, { headers: H });
    }
    // Parasta saglabāšana esošam budžetam — fonā (uzreiz atbild); iesniegšana, jauns budžets u.c. — uzreiz uz Google
    if (action === 'save' && user && req.id && !req.statuss && !req.sutitVadibai && (user.role === 'admin' || user.role === 'gatavotājs')) {
      const q = await budzPending(env, user.name);
      const mine = q.filter(x => !x.err).map(x => { try { return JSON.parse(x.patch); } catch (e) { return null; } }).filter(p => p && String(p.bid) === String(req.id));
      let meta = mine.length ? mine[mine.length - 1].meta : null;
      if (!meta) { const g = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(budzCk(user.name, { action: 'get', id: req.id })).first();
        if (g) { try { const m = JSON.parse(g.v).meta; if (m && (user.role === 'admin' || (m.statuss !== 'Apstiprināts' && norm(m.autors) === norm(user.name)))) meta = { versija: +m.versija || 0, statuss: m.statuss }; } catch (e) {} } }
      const dataStr = JSON.stringify(req.data || {});
      if (meta && dataStr.length < 700000) {
        const n = rigaNow(), ts = n.d + ' ' + n.t, o = (req.data || {}).objekts || {}, c = req.calc || {};
        const nm = { versija: (+meta.versija || 0) + 1, statuss: meta.statuss === 'Noraidīts' ? 'Melnraksts' : meta.statuss, atjaunots: ts };
        const patch = { bid: req.id, meta: nm, data: req.data || {}, item: { nosaukums: o.nosaukums || '', adrese: o.adrese || '', pasutitajs: o.pasutitajs || '', bezPVN: c.bezPVN, arPVN: c.arPVN } };
        const qid = crypto.randomUUID().replace(/-/g, ''), now = Date.now(), st = [];
        for (let i = 0, k = 0; i < body.length; i += Q_PART, k++) st.push(env.DB.prepare('INSERT INTO izv_q (qid, part, fn, data, patch, created) VALUES (?, ?, ?, ?, ?, ?)').bind(qid, k, 'budz|' + user.name, body.slice(i, i + Q_PART), k ? '' : JSON.stringify(patch), now));
        await env.DB.batch(st);
        ctx.waitUntil(budzProcess(env, ctx, qid).catch(e => console.error(e)));
        return new Response(JSON.stringify({ ok: true, id: req.id, versija: nm.versija, statuss: nm.statuss, atjaunots: ts, sent: [], queued: true }), { headers: H });
      }
    }
    const t = await budzGas(env, body); await remember(t);
    if (user && t.startsWith('{"ok":true')) ctx.waitUntil(env.DB.prepare("DELETE FROM kv WHERE k LIKE 'budzt:%'").run());   // visiem svaigi dati
    return new Response(t, { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }), { headers: H });
  }
}

const SITES = { '/shaizvietosana': 'https://vaitkevix.github.io/aizvietosana', '/shizvesana': 'https://vaitkevix.github.io/izvesana', '/shkaisammaterials': 'https://vaitkevix.github.io/kaisammaterials', '/shpersonals': 'https://vaitkevix.github.io/personals', '/shbudzets': 'https://vaitkevix.github.io/budzets', '/shplausana': 'https://vaitkevix.github.io/plausana', '/shlogi': 'https://vaitkevix.github.io/logi', '/shsniegs': 'https://vaitkevix.github.io/sniegs', '/shdarznieciba': 'https://vaitkevix.github.io/darznieciba', '/shstavvietas': 'https://vaitkevix.github.io/stavvietas', '/shdarbalaiks': 'https://vaitkevix.github.io/darbalaiks', '/sh': 'https://vaitkevix.github.io/portals' };
const SITE_KEY = { '/shaizvietosana': 'aizv', '/shizvesana': 'izv', '/shkaisammaterials': 'kais', '/shpersonals': 'pers', '/shbudzets': 'budz', '/shplausana': 'pl', '/shlogi': 'logi', '/shsniegs': 'sniegs', '/shdarznieciba': 'darz', '/shstavvietas': 'stav', '/shdarbalaiks': 'dl' };
/** Lietotnes faili no GitHub Pages zem tava domēna */
async function site(request, url, base) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const rest = url.pathname.slice(base.length) || '/';
  const r = await fetch(SITES[base] + rest + url.search, { headers: { 'User-Agent': 'vaitkevix-proxy' }, cf: { cacheTtl: 60, cacheEverything: true } });
  const h = new Headers(r.headers);
  h.delete('set-cookie');
  if (/\.(html|js|json)$|\/$/.test(rest)) h.set('Cache-Control', 'no-cache');
  return new Response(r.body, { status: r.status, headers: h });
}

function json(o) { return new Response(JSON.stringify(o), { headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS) }); }
function checkKey(env, key) { if (!env.BRIDGE_KEY || key !== env.BRIDGE_KEY) throw new Error('Nav atļauts'); }

/* ---------------- Konteksts: DB + kešs viena pieprasījuma laikā ---------------- */

class Ctx {
  constructor(env, ctx) { this.env = env; this.ctx = ctx; this.db = env.DB; this.c = {}; }
  async all(sql, ...a) { return (await this.db.prepare(sql).bind(...a).all()).results || []; }
  async first(sql, ...a) { return await this.db.prepare(sql).bind(...a).first(); }
  run(sql, ...a) { return this.db.prepare(sql).bind(...a).run(); }
  st(sql, ...a) { return this.db.prepare(sql).bind(...a); }
  async users() { return this.c.users || (this.c.users = await this.all('SELECT name, role, pin, color FROM users ORDER BY ord, name')); }
  async auth(pin) {
    pin = String(pin || '').trim(); if (!pin) return null;
    return (await this.users()).find(x => x.pin === pin && (x.role === 'admin' || x.role === 'vaditajs')) || null;
  }
  async names(role) { return (await this.users()).filter(u => u.role === role).map(u => u.name); }
  async types() { return this.c.types || (this.c.types = (await this.all('SELECT name, grp FROM types ORDER BY ord, name')).map(t => ({ name: t.name, group: t.grp }))); }
  async groupOf(name) { const t = (await this.types()).find(x => x.name === name); return t ? t.group : (name === 'Papilddarbs' ? 'Papilddarbs' : 'Aizvietošana'); }
  async objects() {
    if (this.c.objects) return this.c.objects;
    const canon = await personCanon(this.db);
    return (this.c.objects = (await this.all('SELECT adrese, vaditajs, grupa, piekluve FROM objects ORDER BY ord, adrese'))
      .map(o => ({ adrese: o.adrese, vaditajs: canon(o.vaditajs), grupa: o.grupa || 'SH objekti', piekluve: o.piekluve })));
  }
  async objMgr() { const out = {}; (await this.objects()).forEach(o => { if (o.vaditajs) out[norm(o.adrese)] = o.vaditajs; }); return out; }
  async units(date) { return (await this.all('SELECT name, persons FROM crew WHERE datums = ? ORDER BY id', date)).map(r => ({ name: r.name, persons: split(r.persons) })); }
  async crews(date) { const o = {}; (await this.units(date)).forEach(u => o[u.name] = u.persons); return o; }
  async staff() { return await this.all('SELECT name, brigade FROM staff ORDER BY ord, name'); }
  async job(id) { const r = await this.first('SELECT * FROM jobs WHERE id = ?', String(id)); return r ? jobOut(r) : null; }
  async jobsOn(date) { return (await this.all('SELECT * FROM jobs WHERE datums = ? ORDER BY seq', date)).map(jobOut); }
  bg(p) { this.ctx.waitUntil(Promise.resolve(p).catch(e => console.error(e))); }

  /** Apps Script tilts */
  async bridge(op, data, timeoutMs) {
    if (GS_OPS.has(op) && await noGoogle(this.db)) return { ok: true, skipped: 'noGoogle' };   // tikai Cloudflare — tabulā neraksta
    if (this.env.GOOGLE_SA && GS_OPS.has(op)) {   // tabulas darbības tieši caur Google Sheets API; ja neizdodas — vecais Apps Script
      try { const r = await gsheets.bridgeOp(this.env, op, data || {}); if (r) return Object.assign({ ok: true }, r); }
      catch (e) { console.error('sheets ' + op, e); await this.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('sheetsApi', ?)", 'kļūda ' + now() + ' · ' + op + ': ' + String(e.message || e)).catch(() => 0); }
    }
    if (!this.env.GAS_URL || !this.env.BRIDGE_KEY) throw new Error('Tilts uz Google nav iestatīts');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs || 60000);
    try {
      const r = await fetch(this.env.GAS_URL, { method: 'POST', redirect: 'follow', signal: ctl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: 'bridge', key: this.env.BRIDGE_KEY, op }, data)) });
      const j = JSON.parse(await r.text());
      if (!j.ok) throw new Error(j.error || 'Google kļūda');
      return j;
    } finally { clearTimeout(t); }
  }
  /** Push paziņojums (fonā — atbildi nebremzē) */
  notify(names, title, body) {
    names = (names || []).filter(Boolean); if (!names.length) return;
    this.bg(wpNotify(this.env, names, { title, body, url: '/sh/#aizv' }));   // Web Push (portāls)
    this.bg((async () => {
      const ph = names.map(() => '?').join(',');
      const toks = (await this.all(`SELECT token FROM tokens WHERE name IN (${ph})`, ...names)).map(r => r.token);
      if (!toks.length || !this.env.GAS_URL) return;   // vecie FCM tokeni (2026-11 nav neviena) — paziņojumi iet ar Web Push
      const r = await this.bridge('push', { tokens: toks, title, body }, 25000);
      if (r.dead && r.dead.length) await this.db.batch(r.dead.map(t => this.st('DELETE FROM tokens WHERE token = ?', t)));
    })());
  }
  async savePhotos(job, photos) {
    if (!photos || !photos.length) return [];
    if (this.env.FOTO) return foto.putMany(this.env, photos.slice(0, 4), { adrese: job.adrese || '', datums: job.datums || '' });
    const r = await this.bridge('photos', { datums: job.datums, adrese: job.adrese, photos: photos.slice(0, 4) }, 90000);
    return r.ids || [];
  }
}

/* ---------------- Palīgfunkcijas ---------------- */

const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function now() { return fmt.format(new Date()).replace(',', '').slice(0, 16); }
function today() { return now().slice(0, 10); }
function uid() { return crypto.randomUUID().replace(/-/g, '').slice(0, 8); }
function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function split(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
function brigs(s) { return String(s || '').split('|').map(x => x.trim()).filter(Boolean); }
function lvDate(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' : iso; }
function cleanTime(v) { const m = String(v || '').trim().match(/^(\d{1,2})[:.](\d{2})$/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function wday(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
function requireAdmin(u) { if (u.role !== 'admin') throw new Error('Tikai adminam'); }
async function peopleColors(X) { try { const r = (await X.all("SELECT name, color FROM people WHERE active = 1 AND color != ''")); const o = {}; r.forEach(x => o[x.name] = x.color); return o; } catch (e) { return {}; } }
function pubUser(u) { return { name: u.name, role: u.role, color: u.color }; }

function jobOut(r) { const j = {}; JOB_F.forEach(f => j[f] = r[f] == null ? '' : String(r[f])); return j; }
let SEQ = 0;
function seq() { return Date.now() * 100 + (SEQ++ % 100); }
function insJob(X, j) {
  const v = JOB_F.map(f => j[f] == null ? '' : String(j[f]));
  return X.st(`INSERT INTO jobs (${JOB_F.join(',')}, anorm, seq) VALUES (${JOB_F.map(() => '?').join(',')}, ?, ?)`, ...v, norm(j.adrese), seq());
}
function updJob(X, j) {
  const f = JOB_F.slice(1);
  return X.st(`UPDATE jobs SET ${f.map(k => k + ' = ?').join(', ')}, anorm = ? WHERE id = ?`, ...f.map(k => j[k] == null ? '' : String(j[k])), norm(j.adrese), j.id);
}

/** Datumi no start līdz lidz (ieskaitot), bez brīvdienām, ja brivdienas=false. Max 62. */
function seriesDates(start, lidz, brivdienas) {
  if (!lidz || lidz <= start) return [start];
  const out = []; let d = start;
  while (d <= lidz && out.length < 62) {
    const w = wday(d);
    if (brivdienas || (w !== 0 && w !== 6) || out.length === 0) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

async function addObjects(X, addrs, vaditajs) {
  const known = new Set((await X.objects()).map(o => norm(o.adrese)));
  const add = [];
  addrs.forEach(a => { const k = norm(a); if (a && !known.has(k)) { known.add(k); add.push(a); } });
  if (!add.length) return;
  await X.db.batch(add.map(a => X.st('INSERT OR IGNORE INTO objects (anorm, adrese, vaditajs, grupa, piekluve, ord) VALUES (?, ?, ?, ?, ?, ?)', norm(a), a, vaditajs || '', 'SH objekti', '', 100000)));
  X.c.objects = null;
  X.bg(X.bridge('addObjects', { rows: add.map(a => [a, vaditajs || '', 'SH objekti', '']) }, 30000));
  X.bg(X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('masterDirty', '1')"));   // tabula paliek galvenā objektu sarakstam
}

/* ---------------- Pastāvīgās aizvietošanas ---------------- */

async function readStanding(X) {
  return (await X.all('SELECT * FROM standing ORDER BY seq')).map(s => Object.assign({}, s, { brivdienas: s.brivdienas === '1', izlaistas: split(s.izlaistas) }));
}
function allowedStand(u, st) { return u.role === 'admin' || st.vaditajs === u.name; }
async function standingFor(X, u) {
  const t = today();
  return (await readStanding(X)).filter(s => (!s.beigas || s.beigas >= t) && allowedStand(u, s))
    .map(s => ({ id: s.id, adrese: s.adrese, tips: s.tips, prombutne: s.prombutne, vaditajs: s.vaditajs, no: s.no, beigas: s.beigas }));
}
async function ensureStanding(X, date) {
  if (!isDate(date) || date < today()) return;
  const w = wday(date);
  const due = (await readStanding(X)).filter(s => s.no <= date && (!s.beigas || date <= s.beigas) && s.izlaistas.indexOf(date) === -1 && (s.brivdienas || (w !== 0 && w !== 6)));
  if (!due.length) return;
  const have = new Set((await X.all("SELECT serija FROM jobs WHERE datums = ? AND serija != ''", date)).map(r => r.serija));
  const list = due.filter(s => !have.has(s.id));
  if (!list.length) return;
  const unitNames = (await X.units(date)).map(x => x.name);
  const stmts = [];
  for (const s of list) {
    const prev = await X.first('SELECT brigade FROM jobs WHERE serija = ? AND datums < ? ORDER BY datums DESC LIMIT 1', s.id, date);
    const br = prev ? brigs(prev.brigade).filter(b => unitNames.indexOf(b) !== -1).join(' | ') : '';
    stmts.push(insJob(X, { id: uid(), datums: date, adrese: s.adrese, tips: s.tips, apraksts: s.apraksts, vaditajs: s.vaditajs, brigade: br, statuss: br ? 'piešķirts' : 'jauns',
      izveidots: now(), serija: s.id, foto: s.foto, prombutne: s.prombutne, steidzami: s.steidzami, laiks: s.laiks }));
  }
  // vēlreiz pārbauda tieši pirms ieraksta (vienlaicīgi pieprasījumi)
  const again = new Set((await X.all("SELECT serija FROM jobs WHERE datums = ? AND serija != ''", date)).map(r => r.serija));
  const final = stmts.filter((_, i) => !again.has(list[i].id));
  if (final.length) await X.db.batch(final);
}

/* ---------------- Problēmas ---------------- */

async function problems(X, u) {
  return (await X.all("SELECT id, laiks, adrese, vaditajs, vieniba, apraksts, foto, statuss, atrisinats FROM problems WHERE statuss != 'atrisināts' ORDER BY seq DESC"))
    .filter(p => u.role === 'admin' || p.vaditajs === u.name);
}

/* ---------------- Skati ---------------- */

async function visibleJobs(X, u, date) {
  let jobs = await X.jobsOn(date);
  if (u.role === 'vaditajs') jobs = jobs.filter(j => j.vaditajs === u.name);
  return jobs;
}

async function whatsapp(X, date) {
  const jobs = (await X.jobsOn(date)).filter(j => j.brigade);
  const byBrig = {};
  jobs.forEach(j => brigs(j.brigade).forEach(b => (byBrig[b] = byBrig[b] || []).push(j)));
  const crews = await X.crews(date);
  const order = (await X.units(date)).map(x => x.name);
  const lines = ['*Plāns ' + lvDate(date) + '*'];
  for (const b of Object.keys(byBrig).sort((a, c) => (order.indexOf(a) + 1 || 999) - (order.indexOf(c) + 1 || 999) || a.localeCompare(c))) {
    lines.push('', '*' + b + '*');
    if (crews[b] && crews[b].length) lines.push(crews[b].join(', '));
    for (const j of byBrig[b]) {
      const extra = (await X.groupOf(j.tips)) !== 'Aizvietošana';
      let what = extra ? (j.tips === 'Papilddarbs' || j.tips === 'Cits papilddarbs' ? (j.apraksts || 'papilddarbs') : j.tips) : j.tips.toLowerCase();
      if (j.apraksts && what !== j.apraksts) what += ' (' + j.apraksts + ')';
      if (j.prombutne) what += ' (' + j.prombutne.toLowerCase() + (j.lidz ? ' līdz ' + lvDate(j.lidz) : '') + ')';
      else if (j.lidz) what += ' (līdz ' + lvDate(j.lidz) + ')';
      if (j.laiks) what += ' (līdz plkst. ' + j.laiks + ')';
      lines.push((j.steidzami ? '🔥 ' : '') + j.adrese + ' - ' + what);
    }
  }
  if (X.env.APP_URL) lines.push('', '🔗 Savi darbi: ' + X.env.APP_URL);
  return lines.join('\n');
}

async function canMark(u, job) {
  const own = u.role === 'brigade' && job.brigade === u.name && job.publicets;
  if (!own && u.role !== 'admin') throw new Error('Nav atļauts');
}

/* ---------------- Darbības ar PIN ---------------- */

const ACTIONS = {
  login: async (X, u) => ({ user: pubUser(u), meta: { managers: (await X.users()).filter(x => x.role === 'vaditajs').map(x => ({ name: x.name, color: x.color })), colors: await peopleColors(X), objects: await X.objects(), groups: await groupsOf(X.db).catch(() => []), jobTypes: await X.types() } }),

  jobs: async (X, u, r) => {
    await ensureStanding(X, r.date);
    const [jobs, units, staff, probs, stand] = await Promise.all([visibleJobs(X, u, r.date), X.units(r.date), X.staff(), problems(X, u), standingFor(X, u)]);
    const crews = {}; units.forEach(x => crews[x.name] = x.persons);
    return { jobs, units, crews, staff, teamLink: u.role === 'admin' && X.env.APP_URL ? X.env.APP_URL + '?k=' + await teamKey(X) : '', problems: probs, standing: stand };
  },

  setUnit: async (X, u, r) => {
    requireAdmin(u);
    const name = String(r.name || '').trim(), old = String(r.oldName || '').trim();
    if (!r.date || !name) throw new Error('Norādi vienības nosaukumu');
    const persons = (r.persons || []).map(p => String(p).trim()).filter(Boolean);
    const rows = await X.all('SELECT id, name, persons FROM crew WHERE datums = ? ORDER BY id', r.date);
    let row = null;
    for (const x of rows) { if (x.name === (old || name)) row = x; else if (x.name === name) throw new Error('Vienība „' + name + '” jau ir'); }
    const st = [];
    for (const x of rows) {   // cilvēks vienā dienā var būt tikai vienā vienībā
      if (row && x.id === row.id) continue;
      const other = split(x.persons), left = other.filter(p => persons.indexOf(p) === -1);
      if (left.length !== other.length) st.push(X.st('UPDATE crew SET persons = ? WHERE id = ?', left.join(', '), x.id));
    }
    if (row) st.push(X.st('UPDATE crew SET name = ?, persons = ? WHERE id = ?', name, persons.join(', '), row.id));
    else st.push(X.st('INSERT INTO crew (datums, name, persons) VALUES (?, ?, ?)', r.date, name, persons.join(', ')));
    if (old && old !== name) {
      (await X.jobsOn(r.date)).filter(j => brigs(j.brigade).indexOf(old) !== -1).forEach(j => {
        j.brigade = brigs(j.brigade).map(b => b === old ? name : b).join(' | '); st.push(updJob(X, j));
      });
    }
    const known = new Set((await X.staff()).map(s => s.name));
    persons.filter(p => !known.has(p)).forEach(p => st.push(X.st('INSERT OR IGNORE INTO staff (name, brigade, ord) VALUES (?, ?, ?)', p, '', 100000)));
    await X.db.batch(st);
    return { units: await X.units(r.date), crews: await X.crews(r.date), staff: await X.staff(), jobs: await visibleJobs(X, u, r.date) };
  },

  deleteUnit: async (X, u, r) => {
    requireAdmin(u);
    const st = [X.st('DELETE FROM crew WHERE datums = ? AND name = ?', r.date, r.name)];
    (await X.jobsOn(r.date)).filter(j => brigs(j.brigade).indexOf(r.name) !== -1).forEach(j => {
      j.brigade = brigs(j.brigade).filter(b => b !== r.name).join(' | ');
      if (!j.brigade && j.statuss === 'piešķirts') j.statuss = 'jauns';
      st.push(updJob(X, j));
    });
    await X.db.batch(st);
    return { units: await X.units(r.date), crews: await X.crews(r.date), jobs: await visibleJobs(X, u, r.date) };
  },

  importObjects: async (X, u, r) => {
    requireAdmin(u);
    const cur = await X.all('SELECT anorm, adrese, vaditajs, grupa, piekluve FROM objects');
    const idx = {}; cur.forEach(o => idx[o.anorm] = o);
    let added = 0, updated = 0; const st = [], rows = [], canon = await personCanon(X.db);
    (r.rows || []).forEach(x => {
      const a = cleanAddr(x[0]); if (!a) return; x[1] = canon(x[1]);
      const k = norm(a), c = idx[k];
      if (c) { c.grupa = x[2] || c.grupa; c.piekluve = x[3] || c.piekluve; if (x[1]) c.vaditajs = x[1]; updated++;
        st.push(X.st('UPDATE objects SET vaditajs = ?, grupa = ?, piekluve = ? WHERE anorm = ?', c.vaditajs, c.grupa, c.piekluve, k)); rows.push([c.adrese, c.vaditajs, c.grupa, c.piekluve]); }
      else { idx[k] = { adrese: a }; added++; st.push(X.st('INSERT INTO objects (anorm, adrese, vaditajs, grupa, piekluve, ord) VALUES (?, ?, ?, ?, ?, ?)', k, a, x[1] || '', x[2] || 'SH objekti', x[3] || '', 100000));
        rows.push([a, x[1] || '', x[2] || 'SH objekti', x[3] || '']); }
    });
    if (st.length) await X.db.batch(st);
    X.c.objects = null;
    if (rows.length) { X.bg(X.bridge('importObjects', { rows }, 60000)); X.bg(X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('masterDirty', '1')")); }
    return { added, updated, objects: await X.objects() };
  },

  copyUnits: async (X, u, r) => {
    requireAdmin(u);
    const have = (await X.units(r.date)).map(x => x.name);
    const src = (await X.units(r.from)).filter(x => have.indexOf(x.name) === -1);
    if (!src.length) throw new Error('Nav ko kopēt');
    await X.db.batch(src.map(x => X.st('INSERT INTO crew (datums, name, persons) VALUES (?, ?, ?)', r.date, x.name, x.persons.join(', '))));
    return { units: await X.units(r.date), crews: await X.crews(r.date), copied: src.length };
  },

  saveJob: async (X, u, r) => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    const j = r.job || {};
    if (!j.adrese || !String(j.adrese).trim()) throw new Error('Norādi adresi');
    if (!j.datums) throw new Error('Norādi datumu');
    if (j.id) {
      const job = await X.job(j.id);
      if (!job) throw new Error('Darbs nav atrasts');
      if (u.role !== 'admin' && (job.vaditajs !== u.name || job.brigade)) throw new Error('Darbu, kas jau piešķirts vienībai, var mainīt tikai admins');
      job.datums = j.datums; job.adrese = cleanAddr(j.adrese); job.tips = j.tips || job.tips; job.apraksts = j.apraksts || '';
      if (j.vaditajs && u.role === 'admin') job.vaditajs = String(j.vaditajs);
      if (j.prombutne !== undefined) job.prombutne = PROMBUTNE.indexOf(j.prombutne) !== -1 ? j.prombutne : '';
      if (j.steidzami !== undefined) job.steidzami = j.steidzami ? '1' : '';
      if (j.laiks !== undefined) job.laiks = cleanTime(j.laiks);
      await updJob(X, job).run();
      await addObjects(X, [job.adrese], job.vaditajs);
      return { job };
    }
    const job = { id: uid(), datums: j.datums, adrese: cleanAddr(j.adrese), tips: j.tips || 'Sētnieks', apraksts: j.apraksts || '', vaditajs: j.vaditajs || u.name,
      brigade: j.brigade || '', statuss: j.brigade ? 'piešķirts' : 'jauns', izveidots: now() };
    await insJob(X, job).run();
    if (u.role !== 'admin') X.notify(await X.names('admin'), 'Jauns darbs · ' + lvDate(job.datums), job.adrese + ' — ' + u.name);
    return { job: jobOut(job) };
  },

  saveJobs: async (X, u, r) => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    const list = (r.jobs || []).filter(j => j && String(j.adrese || '').trim());
    if (!list.length) throw new Error('Pievieno vismaz vienu adresi');
    if (list.some(j => /^grupa:/i.test(String(j.adrese).trim()))) throw new Error('Grupa jāizvērš adresēs — atjaunojiet lapu');
    if (!r.date) throw new Error('Norādi datumu');
    const types = (await X.types()).map(t => t.name);
    for (const j of list) {
      if ((await X.groupOf(j.tips)) === 'Aizvietošana' && PROMBUTNE.indexOf(j.prombutne) === -1) throw new Error('Norādiet aizvietošanas iemeslu adresei ' + j.adrese + ': atvaļinājums, DNL vai vakance');
      if (j.prombutne === 'Atvaļinājums' && !j.lidz && !j.vienaDiena) throw new Error('Norādiet, līdz kuram datumam ilgst atvaļinājums, vai atzīmējiet «Tikai šai vienai dienai» (' + j.adrese + ')');
      if (types.indexOf(j.tips) === -1) throw new Error('Izvēlies darbu adresei ' + j.adrese);
    }
    // bildes uz Google Drive (tikai, ja pievienotas)
    for (const j of list) { j.fotoIds = j.photos && j.photos.length ? (await X.savePhotos({ datums: r.date, adrese: String(j.adrese) }, j.photos)).join(',') : ''; delete j.photos; }
    const objMgr = await X.objMgr();
    const st = []; let count = 0;
    for (const j of list) {
      const dates = seriesDates(r.date, j.lidz, j.brivdienas);
      let serija = dates.length > 1 ? uid() : '';
      const mgr = u.role === 'admin' ? String(j.vaditajs || objMgr[norm(j.adrese)] || r.vaditajs || u.name) : u.name;
      const adrese = cleanAddr(j.adrese), grp = await X.groupOf(j.tips);
      if (!j.lidz && !j.vienaDiena && STAND_PROMB.indexOf(j.prombutne) !== -1 && grp === 'Aizvietošana') {
        serija = uid();
        st.push(X.st('INSERT INTO standing (id, adrese, tips, apraksts, vaditajs, prombutne, no, beigas, brivdienas, steidzami, laiks, foto, izlaistas, izveidots, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          serija, adrese, j.tips, String(j.apraksts || '').trim(), mgr, j.prombutne, r.date, '', j.brivdienas ? '1' : '', j.steidzami ? '1' : '', cleanTime(j.laiks), j.fotoIds || '', '', now(), seq()));
      }
      dates.forEach(d => { count++; st.push(insJob(X, { id: uid(), datums: d, adrese, tips: j.tips, apraksts: String(j.apraksts || '').trim(), vaditajs: mgr, brigade: '', statuss: 'jauns',
        izveidots: now(), lidz: j.lidz && dates.length > 1 ? j.lidz : '', serija, foto: j.fotoIds || '', prombutne: PROMBUTNE.indexOf(j.prombutne) !== -1 ? j.prombutne : '',
        steidzami: j.steidzami ? '1' : '', laiks: cleanTime(j.laiks), grupa: String(j.grupa || '').slice(0, 120) })); });
    }
    await X.db.batch(st);
    await addObjects(X, list.map(j => cleanAddr(j.adrese)), u.role === 'admin' ? String(r.vaditajs || '') : u.name);
    if (u.role !== 'admin') {
      X.notify(await X.names('admin'), 'Jauni darbi · ' + lvDate(r.date) + ' · ' + u.name,
        list.length === 1 ? list[0].adrese + ' — ' + list[0].tips + (list[0].lidz ? ' (atvaļinājums līdz ' + lvDate(list[0].lidz) + ')' : '')
          : list.length + ' adreses: ' + list.slice(0, 3).map(x => x.adrese).join(', ') + (list.length > 3 ? '…' : ''));
    }
    return { count, objects: await X.objects() };
  },

  aiNote: async (X, u, r) => {
    let piekluve = String(r.piekluve || '');
    const o = (await X.objects()).find(x => norm(x.adrese) === norm(r.adrese));
    if (!piekluve && o) piekluve = o.piekluve;
    if (!String(r.text || '').trim() && r.kind === 'note' && !piekluve) throw new Error('Šai adresei nav piekļuves informācijas — uzrakstiet dažus vārdus, un AI tos noformēs');
    const res = await (X.env.ANTHROPIC_API_KEY ? ai.aiNote(X.env, { kind: r.kind, adrese: r.adrese, tips: r.tips, text: r.text, piekluve }) : X.bridge('aiNote', { kind: r.kind, adrese: r.adrese, tips: r.tips, text: r.text, piekluve }, 60000));
    return { text: res.text };
  },

  aiParse: async (X, u, r) => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    const objs = await X.objects();
    const mine = objs.filter(o => o.vaditajs === u.name).concat(objs.filter(o => o.vaditajs !== u.name)).slice(0, 400).map(o => o.adrese);
    const req = { text: r.text, today: r.today, weekday: r.weekday, role: u.role, addresses: mine, managers: await X.names('vaditajs'), types: await X.types() };
    const res = X.env.ANTHROPIC_API_KEY ? await ai.aiParse(X.env, req) : await X.bridge('aiParse', req, 90000);
    return { datums: res.datums, vaditajs: res.vaditajs, rows: res.rows };
  },

  stats: async (X, u, r) => {
    if (u.role === 'brigade') throw new Error('Nav atļauts');
    let list = (await X.all('SELECT * FROM jobs WHERE datums >= ? AND datums <= ? ORDER BY datums, seq', r.from, r.to)).map(jobOut);
    if (u.role === 'vaditajs') list = list.filter(j => j.vaditajs === u.name);
    return { jobs: list.map(j => ({ datums: j.datums, adrese: j.adrese, tips: j.tips, vaditajs: j.vaditajs, brigade: j.brigade, statuss: j.statuss, lidz: j.lidz, prombutne: j.prombutne, foto: j.foto ? 1 : 0, parbaude: j.parbaude, iemesls: j.iemesls, steidzami: j.steidzami })) };
  },

  deleteJob: async (X, u, r) => {
    const job = await X.job(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    const allowed = (j) => u.role === 'admin' || (u.role === 'vaditajs' && j.vaditajs === u.name && !j.brigade);
    const st = job.serija ? (await readStanding(X)).find(x => x.id === job.serija) : null;
    if (st && !allowedStand(u, st)) throw new Error('Nav atļauts');
    let targets = [job];
    if (r.series && job.serija) targets = (await X.all('SELECT * FROM jobs WHERE serija = ? AND datums >= ?', job.serija, job.datums)).map(jobOut);
    targets = targets.filter(allowed);
    if (!targets.length) throw new Error('Nav atļauts');
    const q = targets.map(j => X.st('DELETE FROM jobs WHERE id = ?', j.id));
    if (st) {
      if (r.series) q.push(X.st('UPDATE standing SET beigas = ? WHERE id = ?', addDays(job.datums, -1), st.id));
      else q.push(X.st('UPDATE standing SET izlaistas = ? WHERE id = ?', st.izlaistas.concat([job.datums]).join(','), st.id));
    }
    await X.db.batch(q);
    return { deleted: targets.length };
  },

  assign: async (X, u, r) => {
    requireAdmin(u);
    const job = await X.job(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    const list = Array.isArray(r.brigades) ? r.brigades : (r.brigade ? [r.brigade] : []);
    const val = list.map(x => String(x).trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' | ');
    if (job.brigade !== val) {
      job.brigade = val;
      if (job.statuss !== 'izpildīts') job.statuss = job.brigade ? 'piešķirts' : 'jauns';
      await X.run('UPDATE jobs SET brigade = ?, statuss = ? WHERE id = ?', job.brigade, job.statuss, job.id);
    }
    return { job };
  },

  publish: async (X, u, r) => {
    requireAdmin(u);
    const jobs = (await X.jobsOn(r.date)).filter(j => j.brigade && !j.publicets);
    const byBrig = {}; const t = now();
    jobs.forEach(j => { j.publicets = t; if (j.statuss === 'jauns') j.statuss = 'piešķirts'; (byBrig[j.brigade] = byBrig[j.brigade] || []).push(j); });
    if (jobs.length) await X.db.batch(jobs.map(j => X.st('UPDATE jobs SET publicets = ?, statuss = ? WHERE id = ?', j.publicets, j.statuss, j.id)));
    const crews = await X.crews(r.date);
    Object.keys(byBrig).forEach(b => {
      const list = byBrig[b], who = (crews[b] || []).join(', ');
      X.notify([b], 'Plāns ' + lvDate(r.date) + ' · ' + list.length + ' obj.', (who ? who + ' — ' : '') + list.slice(0, 3).map(j => j.adrese).join(', ') + (list.length > 3 ? ' +' + (list.length - 3) : ''));
    });
    return { published: jobs.length, sent: 0, whatsapp: await whatsapp(X, r.date) };
  },

  whatsapp: async (X, u, r) => { requireAdmin(u); await ensureStanding(X, r.date); return { whatsapp: await whatsapp(X, r.date) }; },

  done: async (X, u, r) => {
    const job = await X.job(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    await canMark(u, job);
    const ids = r.done ? await X.savePhotos(job, r.photos) : [];
    if (r.done) {
      job.statuss = 'izpildīts'; job.izpildits = now(); job.komentars = String(r.komentars || '').trim();
      job.foto = split(job.foto).concat(ids).join(','); job.iemesls = ''; job.parbaude = '';
    } else { job.statuss = job.brigade ? 'piešķirts' : 'jauns'; job.izpildits = ''; job.iemesls = ''; }
    await updJob(X, job).run();
    if (r.done && job.vaditajs && job.vaditajs !== u.name) X.notify([job.vaditajs], '✓ Izpildīts · ' + job.brigade, job.adrese + (job.komentars ? ' — ' + job.komentars : '') + (ids.length ? ' 📷' + ids.length : ''));
    return { job };
  },

  cantDo: async (X, u, r) => {
    const job = await X.job(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    await canMark(u, job);
    const reason = String(r.iemesls || '').trim();
    if (!reason) throw new Error('Norādi iemeslu');
    job.statuss = 'nevar izpildīt'; job.iemesls = reason; job.izpildits = now();
    await updJob(X, job).run();
    const to = await X.names('admin');
    if (job.vaditajs && to.indexOf(job.vaditajs) === -1) to.push(job.vaditajs);
    X.notify(to.filter(n => n !== u.name), '⚠ Nevar izpildīt · ' + job.brigade, job.adrese + ' — ' + reason);
    return { job };
  },

  saveToken: async (X, u, r) => {
    if (!r.token) throw new Error('Nav tokena');
    await X.run('INSERT INTO tokens (token, name, device, updated) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET name = excluded.name, device = excluded.device, updated = excluded.updated',
      String(r.token), u.name, String(r.device || ''), now());
    return {};
  },

  review: async (X, u, r) => {
    const job = await X.job(r.id);
    if (!job) throw new Error('Darbs nav atrasts');
    if (u.role !== 'admin' && job.vaditajs !== u.name) throw new Error('Nav atļauts');
    if (r.ok) { if (job.statuss !== 'izpildīts') throw new Error('Pieņemt var tikai izpildītu darbu'); job.parbaude = 'pieņemts'; job.parbKom = ''; }
    else if (r.undo) { job.parbaude = ''; job.parbKom = ''; }
    else {
      const kom = String(r.komentars || '').trim();
      if (!kom) throw new Error('Uzrakstiet, kas jāizlabo');
      job.parbaude = 'atgriezts'; job.parbKom = kom + ' — ' + u.name; job.statuss = job.brigade ? 'piešķirts' : 'jauns'; job.izpildits = '';
    }
    await updJob(X, job).run();
    return { job };
  },

  history: async (X, u, r) => {
    const k = norm(r.adrese);
    if (!k) throw new Error('Nav adreses');
    let list = (await X.all('SELECT * FROM jobs WHERE anorm = ? ORDER BY datums DESC, izveidots DESC', k)).map(jobOut);
    if (u.role === 'vaditajs') list = list.filter(j => j.vaditajs === u.name);
    const probs = (await X.all('SELECT id, laiks, adrese, vaditajs, vieniba, apraksts, foto, statuss, atrisinats FROM problems WHERE anorm = ? ORDER BY seq DESC LIMIT 20', k))
      .filter(p => u.role === 'admin' || p.vaditajs === u.name || !p.vaditajs);
    return { total: list.length, jobs: list.slice(0, 60), problems: probs };
  },

  problems: async (X, u) => ({ problems: await problems(X, u) }),

  stopStanding: async (X, u, r) => {
    const st = (await readStanding(X)).find(x => x.id === String(r.serija));
    if (!st) throw new Error('Aizvietošana nav atrasta');
    if (!allowedStand(u, st)) throw new Error('Nav atļauts');
    const last = String(r.last || '');
    if (!isDate(last)) throw new Error('Norādiet pēdējo dienu');
    const del = await X.all("SELECT id FROM jobs WHERE serija = ? AND datums > ? AND statuss != 'izpildīts' AND statuss != 'nevar izpildīt'", st.id, last);
    await X.db.batch([X.st('UPDATE standing SET beigas = ? WHERE id = ?', last, st.id)].concat(del.map(d => X.st('DELETE FROM jobs WHERE id = ?', d.id))));
    return { deleted: del.length, standing: await standingFor(X, u) };
  },

  problemDone: async (X, u, r) => {
    const p = await X.first('SELECT * FROM problems WHERE id = ?', String(r.id));
    if (!p) throw new Error('Ziņojums nav atrasts');
    if (u.role !== 'admin' && p.vaditajs && p.vaditajs !== u.name) throw new Error('Nav atļauts');
    await X.run("UPDATE problems SET statuss = 'atrisināts', atrisinats = ? WHERE id = ?", now() + ' ' + u.name, p.id);
    return { problems: await problems(X, u) };
  },

  testPush: async (X, u) => { X.notify([u.name], 'Darbu sadale', 'Paziņojumi strādā ✓'); return { sent: 1 }; },

  /** Admins: tūlīt pārlasīt lietotājus, darbu veidus un objektus no tabulas */
  syncConfig: async (X, u) => { requireAdmin(u); return await syncConfig(X); }
};

/* ---------------- Brigāžu skats (bez PIN) ---------------- */

/* Brigāžu saite: ?k=<atslēga> (kv teamKey). Bez tās — tikai skatīšanās, bez piekļuves kodiem. */
async function teamKey(X) {
  const r = await X.first("SELECT v FROM kv WHERE k = 'teamKey'"); if (r && r.v) return r.v;
  const k = crypto.randomUUID().replace(/-/g, '').slice(0, 20); await X.run("INSERT OR IGNORE INTO kv (k, v) VALUES ('teamKey', ?)", k);
  return (await X.first("SELECT v FROM kv WHERE k = 'teamKey'")).v;
}
async function teamOk(X, r) { if (r.key && r.key === await teamKey(X)) return true; return !!(r.pin && await X.auth(r.pin)); }
async function teamView(X, r, full) {
  const date = String(r.date || '');
  if (!isDate(date)) throw new Error('Nav datuma');
  await ensureStanding(X, date);
  const [units, all, objs, users, types] = await Promise.all([X.units(date), X.jobsOn(date), X.objects(), X.users(), X.types()]);
  const jobs = all.filter(j => j.brigade).map(j => ({ id: j.id, datums: j.datums, adrese: j.adrese, tips: j.tips, apraksts: j.apraksts, vaditajs: j.vaditajs,
    brigade: j.brigade, statuss: j.statuss, lidz: j.lidz, prombutne: j.prombutne, foto: j.foto, komentars: j.komentars, iemesls: j.iemesls, izpildits: j.izpildits,
    steidzami: j.steidzami, laiks: j.laiks, parbaude: j.parbaude, parbKom: j.parbKom }));
  const addrs = new Set(jobs.map(j => norm(j.adrese)));
  return { date, units, jobs, canEdit: !!full, meta: { objects: objs.filter(o => addrs.has(norm(o.adrese))).map(o => full ? o : Object.assign({}, o, { piekluve: '' })), managers: users.filter(x => x.role === 'vaditajs').map(x => ({ name: x.name, color: x.color })), colors: await peopleColors(X), jobTypes: types } };
}

async function teamDone(X, r) {
  const job = await X.job(r.id);
  if (!job || !job.brigade) throw new Error('Darbs nav atrasts vai nav piešķirts vienībai');
  const ids = r.done ? await X.savePhotos(job, r.photos) : [];
  if (r.done) { job.statuss = 'izpildīts'; job.izpildits = now(); job.iemesls = ''; job.parbaude = ''; job.komentars = String(r.komentars || '').trim(); job.foto = split(job.foto).concat(ids).join(','); }
  else { job.statuss = 'piešķirts'; job.izpildits = ''; job.iemesls = ''; }
  await updJob(X, job).run();
  if (r.done) X.notify((await X.names('admin')).concat(job.vaditajs ? [job.vaditajs] : []), '✓ Izpildīts · ' + job.brigade,
    job.adrese + (job.komentars ? ' — ' + job.komentars : '') + (ids.length ? ' 📷' + ids.length : ''));
  return { job };
}

async function teamCant(X, r) {
  const job = await X.job(r.id);
  if (!job || !job.brigade) throw new Error('Darbs nav atrasts vai nav piešķirts vienībai');
  const reason = String(r.iemesls || '').trim();
  if (!reason) throw new Error('Norādiet iemeslu');
  job.statuss = 'nevar izpildīt'; job.iemesls = reason; job.izpildits = now();
  await updJob(X, job).run();
  X.notify((await X.names('admin')).concat(job.vaditajs ? [job.vaditajs] : []), '⚠ Nevar izpildīt · ' + job.brigade, job.adrese + ' — ' + reason);
  return { job };
}

async function teamProblem(X, r) {
  const adrese = String(r.adrese || '').trim(), teksts = String(r.teksts || '').trim();
  if (!adrese) throw new Error('Norādiet adresi');
  if (!teksts) throw new Error('Aprakstiet problēmu');
  const ids = await X.savePhotos({ datums: today(), adrese: adrese + ' problēma' }, r.photos);
  const mgr = (await X.objMgr())[norm(adrese)] || '';
  await X.run('INSERT INTO problems (id, laiks, adrese, anorm, vaditajs, vieniba, apraksts, foto, statuss, atrisinats, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    uid(), now(), adrese, norm(adrese), mgr, String(r.vieniba || '').slice(0, 120), teksts.slice(0, 2000), ids.join(','), 'jauns', '', seq());
  X.notify((await X.names('admin')).concat(mgr ? [mgr] : []), '⚠ Problēma · ' + adrese, teksts.slice(0, 140));
  return { saved: true };
}

/* ---------------- Sinhronizācija ar Google tabulu ---------------- */

/* ---------------- Pamatdati (viens saraksts visām lietotnēm) ---------------- */
async function masterImport(X) {
  const env = X.env, src = {};
  const g = async (app) => { const t = JSON.parse(await appGas(env, app, 'getLists', '[]')); if (!t.ok) throw new Error(app + ': ' + t.error); return t.result; };
  src.izv = await g('izv'); src.kais = await g('kais');
  const pc = await X.first("SELECT v FROM kv WHERE k LIKE 'pers:%:login:%' LIMIT 1");
  try { const o = pc && JSON.parse(pc.v); if (o && o.meta && o.meta.lists) src.pers = o.meta.lists; } catch (e) {}
  const r = await importMaster(X.db, src);
  X.c = {};
  return r;
}
async function pushMaster(X) {
  const env = X.env, M = await master(X.db), pl = legacyPayload(M);
  const objPush = (await kvGet(X.db, 'objPush')) === '1';   // «SH | Dati» → Objekti ir galvenā: pārraksta tikai pēc labojuma portālā
  if (!objPush) delete pl.aizv.objects;
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('masterDirty', '0')");
  if (objPush) await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('objPush', '0')");
  try {
    await X.bridge('master', pl.aizv, 90000);
    for (const app of ['izv', 'kais']) { if (app === 'kais' && await kais.isNative(env)) continue; const t = JSON.parse(await appGas(env, app, 'setLists', JSON.stringify([pl[app]]))); if (!t.ok) throw new Error(app + ': ' + t.error); }
  } catch (e) { await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('masterDirty', '1')"); if (objPush) await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('objPush', '1')"); throw e; }
  await Promise.all([appRefresh(env, 'izv', 'getBoot').catch(() => 0), (await kais.isNative(env)) ? 0 : appRefresh(env, 'kais', 'getInitialData').catch(() => 0)]);
}
const masterDirty = (X, obj) => { X.bg((async () => { if (obj) await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('objPush', '1')"); await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('masterDirty', '1')"); await pushMaster(X); })()); };
/** Portāla administrēšana: pamatdati */
async function masterAdmin(X, a, b, me) {
  const db = X.db;
  if (a === 'master') return Object.assign({ ok: true }, await master(db));
  if (a === 'import') { const r = await masterImport(X); X.bg(pushMaster(X)); X.bg(pushPeople(X, await people(db))); return Object.assign({ ok: true, imported: r }, await master(db)); }
  if (a === 'saveObjects') { const list = (b.objects || []).filter(o => o && String(o.adrese || '').trim()); if (!list.length) return { ok: false, error: 'Saraksts ir tukšs' };
    await db.batch(objectsStmts(db, list, await personCanon(db))); X.c = {}; masterDirty(X, 1); return Object.assign({ ok: true }, await master(db)); }
  if (a === 'saveCompanies') { const list = (b.companies || []).filter(c => c && String(c.name || '').trim());
    const had = (await master(db)).companies.length; if (had && (!list.length || (had >= 10 && list.length < had * 0.5))) return { ok: false, error: 'Uzņēmumu saraksts sarucis no ' + had + ' uz ' + list.length + ' — nesaglabāju. Atjaunojiet lapu un mēģiniet vēlreiz.' };
    const pw = list.filter(c => c.pass).map(c => String(c.pass).trim().toUpperCase()); if (new Set(pw).size !== pw.length) return { ok: false, error: 'Divām firmām ir vienāda parole' };
    await db.batch(companiesStmts(db, list)); masterDirty(X); return Object.assign({ ok: true }, await master(db)); }
  if (a === 'saveLists') { const cnt = (L) => Object.keys(L || {}).reduce((n, k) => n + ((L[k] || []).length), 0), had = cnt((await master(db)).lists), now = cnt(b.lists);
    if (had && (!now || (had >= 10 && now < had * 0.5))) return { ok: false, error: 'Saraksti saruka no ' + had + ' uz ' + now + ' vērtībām — nesaglabāju. Atjaunojiet lapu.' };
    await db.batch(listsStmts(db, b.lists || {})); masterDirty(X); return Object.assign({ ok: true }, await master(db)); }
  if (a === 'saveTypes') { const list = (b.types || []).filter(t => t && t.name); if (!list.length) return { ok: false, error: 'Saraksts ir tukšs' };
    await db.batch(typesStmts(db, list)); X.c = {}; masterDirty(X); return Object.assign({ ok: true }, await master(db)); }
  if (a === 'reviewResolve') { const r = await resolveReview(db, +b.i, b.keep === 0 || b.keep === 1 ? b.keep : -1); if (!r.ok) return r;
    X.c = {}; if (r.people) await peopleSaved(X, await people(db)); masterDirty(X, !r.people); return Object.assign({ ok: true }, await master(db)); }
  if (a === 'saveGroups') { const list = (b.groups || []).filter(g => g && String(g.name || '').trim());
    await db.batch(groupsStmts(db, list)); X.c = {}; masterDirty(X); return Object.assign({ ok: true }, await master(db)); }
  if (a === 'reviewAutoPrefix') { const r = await autoMergePrefixed(db); X.c = {}; masterDirty(X, 1); return Object.assign({ ok: true }, r, await master(db)); }
  if (a === 'reviewClearInfo') { const n = await clearInfoReview(db); masterDirty(X); return Object.assign({ ok: true, cleared: n }, await master(db)); }
  if (a === 'saveReview') { await db.batch([kvSet(db, 'masterReview', JSON.stringify(b.review || []))]); masterDirty(X); return Object.assign({ ok: true }, await master(db)); }
  return null;
}

/** Portālā saglabātās pilnvaras: D1 uzreiz, Google tabulā (lapas «Pilnvaras» un «Lietotaji») fonā */
async function peopleSaved(X, list) {
  await X.db.batch([...peopleStmts(X.db, list), ...usersStmts(X.db, (list || []).map(p => Object.assign({}, p, { perms: p.perms || {} })))]);
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('peopleDirty', '1')");
  X.bg(pushPeople(X, await people(X.db)));
  if ((await kvGet(X.db, 'masterMode')) === '1') masterDirty(X);
}
async function pushPeople(X, list) {
  await X.bridge('people', { people: list.map(p => ({ name: p.name, pin: p.pin, color: p.color || '', active: !!p.active, perms: p.perms || {} })) }, 60000);
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('peopleDirty', '0')");
}

/* ---------- «SH | Dati» → Objekti ir galvenais objektu saraksts. © VAITKEVIX, SIA
   Cron salīdzina tabulu ar D1 un plānu saglabā kv «objPlan». Ja kv «objSheet» = '1', plānu izpilda:
   pārsauktām adresēm (tā pati adrese bez prefiksa, piem. «AB …», «J | …») pārnes visus saistītos ierakstus; izņemtās adreses
   pazūd no sarakstiem, bet to vēsture (darbi, apmeklējumi) paliek. ---------- */
const OBJ_REF = { av: ['jobs', 'problems', 'pl_visit', 'logi_visit', 'darz_visit', 'stav_visit', 'sniegs_visit'], a: ['standing'],
  n: ['pl_obj', 'logi_obj', 'darz_obj', 'stav_obj', 'sniegs_obj', 'client_obj', 'dl_obj', 'dl_worker', 'dl_mark', 'dl_sms'] };
const objCore = (s) => norm(String(s || '').replace(/^\s*[A-ZĀČĒĢĪĶĻŅŠŪŽ]{1,4}\s*\|\s*/, '').replace(/^[A-ZĀČĒĢĪĶĻŅŠŪŽ]{2,3}\s+(?=\S)/, '')).replace(/[\s,]+/g, '');
async function sheetObjects(X, rows) {
  const canon = await personCanon(X.db), seen = new Set(), list = [];
  rows.forEach(o => { const a = cleanAddr(o.adrese), k = norm(a); if (!a || seen.has(k)) return; seen.add(k);
    list.push({ k, adrese: a, vaditajs: canon(o.vaditajs || ''), grupa: o.grupa || 'SH objekti', piekluve: o.piekluve || '' }); });
  const cur = await X.all('SELECT anorm, adrese, vaditajs, grupa, piekluve FROM objects');
  const curK = new Set(cur.map(o => o.anorm)), newK = new Set(list.map(o => o.k));
  const added = list.filter(o => !curK.has(o.k)), gone = cur.filter(o => !newK.has(o.anorm));
  const changed = list.filter(o => { const c = cur.find(x => x.anorm === o.k); return c && (c.adrese !== o.adrese || c.vaditajs !== o.vaditajs || c.grupa !== o.grupa || c.piekluve !== o.piekluve); }).length;
  const ren = [], removed = [];
  gone.forEach(g => { const c = objCore(g.adrese), m = added.filter(a => objCore(a.adrese) === c);
    if (m.length === 1 && !ren.some(r => r[1] === m[0].adrese)) ren.push([g.adrese, m[0].adrese]); else removed.push(g.adrese); });
  const plan = { t: now(), sheet: list.length, d1: cur.length, changed, renamed: ren, removed, added: added.filter(a => !ren.some(r => r[1] === a.adrese)).map(a => a.adrese) };
  const bad = list.length < 10 || list.length < cur.length * 0.5;
  if (bad) plan.error = 'Tabulā ' + list.length + ' objekti (D1 ' + cur.length + ') — nepārnesu';
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('objPlan', ?)", JSON.stringify(plan));
  if (bad || (await kvGet(X.db, 'objSheet')) !== '1') return plan;
  if (!added.length && !gone.length && !changed) return plan;
  const st = [];
  ren.forEach(([o, n]) => { const ok = norm(o), nk = norm(n);
    OBJ_REF.av.forEach(t => st.push(X.st(`UPDATE OR IGNORE ${t} SET adrese = ?, anorm = ? WHERE anorm = ?`, n, nk, ok)));
    OBJ_REF.a.forEach(t => st.push(X.st(`UPDATE ${t} SET adrese = ? WHERE adrese = ?`, n, o)));
    OBJ_REF.n.forEach(t => st.push(X.st(`UPDATE OR IGNORE ${t} SET anorm = ? WHERE anorm = ?`, nk, ok))); });
  const G = await X.all('SELECT id, members FROM groups');
  G.forEach(g => { let m = []; try { m = JSON.parse(g.members || '[]'); } catch (e) {} let ch = 0;
    m = m.map(x => { const r = ren.find(y => norm(y[0]) === x); if (r) { ch = 1; return norm(r[1]); } return x; });
    if (ch) st.push(X.st('UPDATE groups SET members = ? WHERE id = ?', JSON.stringify(m), g.id)); });
  st.push(X.st('DELETE FROM objects'));
  list.forEach((o, i) => st.push(X.st('INSERT INTO objects (anorm, adrese, vaditajs, grupa, piekluve, ord) VALUES (?, ?, ?, ?, ?, ?)', o.k, o.adrese, o.vaditajs, o.grupa, o.piekluve, i)));
  await X.db.batch(st);
  X.c = {};
  plan.applied = now();
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('objPlan', ?)", JSON.stringify(plan));
  if (ren.length || removed.length) await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", 'objLog:' + plan.applied, JSON.stringify({ renamed: ren, removed, before: cur }));
  return plan;
}

/** Lietotāji, darbu veidi un objekti — galvenais saraksts paliek tabulā */
async function syncConfig(X) {
  if (await noGoogle(X.db)) return { skipped: 'noGoogle' };
  const r = await X.bridge('config', {}, 60000);
  // Lietotāji un pilnvaras: galvenais saraksts ir portālā (D1). Pirmo reizi ņem no tabulas.
  let ppl = await people(X.db);
  if (!ppl.length && (r.users || []).length) { ppl = seedFrom(r.users); await X.db.batch(peopleStmts(X.db, ppl)); await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('peopleDirty', '1')"); }
  const mm = (await kvGet(X.db, 'masterMode')) === '1';   // pamatdati jau portālā → tabulu nepārraksta D1
  const st = [...usersStmts(X.db, ppl)];
  if (!mm) {
    st.push(X.st('DELETE FROM types'), X.st('DELETE FROM objects'));
    (r.types || []).forEach((t, i) => st.push(X.st('INSERT OR REPLACE INTO types (name, grp, ord) VALUES (?, ?, ?)', t.name, t.group || 'Papilddarbs', i)));
    (r.objects || []).forEach((o, i) => st.push(X.st('INSERT OR REPLACE INTO objects (anorm, adrese, vaditajs, grupa, piekluve, ord) VALUES (?, ?, ?, ?, ?, ?)', norm(o.adrese), o.adrese, o.vaditajs || '', o.grupa || 'SH objekti', o.piekluve || '', i)));
  }
  if (!(r.users || []).length) throw new Error('Tabulā nav lietotāju — sinhronizācija atcelta');
  await X.db.batch(st);
  if (mm && (await kvGet(X.db, 'objPush')) !== '1') {
    let objs = r.objects || [];
    if (X.env.GOOGLE_SA) {   // tieši no Google Sheets API (bez Apps Script); ja neizdodas — GAS dati
      try { objs = await gsheets.objekti(X.env); await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('sheetsApi', ?)", 'ok ' + now() + ' · ' + objs.length + ' objekti'); }
      catch (e) { await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('sheetsApi', ?)", 'kļūda ' + now() + ' · ' + String(e.message || e)); }
    }
    await sheetObjects(X, objs).catch(e => console.error('sheetObjects', e));
  }
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('configSync', ?)", now());
  const dirty = await X.first("SELECT v FROM kv WHERE k = 'peopleDirty'");
  if (dirty && dirty.v === '1') await pushPeople(X, ppl).catch(e => console.error('pushPeople', e));
  // pirmais imports tikai ar admina pogu (Administrēšana), ne automātiski no cron
  if ((await kvGet(X.db, 'masterDirty')) === '1') await pushMaster(X).catch(e => console.error('pushMaster', e));
  return { users: (r.users || []).length, types: (r.types || []).length, objects: (r.objects || []).length };
}

/** Datu izsniegšana pa lapām Apps Script nakts kopijai (mirrorFromCloudflare) */
/** Nakts kopija D1 → «SH | Dati» (agrāk GAS mirrorFromCloudflare). Reizi dienā pēc 02:00, kv «mirrorDay». © VAITKEVIX, SIA */
const MIRROR = [['jobs', 'Aizvietošana · Darbi', ['ID', 'Datums', 'Adrese', 'Tips', 'Apraksts', 'Vaditajs', 'Brigade', 'Statuss', 'Publicets', 'Izpildits', 'Izveidots', 'Komentars', 'Foto', 'Iemesls', 'Lidz', 'Serija', 'Prombutne', 'Steidzami', 'Laiks', 'Parbaude', 'ParbaudesKomentars']],
  ['crew', 'Aizvietošana · Sastāvs', ['Datums', 'Brigade', 'Personas']], ['staff', 'Aizvietošana · Darbinieki', ['Vards', 'Pamatbrigade']],
  ['problems', 'Aizvietošana · Problēmas', ['ID', 'Laiks', 'Adrese', 'Vaditajs', 'Vieniba', 'Apraksts', 'Foto', 'Statuss', 'Atrisinats']],
  ['standing', 'Aizvietošana · Pastāvīgie', ['ID', 'Adrese', 'Tips', 'Apraksts', 'Vaditajs', 'Prombutne', 'No', 'Beigas', 'Brivdienas', 'Steidzami', 'Laiks', 'Foto', 'Izlaistas', 'Izveidots']]];
async function mirrorSheets(X, force) {
  if (!X.env.GOOGLE_SA || await noGoogle(X.db)) return;
  const t = now(), day = t.slice(0, 10);
  if (!force && (t.slice(11, 13) < '02' || (await kvGet(X.db, 'mirrorDay')) === day)) return;
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('mirrorDay', ?)", day);
  const out = [];
  for (const [tb, tab, head] of MIRROR) { const e = EXPORT[tb]; out.push(await gsheets.mirror(X.env, tab, head, (await X.all(e[0])).map(e[1]), day)); }
  await X.run("INSERT OR REPLACE INTO kv (k, v) VALUES ('mirrorLog', ?)", t + ' ' + out.map(o => o.tab + ' ' + o.rows).join(', '));
  return out;
}
const EXPORT = {
  jobs: ['SELECT * FROM jobs ORDER BY seq', j => JOB_F.map(f => j[f] || '')],
  crew: ['SELECT * FROM crew ORDER BY id', c => [c.datums, c.name, c.persons]],
  staff: ['SELECT * FROM staff ORDER BY ord, name', s => [s.name, s.brigade]],
  tokens: ['SELECT * FROM tokens ORDER BY name', t => [t.name, t.token, t.device, t.updated]],
  problems: ['SELECT * FROM problems ORDER BY seq', p => [p.id, p.laiks, p.adrese, p.vaditajs, p.vieniba, p.apraksts, p.foto, p.statuss, p.atrisinats]],
  standing: ['SELECT * FROM standing ORDER BY seq', s => [s.id, s.adrese, s.tips, s.apraksts, s.vaditajs, s.prombutne, s.no, s.beigas, s.brivdienas, s.steidzami, s.laiks, s.foto, s.izlaistas, s.izveidots]]
};
async function exportTable(X, r) {
  checkKey(X.env, r.key);
  const e = EXPORT[r.table]; if (!e) throw new Error('Nezināma tabula');
  const lim = Math.min(Number(r.limit) || 500, 1000), off = Number(r.offset) || 0;
  const rows = await X.all(e[0] + ' LIMIT ? OFFSET ?', lim + 1, off);
  return { rows: rows.slice(0, lim).map(e[1]), more: rows.length > lim };
}

/** Vienreizēja (vai atkārtota) datu pārnešana no tabulas: Apps Script funkcija exportToCloudflare() */
async function importAll(X, r) {
  checkKey(X.env, r.key);
  const d = r.data || {};
  const st = [];
  if (r.reset) ['jobs', 'crew', 'staff', 'tokens', 'problems', 'standing', 'users', 'types', 'objects'].forEach(t => st.push(X.st('DELETE FROM ' + t)));
  let n = 0; const base = Date.now() * 100;
  (d.users || []).forEach((u, i) => st.push(X.st('INSERT OR REPLACE INTO users (name, role, pin, color, ord) VALUES (?, ?, ?, ?, ?)', u.name, u.role, u.pin, u.color || '', i)));
  (d.types || []).forEach((t, i) => st.push(X.st('INSERT OR REPLACE INTO types (name, grp, ord) VALUES (?, ?, ?)', t.name, t.group || 'Papilddarbs', i)));
  (d.objects || []).forEach((o, i) => st.push(X.st('INSERT OR REPLACE INTO objects (anorm, adrese, vaditajs, grupa, piekluve, ord) VALUES (?, ?, ?, ?, ?, ?)', norm(o.adrese), o.adrese, o.vaditajs || '', o.grupa || 'SH objekti', o.piekluve || '', i)));
  (d.staff || []).forEach((s, i) => st.push(X.st('INSERT OR REPLACE INTO staff (name, brigade, ord) VALUES (?, ?, ?)', s.name, s.brigade || '', i)));
  (d.crew || []).forEach(c => st.push(X.st('INSERT INTO crew (datums, name, persons) VALUES (?, ?, ?)', c.datums, c.name, c.persons || '')));
  (d.tokens || []).forEach(t => st.push(X.st('INSERT OR REPLACE INTO tokens (token, name, device, updated) VALUES (?, ?, ?, ?)', t.token, t.name, t.device || '', t.updated || '')));
  (d.jobs || []).forEach(j => { n++; const v = JOB_F.map(f => j[f] == null ? '' : String(j[f]));
    st.push(X.st(`INSERT OR REPLACE INTO jobs (${JOB_F.join(',')}, anorm, seq) VALUES (${JOB_F.map(() => '?').join(',')}, ?, ?)`, ...v, norm(j.adrese), base + n)); });
  (d.problems || []).forEach(p => { n++; st.push(X.st('INSERT OR REPLACE INTO problems (id, laiks, adrese, anorm, vaditajs, vieniba, apraksts, foto, statuss, atrisinats, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    p.id, p.laiks || '', p.adrese || '', norm(p.adrese), p.vaditajs || '', p.vieniba || '', p.apraksts || '', p.foto || '', p.statuss || 'jauns', p.atrisinats || '', base + n)); });
  (d.standing || []).forEach(s => { n++; st.push(X.st('INSERT OR REPLACE INTO standing (id, adrese, tips, apraksts, vaditajs, prombutne, no, beigas, brivdienas, steidzami, laiks, foto, izlaistas, izveidots, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    s.id, s.adrese, s.tips || '', s.apraksts || '', s.vaditajs || '', s.prombutne || '', s.no || '', s.beigas || '', s.brivdienas ? '1' : '', s.steidzami ? '1' : '', s.laiks || '', s.foto || '', (s.izlaistas || []).join ? s.izlaistas.join(',') : String(s.izlaistas || ''), s.izveidots || '', base + n)); });
  if (r.reset && st.length > 900) throw new Error('Atiestatīšanai pārāk daudz ierakstu (' + st.length + ') vienā partijā — dati netika dzēsti. Importējiet bez reset.');
  if (r.reset) await X.db.batch(st);   // DELETE + ieraksti vienā darījumā: vai nu viss, vai nekas
  else for (let i = 0; i < st.length; i += 400) await X.db.batch(st.slice(i, i + 400));
  return { imported: { jobs: (d.jobs || []).length, crew: (d.crew || []).length, objects: (d.objects || []).length, users: (d.users || []).length, problems: (d.problems || []).length, standing: (d.standing || []).length } };
}
