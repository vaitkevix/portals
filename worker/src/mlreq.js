/* SH | Pieteikumi par māju (tabula ml_req): I3 iedzīvotāji caur QR mājas lapu (maja.html «Ziņot par problēmu») un
 * I4 darbinieki «Pamanīju bojājumu» (grafika lietotnes, Aizvietošana, SMS «BOJ <kods> <teksts>»).
 * Publiski: POST /maja {action:'req', k, …} (limiti pēc IP un mājas atslēgas; kontakts tikai ar piekrišanu, publiski NEKAD netiek rādīts),
 * GET /maja?r=<pieteikuma atslēga> — tikai statuss (bez teksta, bez kontakta). AI kategorija + steidzamība — pēc izvēles (kv mlreq:ai = '1', kešs pēc teksta).
 * Mājas lietā: cilne «Pieteikumi» — statusi jauns / darbā / atrisināts un «Izveidot darbu» (aizvietošana vai logi/darz/stav/pl pieteikums). © VAITKEVIX, SIA */
import { today, nowStr, uid, anorm, lvD, kv, kvSet } from './util.js';
import { notify, managers } from './webpush.js';
import { put as fotoPut } from './foto.js';
import { aiContent, aiJson, aiLimit, imgPart } from './ai.js';
import { audit } from './audit.js';

export const KAT = ['Tīrība / atkritumi', 'Bojājums', 'Apgaismojums', 'Durvis / slēdzene', 'Lifts', 'Ūdens / noplūde', 'Apkure', 'Teritorija / sniegs / ledus', 'Troksnis / kaimiņi', 'Cits'];
export const ST = ['jauns', 'darbā', 'atrisināts'];
export const JOB_APPS = { aizv: 'Aizvietošana (darbs)', logi: 'Logu mazgāšana', darz: 'Dārzniecība', stav: 'Pazemes stāvvietas', pl: 'Zāles pļaušana' };
const MAX_IMG = 2.8e6;   // ≈ 2 MB bilde base64
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const str = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n);
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mlreq|' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 24); }
const tok = () => [...crypto.getRandomValues(new Uint8Array(10))].map(x => x.toString(16).padStart(2, '0')).join('');

/** Dienas skaitītājs kv mreq:<datums>:<k> (atomārs +1); true, ja limits pārsniegts */
export async function over(db, k, max) {
  const key = 'mreq:' + today() + ':' + k;
  await db.prepare("INSERT INTO kv (k, v) VALUES (?, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT)").bind(key).run();
  const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first(); return +(r && r.v || 0) > max;
}
export async function cleanup(db) { await db.prepare("DELETE FROM kv WHERE k LIKE 'mreq:%' AND k < ?").bind('mreq:' + today()).run().catch(() => 0); }

/** Kopīgā ierakstīšana. p: { anorm, avots, kategorija, teksts, foto (dataURL), kontakts, piekrit, kas, app, visit } → { id, atslega } */
export async function create(env, p, bg) {
  const db = env.DB, o = await db.prepare('SELECT anorm, adrese, vaditajs FROM objects WHERE anorm = ?').bind(p.anorm).first();
  if (!o) throw new Error('Objekts nav atrasts');
  const tx = str(p.teksts, 1000); if (tx.length < 5) throw new Error('Aprakstiet problēmu (vismaz dažus vārdus)');
  const kat = KAT.indexOf(p.kategorija) !== -1 ? p.kategorija : '';
  let foto = p.fotoId ? String(p.fotoId).slice(0, 80) : '';   // jau saglabāta bilde (Aizvietošanas problēma)
  if (!foto && p.foto) {
    if (String(p.foto).length > MAX_IMG) throw new Error('Bilde par lielu (līdz 2 MB)');
    foto = await fotoPut(env, p.foto, { avots: 'ml_req', adrese: o.adrese }).catch(() => '');
  }
  const kontakts = p.piekrit ? str(p.kontakts, 120) : '';
  const id = uid(), atslega = tok();
  await db.prepare('INSERT INTO ml_req (id, atslega, anorm, adrese, avots, kategorija, teksts, foto, kontakts, piekrit, kas, laiks, atjaunots, app, visit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, atslega, o.anorm, o.adrese, p.avots === 'darbinieks' ? 'darbinieks' : 'iedzivotajs', kat, tx, foto, kontakts, kontakts ? 1 : 0, str(p.kas, 80), nowStr(), nowStr(), str(p.app, 10), str(p.visit, 40)).run();
  const job = (async () => {
    const ai = await classify(env, { id, teksts: tx, kategorija: kat, foto: p.avots === 'darbinieks' ? p.foto : '' }).catch(() => null);
    if (p.silent) return;   // push jau nosūtīts (Aizvietošanas problēma)
    const to = o.vaditajs ? [o.vaditajs] : await managers(env, 'ml');
    const steidz = ai && ai.steidz === 'augsta';
    await notify(env, to, { title: (steidz ? '⚡ ' : '') + (p.avots === 'darbinieks' ? 'Bojājums' : 'Iedzīvotāja pieteikums') + ' · ' + o.adrese,
      body: ((ai && ai.kategorija) || kat || 'Cits') + ': ' + tx.slice(0, 120) + (p.kas ? ' (' + str(p.kas, 40) + ')' : ''), url: '/sh/#ml', urgent: steidz }).catch(() => 0);
  })().catch(e => console.error('mlreq push', e));
  if (bg) bg(job); else await job;
  return { id, atslega, adrese: o.adrese };
}

/** AI kategorija + steidzamība (pēc izvēles: kv mlreq:ai = '1'). Kešs kv mlreq:aic:<hash(teksts)>; bilde — tikai darbinieka ziņojumam */
export async function classify(env, r) {
  const db = env.DB; if (!env.ANTHROPIC_API_KEY || (await kv(db, 'mlreq:ai')) !== 1) return null;
  const h = await sha(r.teksts + '|' + (r.foto ? String(r.foto).length : '')), ck = 'mlreq:aic:' + h;
  let res = await kv(db, ck);
  if (!res) {
    await aiLimit(db, 'mlreq', 60);
    const prompt = 'Mājas apsaimniekošanas pieteikums. Teksts: «' + r.teksts.slice(0, 800) + '»' + (r.kategorija ? ' (iesniedzējs izvēlējās: ' + r.kategorija + ')' : '') +
      '\nAtgriez TIKAI JSON {"kategorija": viena no ' + JSON.stringify(KAT) + ', "steidz": "zema"|"vidēja"|"augsta", "iemesls": "≤ 12 vārdi latviski"}. «augsta» — drošības risks, noplūde, nav apkures/gaismas, lifts stāv, ledus uz ietves.';
    let content = prompt;
    if (r.foto) { try { content = [imgPart(r.foto), { type: 'text', text: prompt }]; } catch (e) { content = prompt; } }
    const j = aiJson(await aiContent(env, content, 300));
    if (!j) return null;
    res = { kategorija: KAT.indexOf(j.kategorija) !== -1 ? j.kategorija : '', steidz: ['zema', 'vidēja', 'augsta'].indexOf(j.steidz) !== -1 ? j.steidz : '', iemesls: str(j.iemesls, 120) };
    await kvSet(db, ck, res).run();
  }
  await db.prepare("UPDATE ml_req SET steidz = ?, ai = ?, kategorija = CASE WHEN kategorija = '' OR kategorija = 'Cits' THEN ? ELSE kategorija END WHERE id = ?").bind(res.steidz, JSON.stringify(res), res.kategorija || '', r.id).run();
  return res;
}

/* ---------- publiski: maja.html ---------- */
export async function publicPost(request, env, ctx, json) {
  let b = {}; try { b = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  if (b.action !== 'req') return json({ ok: false, error: 'Nezināma darbība' }, 400);
  if (b.hp) return json({ ok: true, atslega: '' });   // slazds robotiem (slēpts lauks)
  const k = String(b.k || ''); if (!/^[a-f0-9]{24}$/.test(k)) return json({ ok: false, error: 'Nederīga saite' }, 404);
  const an = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('maja:' + k).first();
  if (!an) { await new Promise(r => setTimeout(r, 400)); return json({ ok: false, error: 'Saite vairs nav derīga' }, 404); }
  const ip = (request.headers.get('CF-Connecting-IP') || '').slice(0, 64);
  if (await over(env.DB, 'ip:' + await sha(ip), 5)) return json({ ok: false, error: 'Šodien no šīs ierīces jau saņemti vairāki pieteikumi — mēģiniet rīt vai zvaniet apsaimniekotājam' }, 429);
  if (await over(env.DB, 'k:' + k, 30)) return json({ ok: false, error: 'Šai mājai šodien jau saņemts daudz pieteikumu — mēģiniet vēlāk' }, 429);
  try {
    const r = await create(env, { anorm: an.v, avots: 'iedzivotajs', kategorija: b.kategorija, teksts: b.teksts, foto: b.foto, kontakts: b.kontakts, piekrit: !!b.piekrit }, ctx && ctx.waitUntil ? (p) => ctx.waitUntil(p) : null);
    return json({ ok: true, atslega: r.atslega });
  } catch (e) { return json({ ok: false, error: String(e.message || e) }); }
}
/** GET /maja?r=<atslēga> — statuss bez personas datiem un bez teksta */
export async function publicStatus(env, r, json) {
  if (!/^[a-f0-9]{20}$/.test(r)) return json({ ok: false, error: 'Nederīga saite' }, 404);
  const x = await env.DB.prepare('SELECT adrese, kategorija, statuss, laiks, atjaunots, atbilde FROM ml_req WHERE atslega = ?').bind(r).first();
  if (!x) { await new Promise(res => setTimeout(res, 400)); return json({ ok: false, error: 'Pieteikums nav atrasts' }, 404); }
  return json({ ok: true, req: { adrese: x.adrese, kategorija: x.kategorija || 'Cits', statuss: x.statuss, laiks: x.laiks, atjaunots: x.atjaunots, atbilde: x.atbilde } });
}

/* ---------- Mājas lieta: saraksts, statuss, «Izveidot darbu» ---------- */
const pub = (r, full) => ({ id: r.id, anorm: r.anorm, adrese: r.adrese, avots: r.avots, kategorija: r.kategorija, teksts: r.teksts, foto: r.foto, kontakts: full ? r.kontakts : (r.kontakts ? '•••' : ''), steidz: r.steidz,
  ai: (() => { try { return JSON.parse(r.ai || 'null'); } catch (e) { return null; } })(), statuss: r.statuss, kas: r.kas, laiks: r.laiks, atjaunots: r.atjaunots, apstr: r.apstr, darbs: r.darbs, atbilde: r.atbilde, app: r.app });
export async function list(db, k, mineSet, full) {
  const L = k ? await all(db, 'SELECT * FROM ml_req WHERE anorm = ? ORDER BY laiks DESC LIMIT 200', k).catch(() => [])
    : await all(db, "SELECT * FROM ml_req WHERE statuss != 'atrisināts' OR atjaunots >= date('now', '-14 day') ORDER BY laiks DESC LIMIT 400").catch(() => []);
  return L.filter(r => !mineSet || mineSet.has(r.anorm)).map(r => pub(r, full));
}
export async function setStatus(env, who, id, statuss, atbilde) {
  const db = env.DB, r = await db.prepare('SELECT * FROM ml_req WHERE id = ?').bind(String(id || '')).first(); if (!r) throw new Error('Pieteikums nav atrasts');
  const st = ST.indexOf(statuss) !== -1 ? statuss : r.statuss, at = atbilde == null ? r.atbilde : str(atbilde, 300);
  await db.prepare('UPDATE ml_req SET statuss = ?, atbilde = ?, apstr = ?, atjaunots = ? WHERE id = ?').bind(st, at, who, nowStr(), r.id).run();
  await audit(db, who, 'Mājas lieta', r.adrese, [['Pieteikums ' + (r.kategorija || ''), r.statuss, st], ['Atbilde iedzīvotājam', r.atbilde, at]].filter(x => x[1] !== x[2]));
  return r;
}
/** Izveido darbu citā lietotnē no pieteikuma: aizv → jobs (statuss 'jauns', vadītājs piešķir brigādi); logi/darz/stav/pl → vienreizējs pieteikums grafikā */
export async function makeJob(env, who, id, app, datums, tips) {
  const db = env.DB, r = await db.prepare('SELECT * FROM ml_req WHERE id = ?').bind(String(id || '')).first(); if (!r) throw new Error('Pieteikums nav atrasts');
  if (!JOB_APPS[app]) throw new Error('Izvēlieties lietotni');
  const t = today(), d = /^\d{4}-\d{2}-\d{2}$/.test(String(datums || '')) && datums >= t ? datums : t;
  const o = await db.prepare('SELECT anorm, adrese, vaditajs FROM objects WHERE anorm = ?').bind(r.anorm).first(); if (!o) throw new Error('Objekts nav atrasts');
  const apr = ((r.avots === 'darbinieks' ? 'Bojājums: ' : 'Iedzīvotājs: ') + (r.kategorija ? r.kategorija + ' — ' : '') + r.teksts).slice(0, 500), nid = uid();
  if (app === 'aizv') {
    const T = (await all(db, "SELECT name, grp FROM types ORDER BY ord").catch(() => [])), ok = T.find(x => x.name === tips && x.grp !== 'Aizvietošana') || T.find(x => x.grp === 'Papilddarbs') || T.find(x => x.grp !== 'Aizvietošana');
    if (!ok) throw new Error('Nav darbu veidu (Administrēšana → Saraksti)');
    await db.prepare("INSERT INTO jobs (id, datums, adrese, anorm, tips, apraksts, vaditajs, brigade, statuss, izveidots, foto, seq) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'jauns', ?, ?, ?)")
      .bind(nid, d, o.adrese, o.anorm, ok.name, apr, o.vaditajs || who, nowStr(), r.foto || '', Date.now() * 100).run();
  } else {
    const T = app + '_visit';
    await db.prepare(`INSERT INTO ${T} (id, anorm, adrese, datums, brigade, avots, termins, steidzami, apraksts, prio, pieteica, izveidots) VALUES (?, ?, ?, ?, '', 'pieteikums', '', ?, ?, ?, ?, ?)`)
      .bind(nid, o.anorm, o.adrese, d, r.steidz === 'augsta' ? 1 : 0, apr, r.steidz === 'augsta' ? 1 : 0, who, nowStr()).run();
  }
  await db.prepare("UPDATE ml_req SET statuss = 'darbā', darbs = ?, apstr = ?, atjaunots = ? WHERE id = ?").bind(app + ':' + nid, who, nowStr(), r.id).run();
  await audit(db, who, 'Mājas lieta', o.adrese, ['Pieteikums → darbs', r.kategorija || 'pieteikums', JOB_APPS[app] + ' ' + lvD(d)]);
  return { app, id: nid, datums: d };
}
