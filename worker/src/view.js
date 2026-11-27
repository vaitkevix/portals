/* SH | Skats klientam / pārvaldniekam: saite vaitkevix.cloud/sh/skats.html#<atslēga> — tikai lasīšana, tikai šī klienta objekti,
 * izpildītie darbi pa mēnešiem ar bildēm. Bez cenām un darbinieku vārdiem. Atslēgu izveido/atsauc portāla admins (Klienti).
 * kv view:<atslēga> = klienta id;  kv viewTok:<klienta id> = atslēga.   © VAITKEVIX, SIA */
import { report, UNITS, firma } from './klienti.js';
import { today, addDays, nowStr, anorm, akey, splitAddr } from './util.js';
import * as F from './foto.js';
import { notify, managers } from './webpush.js';
import { audit } from './audit.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, CORS) });
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const TOK = /^[a-f0-9]{24}$/;
const ids = (s) => String(s || '').split(/[\s,]+/).map(x => { const m = /[?&]id=([\w-]{20,80})/.exec(x) || /\/d\/([\w-]{20,80})/.exec(x); return m ? m[1] : /^[\w-]{20,80}$/.test(x) ? x : ''; }).filter(Boolean).slice(0, 6);

/** GET /view?k=<atslēga>&ym=YYYY-MM */
export async function viewApi(request, env, url) {
  if (request.method === 'POST') return viewPost(request, env);
  if (request.method !== 'GET') return out({ ok: false, error: 'Tikai GET' }, 405);
  const k = url.searchParams.get('k') || '';
  const c = await clientOf(env.DB, k);
  if (!c) return out({ ok: false, error: 'Saite vairs nav derīga' }, 404);
  if (url.searchParams.get('plan')) return planned(env, k, c);
  const t = today(), cur = t.slice(0, 7);
  let ym = url.searchParams.get('ym') || cur;
  if (!/^\d{4}-\d{2}$/.test(ym) || ym > cur) ym = cur;
  const min = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5) - 25, 1)).toISOString().slice(0, 7);   // 24 mēneši atpakaļ
  if (ym < min) ym = min;
  const cache = typeof caches !== 'undefined' ? caches.default : null, ck = new Request('https://cache.sh/view/' + k + '/' + ym);   // 5 min kešs — publiska saite, nedauzām D1
  const hit = cache && await cache.match(ck); if (hit) return hit;
  const R = await report(env.DB, c.id, ym);
  const objekti = ((await env.DB.prepare('SELECT o.adrese FROM client_obj c JOIN objects o ON o.anorm = c.anorm WHERE c.client = ? ORDER BY o.adrese').bind(c.id).all()).results || []).map(r => r.adrese);
  // rinda → klienta objekts (filtram): precīzi, pēc akey, vai apvienotā objekta māja
  const byA = {}, byK = {}; objekti.forEach(a => { byA[anorm(a)] = a; const kk = akey(a); if (kk && !byK[kk]) byK[kk] = a; splitAddr(a).forEach(x => { const pk = akey(x.adrese); if (pk && !byK[pk]) byK[pk] = a; }); });
  const objOf = (adr) => byA[anorm(adr)] || byK[akey(adr)] || adr;
  const res = out({
    ok: true, client: c.name, ym, min, max: cur, objekti, pin: !!c.view_pin, reqApps: REQ_APPS,
    rows: R.rows.filter(r => r.app !== 'ligums').map(r => ({ app: r.app, name: UNITS[r.app].name, unit: UNITS[r.app].unit, datums: r.datums, adrese: r.adrese, obj: objOf(r.adrese), daudz: r.daudz, piez: r.pub || '', foto: ids(r.foto) })),
    sum: Object.values(R.sum.filter(s => s.app !== 'ligums').reduce((m, s) => { const x = m[s.app] = m[s.app] || { app: s.app, name: s.name, unit: s.unit, reizes: 0, daudz: 0 }; x.reizes += s.reizes; x.daudz = Math.round((x.daudz + s.daudz) * 100) / 100; return m; }, {})),
  });
  const cr = res.clone(), h = new Headers(cr.headers); h.set('Cache-Control', 'max-age=300');
  if (cache) await cache.put(ck, new Response(cr.body, { status: 200, headers: h }));
  return res;
}

/** Admins: izveido (vai atdod esošo) / atsauc klienta saiti */
export async function viewLink(db, clientId, revoke) {
  if (!clientId || !await db.prepare('SELECT 1 FROM clients WHERE id = ?').bind(clientId).first()) throw new Error('Klients nav atrasts');
  const old = await kvGet(db, 'viewTok:' + clientId);
  if (revoke) { if (old) await db.batch([db.prepare('DELETE FROM kv WHERE k = ?').bind('view:' + old), db.prepare('DELETE FROM kv WHERE k = ?').bind('viewTok:' + clientId)]); return { token: '' }; }
  if (old) return { token: old };
  const tok = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  await db.batch([db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('view:' + tok, clientId), db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('viewTok:' + clientId, tok)]);
  return { token: tok };
}
export async function viewTokens(db) {
  const m = {}; for (const r of (await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'viewTok:%'").all()).results || []) m[r.k.slice(8)] = r.v; return m;
}

/* ---------- kopīgi ---------- */
async function clientOf(db, k) {
  if (!TOK.test(String(k || ''))) return null;
  const cid = await kvGet(db, 'view:' + k);
  const c = cid && await db.prepare('SELECT id, name, aktivs, view_pin FROM clients WHERE id = ?').bind(cid).first().catch(() => null);
  return c && c.aktivs ? c : null;
}
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('view|' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 40); }
const objsOf = async (db, cid) => ((await db.prepare('SELECT o.anorm, o.adrese, o.vaditajs FROM client_obj c JOIN objects o ON o.anorm = c.anorm WHERE c.client = ? ORDER BY o.adrese').bind(cid).all()).results || []);
/* Atomārs skaitītājs kv (diena / logs): atgriež jauno vērtību */
async function bump(db, key, winMs) {
  const t = Date.now();
  const r = await db.prepare("INSERT INTO kv (k, v) VALUES (?1, json_object('n', 1, 't', ?2)) ON CONFLICT(k) DO UPDATE SET v = CASE WHEN json_valid(v) AND ?2 - json_extract(v, '$.t') < ?3 THEN json_set(v, '$.n', json_extract(v, '$.n') + 1) ELSE json_object('n', 1, 't', ?2) END RETURNING v")
    .bind(key, t, winMs).first();
  try { return JSON.parse(r.v).n; } catch (e) { return 1; }
}
async function peek(db, key, winMs) { try { const v = JSON.parse((await kvGet(db, key)) || 'null'); return v && Date.now() - v.t < winMs ? v.n : 0; } catch (e) { return 0; } }
const ipOf = (request) => (request.headers.get('CF-Connecting-IP') || '').slice(0, 64);

/* ---------- E6: plānotie darbi 30 dienās (bez brigādēm / izpildītājiem) ---------- */
export const PLAN_T = [['pl', 'pl_visit'], ['logi', 'logi_visit'], ['darz', 'darz_visit'], ['stav', 'stav_visit']];
export async function planOf(db, anorms, days) {
  const t = today(), to = addDays(t, days || 30), set = [...new Set(anorms)].filter(Boolean), outR = [];
  if (!set.length) return outR;
  for (const [app, T] of PLAN_T) for (let i = 0; i < set.length; i += 80) {
    const ch = set.slice(i, i + 80);
    const rows = ((await db.prepare(`SELECT * FROM ${T} WHERE statuss = 'plan' AND datums >= ? AND datums <= ? AND anorm IN (${ch.map(() => '?').join(',')}) ORDER BY datums`).bind(t, to, ...ch).all().catch(() => ({ results: [] }))).results || []);
    rows.forEach(r => outR.push({ app, name: UNITS[app].name, datums: r.datums, adrese: r.adrese, anorm: r.anorm, no: r.laiks_no || '', lidz: r.laiks_lidz || '' }));
  }
  return outR.sort((a, b) => a.datums.localeCompare(b.datums) || a.adrese.localeCompare(b.adrese));
}
async function planned(env, k, c) {
  const cache = typeof caches !== 'undefined' ? caches.default : null, ck = new Request('https://cache.sh/view/' + k + '/plan');
  const hit = cache && await cache.match(ck); if (hit) return hit;
  const O = await objsOf(env.DB, c.id);
  const res = out({ ok: true, plan: (await planOf(env.DB, O.map(o => o.anorm), 30)).map(({ anorm: _, ...r }) => r) });
  const cr = res.clone(), h = new Headers(cr.headers); h.set('Cache-Control', 'max-age=300');
  if (cache) await cache.put(ck, new Response(cr.body, { status: 200, headers: h }));
  return res;
}

/* ---------- E5 pieteikums, E7 rēķini — POST /view { k, action, … } ---------- */
export const REQ_APPS = { logi: 'Logu mazgāšana', darz: 'Dārzniecība', stav: 'Pazemes stāvvietas', pl: 'Zāles pļaušana', sniegs: 'Sniega tīrīšana', izv: 'Izvešana (lapas, zari)', kais: 'Kaisāmmateriāls', uzk: 'Uzkopšana', cits: 'Cits' };
const REQ_DAY = 10, PIN_MAX = 5, PIN_WIN = 15 * 60 * 1000, MAX_PHOTO = 2 * 1024 * 1024;
const AUTO = { logi: ['logi_visit', 'logi'], darz: ['darz_visit', 'darz'], stav: ['stav_visit', 'pazemes'] };   // vienkāršs pieteikums → lietotnes vienreizējs darbs
async function viewPost(request, env) {
  const db = env.DB;
  if (+(request.headers.get('Content-Length') || 0) > 3.2e6) return out({ ok: false, error: 'Pieprasījums par lielu (bilde līdz 2 MB)' }, 413);
  const txt = await request.text(); if (txt.length > 3.2e6) return out({ ok: false, error: 'Pieprasījums par lielu (bilde līdz 2 MB)' }, 413);
  let b; try { b = JSON.parse(txt); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const c = await clientOf(db, b.k);
  if (!c) { await new Promise(r => setTimeout(r, 500)); return out({ ok: false, error: 'Saite vairs nav derīga' }, 404); }
  try {
    if (b.action === 'req') return out(await clientRequest(env, request, c, b));
    if (b.action === 'inv' || b.action === 'invOne') {
      if (!c.view_pin) return out({ ok: false, error: 'Rēķinu skatīšana nav ieslēgta — sazinieties ar SELECTUM HOME' });
      const pk = 'vp:' + b.k;
      if (await peek(db, pk, PIN_WIN) >= PIN_MAX) return out({ ok: false, error: 'Pārāk daudz nepareizu mēģinājumu — mēģiniet pēc 15 min', code: 'rate' }, 429);
      const pin = String(b.pin || '').trim();
      if (!/^\d{4,6}$/.test(pin) || await sha(c.id + '|' + pin) !== c.view_pin) { await bump(db, pk, PIN_WIN); await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN', code: 'pin' }); }
      if (b.action === 'inv') {
        const L = ((await db.prepare("SELECT nr, ym, datums, termins, summa, pvn, ar_pvn, statuss, apm_summa FROM invoice WHERE client = ? AND statuss != 'anulēts' ORDER BY datums DESC, nr DESC LIMIT 36").bind(c.id).all()).results || []);
        const t = today();
        return out({ ok: true, list: L.map(r => ({ nr: r.nr, ym: r.ym, datums: r.datums, termins: r.termins, summa: r.summa, pvn: r.pvn, ar_pvn: r.ar_pvn, statuss: r.statuss,
          atlikums: r.statuss === 'apmaksāts' ? 0 : Math.round((r.ar_pvn - (r.apm_summa || 0)) * 100) / 100, kave: r.statuss !== 'apmaksāts' && r.termins && r.termins < t })) });
      }
      const r = await db.prepare("SELECT * FROM invoice WHERE client = ? AND nr = ? AND statuss != 'anulēts'").bind(c.id, String(b.nr || '')).first();
      if (!r) return out({ ok: false, error: 'Rēķins nav atrasts' });
      let d = {}; try { d = JSON.parse(r.dati || '{}'); } catch (e) {}
      const cl = d.client || {}, Fm = await firma(db);
      return out({ ok: true, invoice: { nr: r.nr, ym: r.ym, datums: r.datums, termins: r.termins, summa: r.summa, pvn: r.pvn, ar_pvn: r.ar_pvn, statuss: r.statuss,
        client: { name: cl.name || r.klients, regnr: cl.regnr || '', adrese: cl.adrese || '', liguma_nr: cl.liguma_nr || '' },
        sum: (d.sum || []).map(x => ({ name: x.name, unit: x.unit, reizes: x.reizes, daudz: x.daudz, cena: x.cena, summa: x.summa })) },
        firma: { nosaukums: Fm.nosaukums, regnr: Fm.regnr || '', pvnnr: Fm.pvnnr || '', adrese: Fm.adrese || '', banka: Fm.banka || '', iban: Fm.iban || '', swift: Fm.swift || '', epasts: Fm.epasts || '', talrunis: Fm.talrunis || '' } });
    }
    return out({ ok: false, error: 'Nezināma darbība' }, 400);
  } catch (e) { return out({ ok: false, error: String(e && e.message || e) }); }
}
async function clientRequest(env, request, c, b) {
  const db = env.DB, t = today();
  const app = String(b.app || ''); if (!REQ_APPS[app]) throw new Error('Izvēlieties pakalpojumu');
  const O = await objsOf(db, c.id), o = O.find(x => x.adrese === String(b.adrese || ''));
  if (!o) throw new Error('Izvēlieties objektu no saraksta');
  const apr = String(b.apraksts || '').replace(/\s+\n/g, '\n').trim();
  if (apr.length < 3) throw new Error('Aprakstiet, kas jādara'); if (apr.length > 1000) throw new Error('Apraksts par garu (līdz 1000 zīmēm)');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') ? b.datums : '';
  if (d && (d < t || d > addDays(t, 180))) throw new Error('Vēlamais datums — no šodienas līdz 6 mēnešiem');
  let foto = '';
  if (b.foto) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.foto));
    if (!m) throw new Error('Bildei jābūt JPG, PNG vai WEBP');
    if (m[2].length * 0.75 > MAX_PHOTO) throw new Error('Bilde par lielu (līdz 2 MB)');
  }
  // ātruma limits: 10 pieteikumi dienā vienai saitei, 20 vienai IP adresei
  const kd = 'vq:' + b.k + ':' + t, ip = ipOf(request), ki = 'vqi:' + ip + ':' + t;
  if (await peek(db, kd, 864e5) >= REQ_DAY || (ip && await peek(db, ki, 864e5) >= 2 * REQ_DAY)) throw Object.assign(new Error('Šodien pieteikumu limits sasniegts (10). Mēģiniet rīt vai zvaniet SELECTUM HOME.'), { code: 'rate' });
  await bump(db, kd, 864e5); if (ip) await bump(db, ki, 864e5);
  if (b.foto) foto = await F.put(env, String(b.foto), { app: 'klients', client: c.id });
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12), now = nowStr();
  let visit = '';
  const A = AUTO[app];
  if (A) {   // objektam šis pakalpojums ir → vienreizējs darbs lietotnē (vadītājs redz «pieteikums», piešķir brigādi)
    const on = await db.prepare('SELECT ' + A[1] + ' v FROM obj_info WHERE anorm = ?').bind(o.anorm).first().catch(() => null);
    if (on && on.v) {
      visit = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
      await db.prepare(`INSERT INTO ${A[0]} (id, anorm, adrese, datums, brigade, avots, termins, steidzami, apraksts, dati, prio, pieteica, laiks_no, laiks_lidz, izveidots, foto_pirms) VALUES (?, ?, ?, ?, '', 'pieteikums', ?, 0, ?, '{}', 0, ?, '', '', ?, ?)`)
        .bind(visit, o.anorm, o.adrese, d || t, d, ('Klienta pieteikums: ' + apr).slice(0, 500), ('Klients: ' + c.name).slice(0, 80), now, foto).run().catch(e => { console.error('client req visit', e); visit = ''; });
    }
  }
  await db.prepare('INSERT INTO client_req (id, client, klients, adrese, anorm, app, datums, apraksts, foto, statuss, visit, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, c.id, c.name, o.adrese, o.anorm, app, d, apr, foto, visit ? 'lietotnē' : 'jauns', visit, now).run();
  try {
    const mApp = ['logi', 'darz', 'stav', 'pl', 'sniegs', 'izv', 'kais'].indexOf(app) !== -1 ? app : 'portal', to = (await managers(env, mApp)).concat(o.vaditajs ? [o.vaditajs] : []);
    await notify(env, to, { title: 'Klienta pieteikums: ' + REQ_APPS[app], body: o.adrese + ' — ' + apr.slice(0, 90) + ' (' + c.name + ')', url: visit ? '/sh/#' + app : '/sh/' });
  } catch (e) { console.error('client req push', e); }
  return { ok: true, id, lietotne: !!visit };
}

/* ---------- Admins: klientu pieteikumi, Skata PIN ---------- */
export const REQ_ST = ['jauns', 'lietotnē', 'pieņemts', 'izpildīts', 'noraidīts'];
export async function clientReqs(db, st) {
  const L = ((await db.prepare('SELECT * FROM client_req ORDER BY izveidots DESC LIMIT 300').all().catch(() => ({ results: [] }))).results || []);
  return { list: st ? L.filter(r => r.statuss === st) : L, apps: REQ_APPS, st: REQ_ST, jauni: L.filter(r => r.statuss === 'jauns').length };
}
export async function clientReqSet(db, b, who) {
  const r = await db.prepare('SELECT * FROM client_req WHERE id = ?').bind(String(b.id || '')).first(); if (!r) throw new Error('Pieteikums nav atrasts');
  const st = REQ_ST.indexOf(b.statuss) !== -1 ? b.statuss : r.statuss, pz = String(b.piezime != null ? b.piezime : r.piezime).slice(0, 300);
  await db.prepare('UPDATE client_req SET statuss = ?, piezime = ?, apstr = ? WHERE id = ?').bind(st, pz, who + ' · ' + nowStr(), r.id).run();
  await audit(db, who, 'Klientu pieteikumi', r.klients + ' · ' + r.adrese, [['Statuss', r.statuss, st]].concat(pz !== r.piezime ? [['Piezīme', r.piezime, pz]] : []).filter(x => x[1] !== x[2]));
}
export async function setViewPin(db, clientId, pin, who) {
  const c = await db.prepare('SELECT name FROM clients WHERE id = ?').bind(clientId).first(); if (!c) throw new Error('Klients nav atrasts');
  pin = String(pin || '').trim();
  if (pin && !/^\d{4,6}$/.test(pin)) throw new Error('Skata PIN — 4 līdz 6 cipari');
  if (pin && /^(\d)\1+$/.test(pin)) throw new Error('PIN par vienkāršu');
  await db.prepare('UPDATE clients SET view_pin = ? WHERE id = ?').bind(pin ? await sha(clientId + '|' + pin) : '', clientId).run();
  await audit(db, who, 'Klienti', c.name, ['Skata PIN (rēķini)', '', pin ? 'iestatīts' : 'noņemts']);
}
