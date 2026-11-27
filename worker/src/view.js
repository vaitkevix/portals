/* SH | Skats klientam / pārvaldniekam: saite vaitkevix.cloud/sh/skats.html#<atslēga> — tikai lasīšana, tikai šī klienta objekti,
 * izpildītie darbi pa mēnešiem ar bildēm. Bez cenām un darbinieku vārdiem. Atslēgu izveido/atsauc portāla admins (Klienti).
 * kv view:<atslēga> = klienta id;  kv viewTok:<klienta id> = atslēga.   © VAITKEVIX, SIA */
import { report, UNITS } from './klienti.js';
import { today } from './util.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, CORS) });
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const TOK = /^[a-f0-9]{24}$/;
const ids = (s) => String(s || '').split(/[\s,]+/).map(x => { const m = /[?&]id=([\w-]{20,80})/.exec(x) || /\/d\/([\w-]{20,80})/.exec(x); return m ? m[1] : /^[\w-]{20,80}$/.test(x) ? x : ''; }).filter(Boolean).slice(0, 6);

/** GET /view?k=<atslēga>&ym=YYYY-MM */
export async function viewApi(request, env, url) {
  if (request.method !== 'GET') return out({ ok: false, error: 'Tikai GET' }, 405);
  const k = url.searchParams.get('k') || '';
  if (!TOK.test(k)) return out({ ok: false, error: 'Nederīga saite' }, 404);
  const cid = await kvGet(env.DB, 'view:' + k);
  const c = cid && await env.DB.prepare('SELECT id, name, aktivs FROM clients WHERE id = ?').bind(cid).first();
  if (!c || !c.aktivs) return out({ ok: false, error: 'Saite vairs nav derīga' }, 404);
  const t = today(), cur = t.slice(0, 7);
  let ym = url.searchParams.get('ym') || cur;
  if (!/^\d{4}-\d{2}$/.test(ym) || ym > cur) ym = cur;
  const min = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5) - 25, 1)).toISOString().slice(0, 7);   // 24 mēneši atpakaļ
  if (ym < min) ym = min;
  const R = await report(env.DB, c.id, ym);
  const objekti = ((await env.DB.prepare('SELECT o.adrese FROM client_obj c JOIN objects o ON o.anorm = c.anorm WHERE c.client = ? ORDER BY o.adrese').bind(c.id).all()).results || []).map(r => r.adrese);
  return out({
    ok: true, client: c.name, ym, min, max: cur, objekti,
    rows: R.rows.map(r => ({ app: r.app, name: UNITS[r.app].name, unit: UNITS[r.app].unit, datums: r.datums, adrese: r.adrese, daudz: r.daudz, piez: r.piez || '', foto: ids(r.foto) })),
    sum: R.sum.map(s => ({ app: s.app, name: s.name, unit: s.unit, reizes: s.reizes, daudz: s.daudz })),
  });
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
