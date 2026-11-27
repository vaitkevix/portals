/* SH | I6 Kvalitātes pārbaude: «Pārbaudīt vakardienu» — ~10 % nejauši izvēlēti vakardienas izpildītie darbi (grafiki + aizvietošana) ar bildēm.
 * Iepriekš atzīmē aizdomīgos: nav bildes, tā pati bilde citā darbā (bildes id vai R2 etag = satura hash), AI (izplūdusi / nav redzams objekts; kešs qc.ai, limits aiLimit 'qc').
 * Vadītājs ✓ / ✗ + vērtējums 1–5; ✗ → E3 pretenzija (tabula claim) automātiski. Statistika pa izpildītājiem. Klienta skatā — atzīme «pārbaudīts». © VAITKEVIX, SIA */
import { today, addDays, nowStr, uid, lvD } from './util.js';
import { aiContent, aiJson, aiLimit, imgPart } from './ai.js';
import { thumbR2 } from './thumb.js';
import { audit } from './audit.js';
import { notify, personNames } from './webpush.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
export const QC_APPS = [['pl', 'pl_visit', 'Zāles pļaušana'], ['logi', 'logi_visit', 'Logu mazgāšana'], ['darz', 'darz_visit', 'Dārzniecība'], ['stav', 'stav_visit', 'Stāvvietas'], ['sniegs', 'sniegs_visit', 'Sniega tīrīšana']];
const NAME = Object.fromEntries(QC_APPS.map(x => [x[0], x[2]]).concat([['aizv', 'Aizvietošana']]));
/** bilžu id no lauka (csv / URL ar ?id=) */
export const ids = (v) => String(v || '').split(/[\s,]+/).map(x => { const m = /[?&]id=([\w-]{20,80})/.exec(x); return m ? m[1] : /^[\w-]{20,80}$/.test(x) ? x : ''; }).filter(Boolean);
const parse = (s) => { try { return JSON.parse(s || 'null'); } catch (e) { return null; } };

/** Visi izpildītie darbi dienā d ar bildēm: [{ app, visit, anorm, adrese, izp, foto:[], pirms:[] }] */
async function doneOn(db, d) {
  const L = [];
  for (const [app, T] of QC_APPS) {
    const R = await all(db, `SELECT * FROM ${T} WHERE datums = ? AND statuss = 'done'`, d).catch(() => []);
    R.forEach(v => L.push({ app, visit: v.id, anorm: v.anorm, adrese: v.adrese, izp: v.izpilditajs || v.brigade || '', foto: ids(v.foto), pirms: ids(v.foto_pirms) }));
  }
  (await all(db, "SELECT id, anorm, adrese, brigade, foto FROM jobs WHERE datums = ? AND statuss = 'izpildīts'", d).catch(() => []))
    .forEach(j => L.push({ app: 'aizv', visit: j.id, anorm: j.anorm, adrese: j.adrese, izp: j.brigade || '', foto: ids(j.foto), pirms: [] }));
  return L;
}
/** Bilžu lietojums pēdējās 60 dienās: id → skaits darbu */
async function photoUse(db, d) {
  const M = {}, from = addDays(d, -60), add = (k, v) => ids(v).forEach(id => { (M[id] = M[id] || new Set()).add(k); });
  for (const [app, T] of QC_APPS) (await all(db, `SELECT id, foto FROM ${T} WHERE datums >= ? AND datums <= ? AND foto != ''`, from, addDays(d, 1)).catch(() => [])).forEach(r => add(app + ':' + r.id, r.foto));
  (await all(db, "SELECT id, foto FROM jobs WHERE datums >= ? AND datums <= ? AND foto != ''", from, addDays(d, 1)).catch(() => [])).forEach(r => add('aizv:' + r.id, r.foto));
  return M;
}
const etag = async (env, id) => { if (!env.FOTO || !/^r2-/.test(id)) return ''; try { const h = await env.FOTO.head(id); return h ? String(h.etag || h.httpEtag || '').replace(/"/g, '') : ''; } catch (e) { return ''; } };

/** Izveido (vai atdod esošo) dienas paraugu. Atkārtoti — tas pats paraugs. */
export async function sample(env, d) {
  const db = env.DB;
  const have = await all(db, 'SELECT * FROM qc WHERE datums = ? ORDER BY app, adrese', d);
  if (have.length) return have;
  const L = await doneOn(db, d); if (!L.length) return [];
  const n = Math.min(15, Math.max(3, Math.ceil(L.length * 0.1)));
  const pick = L.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  const use = await photoUse(db, d), tags = {};
  for (const x of pick) {
    const fl = [];
    if (!x.foto.length) fl.push('nav bildes');
    if (x.foto.some(id => use[id] && use[id].size > 1)) fl.push('tā pati bilde citā darbā');
    if (x.pirms.length && x.foto.some(id => x.pirms.indexOf(id) !== -1)) fl.push('pirms = pēc');
    const e = await etag(env, x.foto[0] || ''); if (e) { if (tags[e]) fl.push('tāda pati bilde kā ' + tags[e]); else tags[e] = x.adrese; }
    if (e && !fl.some(f => /tā pati|tāda pati/.test(f))) {   // salīdzina ar iepriekšējo šī objekta darbu tajā pašā lietotnē
      const T = (QC_APPS.find(a => a[0] === x.app) || [])[1];
      const prev = T ? await db.prepare(`SELECT foto FROM ${T} WHERE anorm = ? AND datums < ? AND statuss = 'done' AND foto != '' ORDER BY datums DESC LIMIT 1`).bind(x.anorm, d).first().catch(() => null)
        : await db.prepare("SELECT foto FROM jobs WHERE anorm = ? AND datums < ? AND statuss = 'izpildīts' AND foto != '' ORDER BY datums DESC LIMIT 1").bind(x.anorm, d).first().catch(() => null);
      const pe = prev ? await etag(env, ids(prev.foto)[0] || '') : ''; if (pe && pe === e) fl.push('tāda pati bilde kā iepriekšējā reizē');
    }
    await db.prepare('INSERT OR IGNORE INTO qc (id, datums, app, visit, anorm, adrese, izpilditajs, foto, pirms, flags, izveidots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uid(), d, x.app, x.visit, x.anorm || '', x.adrese, x.izp, x.foto.slice(0, 4).join(','), x.pirms.slice(0, 2).join(','), JSON.stringify(fl), nowStr()).run();
  }
  return all(db, 'SELECT * FROM qc WHERE datums = ? ORDER BY app, adrese', d);
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function imgData(env, id) {
  if (!env.FOTO || !/^r2-/.test(id)) return '';
  let t = await thumbR2(env, id, 'w600').catch(() => null), bytes, type = 'image/jpeg';
  if (t) { bytes = t.body instanceof Uint8Array ? t.body : new Uint8Array(await new Response(t.body).arrayBuffer()); type = t.type; }
  else { const o = await env.FOTO.get(id); if (!o) return ''; bytes = new Uint8Array(await o.arrayBuffer()); type = (o.httpMetadata && o.httpMetadata.contentType) || type; if (bytes.length > 3.5e6) return ''; }
  return 'data:' + type + ';base64,' + b64(bytes);
}
/** AI atzīme vienam parauga darbam (ja vēl nav). Atgriež { izpludusi, nav_objekta, aizdomas } vai null */
export async function aiOne(env, row) {
  const db = env.DB; if (row.ai) return parse(row.ai);
  if (!env.ANTHROPIC_API_KEY) return null;
  const id = ids(row.foto)[0]; if (!id) return null;
  const data = await imgData(env, id); if (!data) return null;
  await aiLimit(db, 'qc', 40);
  const txt = 'Darba izpildes bilde: ' + (NAME[row.app] || row.app) + ', ' + row.adrese + '. Novērtē TIKAI bildi. Atgriez JSON {"izpludusi": true|false (izplūdusi, ļoti tumša vai nesaprotama), "nav_objekta": true|false (nav redzama ēka/teritorija/telpa/zāliens, kas atbilst darbam, piem. ekrānuzņēmums vai bilde no ekrāna), "aizdomas": "≤ 12 vārdi latviski vai tukšs"}.';
  const j = aiJson(await aiContent(env, [imgPart(data), { type: 'text', text: txt }], 200));
  const res = j ? { izpludusi: !!j.izpludusi, nav_objekta: !!j.nav_objekta, aizdomas: String(j.aizdomas || '').slice(0, 120) } : { kluda: 'AI neatbildēja' };
  await db.prepare('UPDATE qc SET ai = ? WHERE id = ?').bind(JSON.stringify(res), row.id).run();
  return res;
}
/** Fonā: AI visiem parauga darbiem bez AI (līdz 15) */
export async function aiAll(env, d) {
  for (const r of await all(env.DB, "SELECT * FROM qc WHERE datums = ? AND ai = '' AND foto != ''", d)) { try { await aiOne(env, r); } catch (e) { console.error('qc ai', e); if (/limits/.test(e.message)) break; } }
}

const mineSet = async (db, name) => new Set((await all(db, 'SELECT anorm FROM objects WHERE vaditajs = ?', name)).map(r => r.anorm));
const out = (r) => Object.assign({}, r, { flags: parse(r.flags) || [], ai: parse(r.ai), foto: ids(r.foto), pirms: ids(r.pirms), name: NAME[r.app] || r.app });

/** Saraksts vadītājam (savi objekti) vai adminam (visi) + statistika 90 dienās */
export async function list(env, me, isAdmin, d, ctx) {
  const db = env.DB; d = /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : addDays(today(), -1);
  const S = await sample(env, d), mine = isAdmin ? null : await mineSet(db, me.name);
  if (env.ANTHROPIC_API_KEY && S.some(r => !r.ai && r.foto) && ctx && ctx.waitUntil) ctx.waitUntil(aiAll(env, d).catch(() => 0));
  const L = S.filter(r => !mine || mine.has(r.anorm)).map(out);
  const st = {}; (await all(db, "SELECT izpilditajs, verdict, vert FROM qc WHERE verdict != '' AND datums >= ?", addDays(today(), -90))).forEach(r => {
    const k = r.izpilditajs || '—', x = st[k] || (st[k] = { izp: k, n: 0, ok: 0, bad: 0, vs: 0, vn: 0 }); x.n++; if (r.verdict === 'ok') x.ok++; else x.bad++; if (r.vert) { x.vs += r.vert; x.vn++; } });
  const stats = Object.values(st).map(x => ({ izp: x.izp, n: x.n, ok: x.ok, bad: x.bad, vid: x.vn ? Math.round(x.vs / x.vn * 10) / 10 : null })).sort((a, b) => b.n - a.n).slice(0, 40);
  return { datums: d, list: L, stats, ai: !!env.ANTHROPIC_API_KEY };
}
/** ✓ / ✗ + vērtējums. ✗ → pretenzija (claim), ja vēl nav atvērtas */
export async function set(env, me, isAdmin, b) {
  const db = env.DB, r = await db.prepare('SELECT * FROM qc WHERE id = ?').bind(String(b.id || '')).first(); if (!r) throw new Error('Nav atrasts');
  if (!isAdmin && !(await mineSet(db, me.name)).has(r.anorm)) throw new Error('Pārbaudīt var savos objektos');
  const v = b.verdict === 'ok' || b.verdict === 'bad' ? b.verdict : '', vert = Math.max(0, Math.min(5, Math.round(+b.vert || 0))), piez = String(b.piez || '').replace(/[<>]/g, '').trim().slice(0, 500);
  if (!v) throw new Error('Izvēlieties ✓ vai ✗');
  if (v === 'bad' && piez.length < 3) throw new Error('Uzrakstiet, kas nav kārtībā (aizies kā pretenzija)');
  let claim = r.claim;
  if (v === 'bad' && !claim && !(await db.prepare("SELECT 1 FROM claim WHERE app = ? AND visit = ? AND statuss = 'atverta'").bind(r.app, r.visit).first())) {
    claim = uid();
    await db.prepare('INSERT INTO claim (id, app, visit, anorm, adrese, datums, teksts, foto, kas, laiks, izpilditajs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(claim, r.app, r.visit, r.anorm, r.adrese, r.datums, 'Kvalitātes pārbaude: ' + piez, '', me.name, nowStr(), r.izpilditajs).run();
    const to = await personNames(env, [r.izpilditajs, String(r.izpilditajs || '').split(' · ')[0]]).catch(() => []);
    await notify(env, to, { title: '⚠ Pretenzija · ' + (NAME[r.app] || r.app), body: r.adrese + ' (' + lvD(r.datums) + '): ' + piez.slice(0, 100), url: '/sh/#' + r.app, urgent: true }).catch(() => 0);
  }
  await db.prepare('UPDATE qc SET verdict = ?, vert = ?, piez = ?, kas = ?, laiks = ?, claim = ? WHERE id = ?').bind(v, vert, piez, me.name, nowStr(), claim || '', r.id).run();
  await audit(db, me.name, 'Kvalitātes pārbaude', r.adrese, [['Vērtējums ' + lvD(r.datums), r.verdict ? (r.verdict === 'ok' ? '✓' : '✗') + (r.vert ? ' ' + r.vert : '') : '', (v === 'ok' ? '✓' : '✗') + (vert ? ' ' + vert : '') + (piez ? ' — ' + piez.slice(0, 80) : '')]]);
  return out(await db.prepare('SELECT * FROM qc WHERE id = ?').bind(r.id).first());
}
/** Klienta skatam: «pārbaudīts» (✓) darbi mēnesī — kopa 'app:visit' */
export async function okSet(db, ym) { return new Set((await all(db, "SELECT app, visit FROM qc WHERE verdict = 'ok' AND datums LIKE ?", ym + '%').catch(() => [])).map(r => r.app + ':' + r.visit)); }
