/* SH | I5 AI e-pasta kaste: pieteikumi@vaitkevix.cloud → Cloudflare Email Routing (route → Worker «sh-portals») → email() apstrādātājs.
 * Katra vēstule = MELNRAKSTS tabulā mail_draft (NEKAD automātiski darbs). Zināms sūtītājs (klientu / pārvaldnieku / Pilnvaru e-pasti vai kv mailbox:allow
 * adreses un @domēni) → bildes R2 + AI izvilkums (lietotne, adrese → objekts, darbs, termiņš; limits aiLimit 'mailbox'). Nezināms → statuss «nezinams», bez AI un pielikumiem.
 * Admins: Administrēšana → «E-pasta pieteikumi» — Apstiprināt (izveido pieteikumu lietotnē caur mlreq.createJob) vai Noraidīt. Nedzēš. © VAITKEVIX, SIA */
import { today, nowStr, uid, akey, kv, kvSet } from './util.js';
import { put as fotoPut } from './foto.js';
import { aiContent, aiJson, aiLimit } from './ai.js';
import { createJob, JOB_APPS } from './mlreq.js';
import { notify, managers } from './webpush.js';
import { audit } from './audit.js';

const appsAll = () => Object.assign({ izv: 'Izvešana (lapas, zari, bio)', kais: 'Kaisāmmateriāls (sāls, smilts)' }, JOB_APPS);   // funkcija — cikliskie importi (portal ↔ mlreq)
const MAX_RAW = 12e6, MAX_DAY = 200;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/* ---------- minimāls MIME parsētājs (multipart, base64, quoted-printable, RFC 2047 virsraksti) ---------- */
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
const bytesOf = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const dec = (u8, cs) => { try { return new TextDecoder(String(cs || 'utf-8').toLowerCase().replace(/^(us-ascii|ascii)$/, 'utf-8')).decode(u8); } catch (e) { return new TextDecoder().decode(u8); } };
const qp = (s) => bytesOf(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))));
const b64 = (s) => { try { return bytesOf(atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))); } catch (e) { return new Uint8Array(0); } };
export function hdrDecode(v) {
  return String(v || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, e, t) => dec(e.toUpperCase() === 'B' ? b64(t) : qp(t.replace(/_/g, ' ')), cs));
}
function headers(block) {
  const H = {}; block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(l => { const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in H)) H[k] = l.slice(i + 1).trim(); } });
  return H;
}
const param = (h, p) => { const m = new RegExp(p + '\\*?=(?:"([^"]*)"|([^;\\s]*))', 'i').exec(h || ''); return m ? hdrDecode((m[1] != null ? m[1] : m[2]).replace(/^utf-8''/i, '')) : ''; };
export function parseMime(s, out, depth) {
  out = out || { text: '', html: '', atts: [], H: null }; depth = depth || 0;
  const i = s.search(/\r?\n\r?\n/); const hb = i < 0 ? s : s.slice(0, i), body = i < 0 ? '' : s.slice(i).replace(/^\r?\n\r?\n/, '');
  const H = headers(hb); if (!out.H) out.H = H;
  const ct = (H['content-type'] || 'text/plain').toLowerCase(), cte = (H['content-transfer-encoding'] || '').toLowerCase();
  if (ct.startsWith('multipart/') && depth < 6) {
    const bd = param(H['content-type'], 'boundary'); if (!bd) return out;
    body.split('--' + bd).slice(1).forEach(part => { if (/^--/.test(part)) return; parseMime(part.replace(/^\r?\n/, ''), out, depth + 1); });
    return out;
  }
  const raw = cte === 'base64' ? b64(body) : cte === 'quoted-printable' ? qp(body) : bytesOf(body);
  const name = param(H['content-disposition'], 'filename') || param(H['content-type'], 'name'), cs = param(H['content-type'], 'charset');
  if (!name && ct.startsWith('text/plain') && !out.text) out.text = dec(raw, cs);
  else if (!name && ct.startsWith('text/html') && !out.html) out.html = dec(raw, cs);
  else if (ct.startsWith('image/') || name) out.atts.push({ name: name || 'pielikums', mime: ct.split(';')[0], bytes: raw });
  return out;
}
const htmlText = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
const addrOf = (v) => { const m = /<([^>]+)>/.exec(String(v || '')); return String(m ? m[1] : v || '').trim().toLowerCase(); };

/** Zināmie sūtītāji: klientu, pārvaldnieku, Pilnvaru e-pasti + kv mailbox:allow (adreses vai @domēns) */
export async function allowSet(db) {
  const S = new Set(), add = (v) => String(v || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /@/.test(x)).forEach(x => S.add(x));
  (await all(db, "SELECT epasts FROM clients WHERE epasts != ''").catch(() => [])).forEach(r => add(r.epasts));
  (await all(db, "SELECT email FROM people WHERE active = 1 AND email != ''").catch(() => [])).forEach(r => add(r.email));
  const P = (await kv(db, 'mail:parv')) || {}; Object.values(P.emails || {}).forEach(add);
  ((await kv(db, 'mailbox:allow')) || []).forEach(add);
  return S;
}
const known = (S, from) => S.has(from) || S.has('@' + from.split('@')[1]);

/** Cloudflare Email Worker: export default { email(message, env, ctx) } */
export async function receive(message, env, ctx) {
  const db = env.DB, d = today();
  const n = await db.prepare("SELECT COUNT(*) n FROM mail_draft WHERE laiks >= ?").bind(d).first().catch(() => ({ n: 0 }));
  if (n && n.n >= MAX_DAY) { console.log('mailbox: dienas limits'); return; }
  const size = +message.rawSize || 0;
  const raw = size > MAX_RAW ? '' : latin1(new Uint8Array(await new Response(message.raw).arrayBuffer()));
  const M = raw ? parseMime(raw) : { text: '', html: '', atts: [], H: {} }, H = M.H || {};
  const from = addrOf(message.from || H.from), mid = str(H['message-id'] || '', 200);
  if (mid && await db.prepare('SELECT 1 FROM mail_draft WHERE msgid = ?').bind(mid).first()) return;
  const tema = str(hdrDecode(H.subject || (message.headers && message.headers.get && message.headers.get('subject')) || ''), 300);
  const teksts = str(M.text || htmlText(M.html) || (size > MAX_RAW ? '(vēstule par lielu — ' + Math.round(size / 1e6) + ' MB)' : ''), 20000);
  const ok = known(await allowSet(db), from), id = uid();
  let foto = [];
  if (ok) for (const a of M.atts.filter(x => /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(x.mime) && x.bytes.length < 8e6).slice(0, 6)) {
    try { const bin = latin1(a.bytes); const fid = await fotoPut(env, 'data:' + a.mime + ';base64,' + btoa(bin), { avots: 'mail', no: from }); if (fid) foto.push(fid); } catch (e) { console.error('mail att', e); }
  }
  await db.prepare('INSERT INTO mail_draft (id, laiks, no, kam, tema, teksts, foto, pielikumi, statuss, msgid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, nowStr(), from.slice(0, 200), str(message.to, 200), tema, teksts, foto.join(','), String(M.atts.length), ok ? 'jauns' : 'nezinams', mid).run();
  if (!ok) return;
  const job = (async () => { await extract(env, id).catch(e => console.error('mail ai', e));
    await notify(env, await managers(env, 'portal'), { title: '✉ E-pasta pieteikums', body: from + ': ' + (tema || teksts).slice(0, 120), url: '/sh/' }).catch(() => 0); })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
}

/** AI izvilkums melnrakstam (lietotne, adrese → objekts, darbs, termiņš, steidzami). Atkārtoti — nesauc AI, ja jau ir */
export async function extract(env, id, force) {
  const db = env.DB, r = await db.prepare('SELECT * FROM mail_draft WHERE id = ?').bind(id).first(); if (!r) return null;
  if (r.ai && !force) return JSON.parse(r.ai);
  const O = await all(db, 'SELECT anorm, adrese FROM objects');
  let j = null;
  if (env.ANTHROPIC_API_KEY) {
    await aiLimit(db, 'mailbox', 40);
    const prompt = 'Šodien ' + today() + '. Apsaimniekošanas uzņēmums SELECTUM HOME saņēma e-pastu.\nTēma: ' + r.tema + '\nTeksts:\n' + r.teksts.slice(0, 3500) +
      '\n\nLietotnes: ' + Object.entries(appsAll()).map(([k, v]) => k + ' = ' + v).join('; ') + '; cits = nekas no šiem.' +
      '\nAtgriez TIKAI JSON {"app":"…","adrese":"mājas adrese kā tekstā vai null","darbs":"īss darba apraksts latviski (≤ 200 zīmes)","termins":"YYYY-MM-DD vai null","steidzami":true|false,"daudzums":"maisi/kg/m³ vai null","materials":"sāls|smilts|mix vai null","kopsavilkums":"1 teikums"}. Neizdomā.';
    j = aiJson(await aiContent(env, prompt, 500));
  }
  j = j || {};
  const a = str(j.adrese, 200), ka = akey(a);
  let o = ka ? O.find(x => akey(x.adrese) === ka) || O.find(x => akey(x.adrese).startsWith(ka) || ka.startsWith(akey(x.adrese))) : null;
  if (!o) { const T = akey(r.tema + ' ' + r.teksts.slice(0, 2000)); o = O.filter(x => akey(x.adrese).length > 5 && T.indexOf(akey(x.adrese)) !== -1).sort((p, q) => q.adrese.length - p.adrese.length)[0] || null; }   // adrese tekstā bez AI
  const res = { app: appsAll()[j.app] ? j.app : '', adrese: a, anorm: o ? o.anorm : '', objekts: o ? o.adrese : '', darbs: str(j.darbs, 300) || str(r.tema, 200), termins: /^\d{4}-\d{2}-\d{2}$/.test(j.termins || '') ? j.termins : '',
    steidzami: !!j.steidzami, daudzums: str(j.daudzums, 40), materials: ['sāls', 'smilts', 'mix'].indexOf(j.materials) !== -1 ? j.materials : '', kopsavilkums: str(j.kopsavilkums, 300), ai: !!env.ANTHROPIC_API_KEY };
  await db.prepare('UPDATE mail_draft SET ai = ? WHERE id = ?').bind(JSON.stringify(res), id).run();
  return res;
}

/* ---------- Administrēšana (portāla admins) ---------- */
const MAT = { 'sāls': 'Sāls', smilts: 'Smilts', mix: 'Smilts + sāls' };
export async function adminApi(env, ctx, a, b, who) {
  const db = env.DB;
  if (a === 'mailDrafts') {
    const st = ['jauns', 'nezinams', 'apstiprinats', 'noraidits'].indexOf(b.st) !== -1 ? b.st : 'jauns';
    const L = (await all(db, 'SELECT id, laiks, no, tema, substr(teksts, 1, 4000) teksts, foto, pielikumi, statuss, ai, rezultats, kas, apstr FROM mail_draft WHERE statuss = ? ORDER BY laiks DESC LIMIT 100', st).catch(() => []))
      .map(r => Object.assign(r, { ai: (() => { try { return JSON.parse(r.ai || 'null'); } catch (e) { return null; } })() }));
    const cnt = {}; (await all(db, 'SELECT statuss, COUNT(*) n FROM mail_draft GROUP BY statuss').catch(() => [])).forEach(r => cnt[r.statuss] = r.n);
    return { list: L, cnt, apps: appsAll(), allow: (await kv(db, 'mailbox:allow')) || [], adrese: 'pieteikumi@vaitkevix.cloud', objects: (await all(db, 'SELECT anorm, adrese FROM objects ORDER BY adrese')).map(o => [o.anorm, o.adrese]) };
  }
  if (a === 'mailAllow') {
    const L = [...new Set(String(b.list || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]*@[^@\s]+\.[^@\s]+$/.test(x)))].slice(0, 300);
    const was = (await kv(db, 'mailbox:allow')) || []; await kvSet(db, 'mailbox:allow', L).run();
    await audit(db, who, 'E-pasta pieteikumi', 'Atļautie sūtītāji', [['saraksts', was.join(', ').slice(0, 300), L.join(', ').slice(0, 300)]]);
    return { allow: L };
  }
  const r = await db.prepare('SELECT * FROM mail_draft WHERE id = ?').bind(String(b.id || '')).first(); if (!r) throw new Error('Melnraksts nav atrasts');
  if (a === 'mailAi') { if (r.statuss === 'nezinams' && !b.force) throw new Error('Nezināms sūtītājs — vispirms pievienojiet atļautajiem'); return { ai: await extract(env, r.id, true) }; }
  if (a === 'mailReject') {
    if (r.statuss === 'apstiprinats') throw new Error('Jau apstiprināts');
    await db.prepare("UPDATE mail_draft SET statuss = 'noraidits', kas = ?, apstr = ? WHERE id = ?").bind(who, nowStr(), r.id).run();
    await audit(db, who, 'E-pasta pieteikumi', r.no, ['melnraksts', r.tema.slice(0, 80), 'noraidīts']);
    return { ok: true };
  }
  if (a === 'mailApprove') {
    if (r.statuss === 'apstiprinats') throw new Error('Jau apstiprināts');
    const f = b.f || {}, app = String(f.app || '');
    if (!appsAll()[app]) throw new Error('Izvēlieties lietotni');
    const foto = String(r.foto || '').split(',').filter(Boolean)[0] || '';
    const j = await createJob(env, ctx, who, { app, anorm: String(f.anorm || ''), datums: f.datums, apraksts: str(f.darbs, 500) || r.tema, steidz: !!f.steidzami, foto, daudzums: str(f.daudzums, 40), materials: MAT[f.materials] || '' });
    await db.prepare("UPDATE mail_draft SET statuss = 'apstiprinats', rezultats = ?, kas = ?, apstr = ? WHERE id = ?").bind(app + ':' + j.id, who, nowStr(), r.id).run();
    await audit(db, who, 'E-pasta pieteikumi', j.adrese, ['no e-pasta', r.no, appsAll()[app] + ' · ' + j.datums]);
    return { job: j };
  }
  throw new Error('Nezināma darbība');
}
