/* SH | «Mājas darbi» iedzīvotājiem: publiska lapa vaitkevix.cloud/sh/maja.html#<atslēga> — nākamo 30 dienu plānotie darbi
 * (pļaušana, logi, dārzs, pazemes stāvvietas ar «izbrauciet līdz…») un vadītāja brīdinājumi (ml_notice). Bez vārdiem, tālruņiem, kodiem, cenām.
 * kv maja:<atslēga> = objekta anorm;  kv majaTok:<anorm> = atslēga. Atslēgu izveido/atsauc portāla admins.  © VAITKEVIX, SIA */
import { today, addDays, nowStr, anorm } from './util.js';
import { planOf } from './view.js';
import { audit } from './audit.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, CORS) });
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const TOK = /^[a-f0-9]{24}$/;
const isoD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';

/** GET /maja?k=<atslēga> */
export async function majaApi(request, env, url) {
  if (request.method !== 'GET') return out({ ok: false, error: 'Tikai GET' }, 405);
  const k = url.searchParams.get('k') || '';
  if (!TOK.test(k)) return out({ ok: false, error: 'Nederīga saite' }, 404);
  const cache = typeof caches !== 'undefined' ? caches.default : null, ck = new Request('https://cache.sh/maja/' + k);
  const hit = cache && await cache.match(ck); if (hit) return hit;
  const an = await kvGet(env.DB, 'maja:' + k);
  const o = an && await env.DB.prepare('SELECT anorm, adrese FROM objects WHERE anorm = ?').bind(an).first();
  if (!o) { await new Promise(r => setTimeout(r, 400)); return out({ ok: false, error: 'Saite vairs nav derīga' }, 404); }
  const t = today(), to = addDays(t, 30);
  const plan = (await planOf(env.DB, [o.anorm], 30)).map(r => ({ app: r.app, datums: r.datums, no: r.no, lidz: r.lidz }));
  const notices = ((await env.DB.prepare("SELECT teksts, no, lidz FROM ml_notice WHERE anorm = ? AND (lidz = '' OR lidz >= ?) AND (no = '' OR no <= ?) ORDER BY no, izveidots").bind(o.anorm, t, to).all().catch(() => ({ results: [] }))).results || []);
  const res = out({ ok: true, adrese: o.adrese, today: t, plan, notices });
  const cr = res.clone(), h = new Headers(cr.headers); h.set('Cache-Control', 'max-age=300');
  if (cache) await cache.put(ck, new Response(cr.body, { status: 200, headers: h }));
  return res;
}

/* ---------- admins (portāls → Administrēšana → Mājas lapas) ---------- */
export async function majaAdmin(env, a, b, who) {
  const db = env.DB;
  if (a === 'majaList') {
    const tokens = {}; for (const r of (await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'majaTok:%'").all()).results || []) tokens[r.k.slice(8)] = r.v;
    const cnt = {}; for (const r of (await db.prepare("SELECT anorm, COUNT(*) n FROM ml_notice WHERE lidz = '' OR lidz >= ? GROUP BY anorm").bind(today()).all().catch(() => ({ results: [] }))).results || []) cnt[r.anorm] = r.n;
    return { tokens, notices: cnt };
  }
  const k = anorm(b.anorm || b.adrese);
  const o = k && await db.prepare('SELECT anorm, adrese FROM objects WHERE anorm = ?').bind(k).first();
  if (!o && a !== 'majaNoticeDel') throw new Error('Objekts nav atrasts');
  if (a === 'majaLink') {
    const old = await kvGet(db, 'majaTok:' + o.anorm);
    if (b.revoke) { if (old) await db.batch([db.prepare('DELETE FROM kv WHERE k = ?').bind('maja:' + old), db.prepare('DELETE FROM kv WHERE k = ?').bind('majaTok:' + o.anorm)]); await audit(db, who, 'Mājas lapa', o.adrese, ['saite', 'ir', 'atsaukta']); return { token: '' }; }
    if (old) return { token: old };
    const tok = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
    await db.batch([db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('maja:' + tok, o.anorm), db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('majaTok:' + o.anorm, tok)]);
    await audit(db, who, 'Mājas lapa', o.adrese, ['saite', '', 'izveidota']);
    return { token: tok };
  }
  if (a === 'majaNotices') return { list: ((await db.prepare('SELECT * FROM ml_notice WHERE anorm = ? ORDER BY no DESC, izveidots DESC LIMIT 100').bind(o.anorm).all().catch(() => ({ results: [] }))).results || []) };
  if (a === 'majaNoticeSave') {
    const tx = String(b.teksts || '').replace(/[<>]/g, '').trim().slice(0, 500), no = isoD(b.no), lidz = isoD(b.lidz);
    if (tx.length < 3) throw new Error('Ierakstiet brīdinājuma tekstu');
    if (no && lidz && lidz < no) throw new Error('«Līdz» ir pirms «no»');
    const id = /^[a-f0-9]{10}$/.test(String(b.id || '')) ? b.id : crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    await db.prepare('INSERT INTO ml_notice (id, anorm, teksts, no, lidz, kas, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET teksts = excluded.teksts, no = excluded.no, lidz = excluded.lidz, kas = excluded.kas')
      .bind(id, o.anorm, tx, no, lidz, who, nowStr()).run();
    await audit(db, who, 'Mājas lapa', o.adrese, ['brīdinājums', '', tx.slice(0, 80) + (no || lidz ? ' (' + (no || '…') + ' – ' + (lidz || '…') + ')' : '')]);
    return { list: ((await db.prepare('SELECT * FROM ml_notice WHERE anorm = ? ORDER BY no DESC, izveidots DESC LIMIT 100').bind(o.anorm).all()).results || []) };
  }
  if (a === 'majaNoticeDel') {   // noņemt = beidzies
    const r = await db.prepare('SELECT * FROM ml_notice WHERE id = ?').bind(String(b.id || '')).first(); if (!r) throw new Error('Nav atrasts');
    await db.prepare('UPDATE ml_notice SET lidz = ? WHERE id = ?').bind(addDays(today(), -1), r.id).run();   // nedzēš — beidzas vakar (vēsture paliek)
    await audit(db, who, 'Mājas lapa', r.anorm, ['brīdinājums', r.teksts.slice(0, 80), 'noņemts']);
    return { list: ((await db.prepare('SELECT * FROM ml_notice WHERE anorm = ? ORDER BY no DESC, izveidots DESC LIMIT 100').bind(r.anorm).all()).results || []) };
  }
  throw new Error('Nezināma darbība');
}
