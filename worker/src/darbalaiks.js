/* SH | Darba laiks — sētnieki un uzkopēji atzīmējas TIKAI ar SMS: «SAKU <objekta kods>» un «BEIDZU» (arī «?» — statuss).
 * SMS vārteja: Android telefons birojā ar «SMS Gateway for Android» (sms-gate.app, Cloud režīms) → webhook POST /dl/sms?key=<DL_HOOK_KEY>.
 * Adminam svarīga adrese: pie katra objekta uzkopējs un sētnieks — darbā / beidza / nav.
 * API POST /dl (PIN): perms.dl = admin | vaditajs (pieteicējs) | skatitajs (neredz tālruņus). Vecās dl_mark rindas paliek.
 * Noslēpumi (Worker secrets): SMS_USER, SMS_PASS, DL_HOOK_KEY, pēc izvēles DL_SIGN_KEY (lietotnes Settings → Webhooks → Signing Key). © VAITKEVIX, SIA */
import { personByPin } from './portal.js';
import { today, addDays, dow, nowStr, uid, kv, kvSet, CORS, out } from './util.js';

export const KEY = 'dl';
const ROLE_W = { admin: 3, vaditajs: 2, skatitajs: 0 };
const AM = { uzk: 'uzkopējs', set: 'sētnieks' };
const SMS_API = 'https://api.sms-gate.app/3rdparty/v1';
const DEF_CFG = { rits: '07:30', vakars: '20:00', atgadinat: true };
async function all(db, sql, ...a) { return (await db.prepare(sql).bind(...a).all()).results || []; }
const hm = () => nowStr().slice(11, 16);
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const dur = (m) => Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
const okT = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
const isD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

/* Tālrunis → +371XXXXXXXX (8 cipari = Latvija). Nederīgs → '' */
export function normPhone(s) {
  let d = String(s || '').replace(/[^\d+]/g, ''); const plus = d.startsWith('+'); d = d.replace(/\+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!plus && d.length === 8) d = '371' + d;
  return d.length >= 8 && d.length <= 15 ? '+' + d : '';
}
/* SMS teksts → komanda */
export function parseCmd(t) {
  const s = String(t || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  let m = /^(SAKU|SAKT|SAKUMS|START|S)\b\s*#?\s*([0-9A-Z-]{1,8})?/.exec(s);
  if (m && (m[1] !== 'S' || m[2])) return { cmd: 'sak', kods: m[2] || '' };
  if (/^(BEIDZU|BEIDZ|BEIGAS|BEIGT|STOP|B)\b/.test(s)) return { cmd: 'beidz' };
  if (/^(\?|STATUSS|STATUS|INFO)/.test(s)) return { cmd: 'stat' };
  return { cmd: '' };
}

/* ---------- dati ---------- */
async function cfgOf(db) { return Object.assign({}, DEF_CFG, (await kv(db, 'dl:cfg')) || {}); }
async function objs(db) {
  return all(db, `SELECT d.anorm, d.kods, d.vajag_uzk, d.vajag_set, d.aktivs, COALESCE(o.adrese, d.anorm) adrese, COALESCE(o.vaditajs, '') vaditajs
    FROM dl_obj d LEFT JOIN objects o ON o.anorm = d.anorm ORDER BY COALESCE(o.adrese, d.anorm)`);
}
async function marksOn(db, d1, d2) { return all(db, "SELECT id, datums, vards, veids, laiks, avots, kas, anorm, amats, phone FROM dl_mark WHERE datums >= ? AND datums <= ? AND anorm != '' AND veids IN ('sak', 'beidz') ORDER BY datums, laiks, izveidots", d1, d2 || d1); }
/* Atzīmes → darba posmi: viens posms = sākums (+ beigas). Pāros pēc tālruņa (vai vārda) un objekta. */
function sessions(marks) {
  const S = [], open = {};
  marks.forEach(m => { const k = m.datums + '|' + (m.phone || m.vards) + '|' + m.anorm + '|' + m.amats;
    if (m.veids === 'sak') { if (open[k]) return; open[k] = { datums: m.datums, anorm: m.anorm, amats: m.amats, vards: m.vards, phone: m.phone, sak: m.laiks, beidz: '', ids: [m.id] }; S.push(open[k]); }
    else if (open[k]) { open[k].beidz = m.laiks; open[k].ids.push(m.id); delete open[k]; } });
  S.forEach(s => { const a = mins(s.sak), b = s.beidz ? mins(s.beidz) : null; s.min = a != null && b != null && b >= a ? b - a : 0; });
  return S;
}
/* Lomas stāvoklis objektā dienā: darba (kāds strādā) | beidza | nav */
function roleState(S, anorm, amats) {
  const x = S.filter(s => s.anorm === anorm && s.amats === amats); if (!x.length) return { statuss: 'nav', laiks: '' };
  const o = x.filter(s => !s.beidz); if (o.length) return { statuss: 'darba', laiks: o[0].sak, kopa: x.length };
  return { statuss: 'beidza', laiks: x[0].sak, beidz: x[x.length - 1].beidz, kopa: x.length };
}
function objState(o, S) {
  const r = { anorm: o.anorm, adrese: o.adrese, kods: o.kods, vaditajs: o.vaditajs, vajag_uzk: !!o.vajag_uzk, vajag_set: !!o.vajag_set,
    uzk: o.vajag_uzk ? roleState(S, o.anorm, 'uzk') : { statuss: 'nevajag' }, set: o.vajag_set ? roleState(S, o.anorm, 'set') : { statuss: 'nevajag' } };
  r.trukst = (o.vajag_uzk && r.uzk.statuss === 'nav') || (o.vajag_set && r.set.statuss === 'nav'); return r;
}
/* Kopsavilkums portāla kartītei un sākumam */
export async function summary(db, d) {
  d = d || today(); const O = (await objs(db)).filter(o => o.aktivs), S = sessions(await marksOn(db, d));
  const st = O.map(o => objState(o, S)), tr = st.filter(x => x.trukst);
  return { datums: d, objekti: O.length, kartiba: O.length - tr.length, trukst: tr.length, darba: S.filter(s => !s.beidz).length,
    truksAdr: tr.slice(0, 6).map(x => ({ a: x.adrese, u: x.uzk.statuss, s: x.set.statuss })), darbaDiena: dow(d) <= 5 };
}

/* ---------- SMS sūtīšana (sms-gate.app Cloud) ---------- */
async function logSms(db, virziens, phone, anorm, teksts, statuss, msgId) {
  await db.prepare('INSERT INTO dl_sms (id, laiks, virziens, phone, anorm, teksts, statuss, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), nowStr() + ':' + String(new Date().getSeconds()).padStart(2, '0'), virziens, phone || '', anorm || '', String(teksts || '').slice(0, 640), statuss || '', msgId || '').run();
}
const gwAuth = (env) => 'Basic ' + btoa(env.SMS_USER + ':' + env.SMS_PASS);
/* Sūta vienu tekstu vairākiem (pa 50 numuriem). Žurnālā — rinda katram numuram. */
export async function sendSms(env, to, text, anorm) {
  const db = env.DB, list = [...new Set((to || []).map(normPhone).filter(Boolean))]; if (!list.length) return 0;
  let st = 'nav vārtejas';
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50);
    if (env.SMS_USER && env.SMS_PASS) {
      try { const r = await fetch(SMS_API + '/messages', { method: 'POST', headers: { Authorization: gwAuth(env), 'Content-Type': 'application/json' },
          body: JSON.stringify({ textMessage: { text: String(text).slice(0, 640) }, phoneNumbers: part, ttl: 3600 }) });
        st = r.ok ? 'nosūtīts' : 'kļūda ' + r.status; if (!r.ok) console.error('sms', r.status, (await r.text()).slice(0, 200)); }
      catch (e) { st = 'kļūda'; console.error('sms', e); }
    }
    for (const p of part) await logSms(db, 'izej', p, anorm, text, st);
  }
  return list.length;
}

/* ---------- ienākošā SMS ---------- */
async function workerOf(db, phone) { return db.prepare('SELECT phone, vards, amats, anorm, aktivs FROM dl_worker WHERE phone = ?').bind(phone).first(); }
async function addMark(db, m) {
  await db.prepare('INSERT INTO dl_mark (id, datums, vards, veids, laiks, vieniba, avots, kas, izveidots, anorm, amats, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), m.datums, m.vards || '', m.veids, m.laiks, '', m.avots || 'sms', m.kas || '', nowStr(), m.anorm, m.amats, m.phone || '').run();
}
/* Apstrādā vienu SMS → atbildes teksts (vai '' — neatbildēt) */
export async function handleSms(db, phone, text) {
  const W = await workerOf(db, phone), c = parseCmd(text), d = today(), t = hm();
  if (!W || !W.aktivs) return { reply: 'Numurs nav reģistrēts SH darba laikā. Zvani darbu vadītājam.', anorm: '' };
  const S = sessions(await marksOn(db, d)).filter(s => s.phone === phone), open = S.filter(s => !s.beidz);
  const O = await objs(db), adr = (a) => (O.find(o => o.anorm === a) || {}).adrese || a, am = AM[W.amats] || 'darbinieks';
  if (c.cmd === 'sak') {
    let o = null;
    if (c.kods) { o = O.find(x => x.aktivs && String(x.kods).toUpperCase() === c.kods); if (!o) return { reply: 'Objekts ar kodu ' + c.kods + ' nav atrasts. Pārbaudi kodu uz uzlīmes un sūti vēlreiz, piem. SAKU 104.', anorm: '' }; }
    else { o = O.find(x => x.aktivs && x.anorm === W.anorm); if (!o) return { reply: 'Sūti SAKU un objekta kodu no uzlīmes, piem. SAKU 104.', anorm: '' }; }
    const same = open.find(s => s.anorm === o.anorm);
    if (same) return { reply: o.adrese + ': jau esi atzīmēts darbā kopš ' + same.sak + '. Beigās sūti BEIDZU.', anorm: o.anorm };
    for (const s of open) await addMark(db, { datums: d, vards: W.vards, veids: 'beidz', laiks: t, anorm: s.anorm, amats: s.amats, phone, kas: phone });   // pārgāja uz citu objektu
    await addMark(db, { datums: d, vards: W.vards, veids: 'sak', laiks: t, anorm: o.anorm, amats: W.amats, phone, kas: phone });
    return { reply: o.adrese + ': ' + am + ' atzīmēts darbā ' + t + '. Beigās sūti BEIDZU.', anorm: o.anorm };
  }
  if (c.cmd === 'beidz') {
    if (!open.length) return { reply: 'Šodien nav atzīmēts darba sākums. Darbu sākot sūti SAKU un objekta kodu.', anorm: W.anorm };
    const s = open[open.length - 1];
    await addMark(db, { datums: d, vards: W.vards, veids: 'beidz', laiks: t, anorm: s.anorm, amats: s.amats, phone, kas: phone });
    const m = Math.max(0, mins(t) - mins(s.sak));
    return { reply: adr(s.anorm) + ': darbs beigts ' + t + ' (' + dur(m) + '). Paldies!', anorm: s.anorm };
  }
  if (c.cmd === 'stat') {
    if (open.length) return { reply: 'Tu esi darbā: ' + adr(open[0].anorm) + ' kopš ' + open[0].sak + '. Beigās sūti BEIDZU.', anorm: open[0].anorm };
    if (S.length) { const l = S[S.length - 1]; return { reply: 'Šodien: ' + adr(l.anorm) + ' ' + l.sak + '–' + l.beidz + '. Šobrīd neesi atzīmēts darbā.', anorm: l.anorm }; }
    return { reply: 'Šodien neesi atzīmējies. Darbu sākot sūti SAKU un objekta kodu.', anorm: W.anorm };
  }
  return { reply: 'Nesapratu. Darbu sākot sūti SAKU un objekta kodu (piem. SAKU 104), beidzot — BEIDZU. Statuss: ?', anorm: W.anorm };
}
async function hmacHex(key, data) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
/* Webhook no SMS vārtejas: POST /dl/sms?key=… */
export async function hook(request, env, X, url) {
  if (request.method !== 'POST') return new Response('SH darba laiks', { status: 200 });
  if (!env.DL_HOOK_KEY || url.searchParams.get('key') !== env.DL_HOOK_KEY) return new Response('forbidden', { status: 403 });
  const raw = await request.text();
  if (env.DL_SIGN_KEY) {
    const ts = request.headers.get('X-Timestamp') || '', sig = (request.headers.get('X-Signature') || '').toLowerCase();
    if (!ts || Math.abs(Date.now() / 1000 - +ts) > 300 || sig !== await hmacHex(env.DL_SIGN_KEY, raw + ts)) return new Response('bad signature', { status: 401 });
  }
  let b = {}; try { b = JSON.parse(raw); } catch (e) { return new Response('bad json', { status: 400 }); }
  const db = env.DB;
  if (b.event === 'system:ping') { await kvSet(db, 'dl:ping', { laiks: nowStr(), health: (b.payload && b.payload.health) || {} }).run(); return out({ ok: true }); }
  if (b.event !== 'sms:received') return out({ ok: true, skip: b.event || '' });
  const p = b.payload || {}, phone = normPhone(p.sender || p.phoneNumber), text = String(p.message || '').slice(0, 300), msgId = String(p.messageId || b.id || '');
  if (msgId && await db.prepare("SELECT 1 FROM dl_sms WHERE msg_id = ? AND virziens = 'ien'").bind(msgId).first()) return out({ ok: true, dup: true });   // vārteja sūta atkārtoti
  await kvSet(db, 'dl:ping', { laiks: nowStr(), sms: true }).run();
  if (!phone) { await logSms(db, 'ien', String(p.sender || ''), '', text, 'nederīgs numurs', msgId); return out({ ok: true }); }
  const r = await handleSms(db, phone, text);
  await logSms(db, 'ien', phone, r.anorm, text, (await workerOf(db, phone)) ? 'ok' : 'nezināms numurs', msgId);
  if (r.reply) { const job = sendSms(env, [phone], r.reply, r.anorm); if (X && X.bg) X.bg(job); else await job; }
  return out({ ok: true });
}

/* ---------- atgādinājumi (no 5 min trigera) ---------- */
export async function reminders(env, force) {
  const db = env.DB, d = today(), t = hm(), C = await cfgOf(db);
  if (!C.atgadinat || dow(d) > 5) return { rits: 0, vakars: 0 };
  let a = 0, b = 0;
  const mark = async (k) => { const v = await kv(db, k); if (v === d) return false; await kvSet(db, k, d).run(); return true; };
  if ((force ? force === 'rits' : (mins(t) >= mins(C.rits) && mins(t) < mins(C.rits) + 120)) && await mark('dl:remRits')) {
    const O = (await objs(db)).filter(o => o.aktivs), S = sessions(await marksOn(db, d)), W = await all(db, 'SELECT phone, amats, anorm FROM dl_worker WHERE aktivs = 1');
    for (const o of O) for (const am of ['uzk', 'set']) {
      if (!(am === 'uzk' ? o.vajag_uzk : o.vajag_set) || roleState(S, o.anorm, am).statuss !== 'nav') continue;
      const to = W.filter(w => w.anorm === o.anorm && w.amats === am).map(w => w.phone);
      if (to.length) a += await sendSms(env, to, 'Atgādinājums: ' + o.adrese + ' — šodien neesi atzīmējies darbā. Darbu sākot sūti SAKU ' + o.kods + '.', o.anorm);
    }
  }
  if ((force ? force === 'vakars' : (mins(t) >= mins(C.vakars) && mins(t) < mins(C.vakars) + 120)) && await mark('dl:remVak')) {
    const O = await objs(db), open = sessions(await marksOn(db, d)).filter(s => !s.beidz && s.phone);
    for (const s of open) { const o = O.find(x => x.anorm === s.anorm) || { adrese: s.anorm };
      b += await sendSms(env, [s.phone], 'Tu joprojām esi atzīmēts darbā (' + o.adrese + '). Ja esi beidzis, atbildi BEIDZU.', s.anorm); }
  }
  return { rits: a, vakars: b };
}
export async function cron(env) { if (env.SMS_USER) await reminders(env); }

/* ---------- API portālam un lietotnei ---------- */
const hidePh = (p) => p ? p.slice(0, 5) + '•••' + p.slice(-2) : '';
async function boot(db, d, role) {
  const O = (await objs(db)).filter(o => o.aktivs), S = sessions(await marksOn(db, d)), st = O.map(o => objState(o, S));
  const ping = await kv(db, 'dl:ping'), W = await all(db, 'SELECT phone, vards, amats, anorm FROM dl_worker WHERE aktivs = 1');
  const last = await all(db, "SELECT laiks, virziens, phone, anorm, teksts, statuss FROM dl_sms WHERE laiks >= ? ORDER BY laiks DESC LIMIT 12", d);
  const sum = { objekti: O.length, kartiba: st.filter(x => !x.trukst).length, trukst: st.filter(x => x.trukst).length, darba: S.filter(s => !s.beidz).length, darbinieki: W.length };
  const cnt = await db.prepare("SELECT SUM(CASE WHEN virziens = 'ien' THEN 1 ELSE 0 END) ien, SUM(CASE WHEN virziens = 'izej' THEN 1 ELSE 0 END) izej FROM dl_sms WHERE laiks >= ?").bind(d).first();
  return { datums: d, objekti: st, kopsavilkums: sum, pedejas: last.map(x => smsRow(x, O, W, role)), varteja: { iestatita: false, ping: ping ? ping.laiks : '', ien: (cnt && cnt.ien) || 0, izej: (cnt && cnt.izej) || 0 } };
}
function smsRow(x, O, W, role) {
  const o = O.find(z => z.anorm === x.anorm), w = W.find(z => z.phone === x.phone);
  return { laiks: x.laiks, virziens: x.virziens, adrese: o ? o.adrese : '', amats: w ? w.amats : '', vards: role >= 2 && w ? w.vards : '', phone: role >= 2 ? x.phone : hidePh(x.phone), teksts: x.teksts, statuss: x.statuss };
}
function monday(d) { return addDays(d, 1 - dow(d)); }
async function objekts(db, anorm, d, role) {
  const o = (await objs(db)).find(x => x.anorm === anorm); if (!o) throw new Error('Objekts nav atrasts');
  const m0 = monday(d), m6 = addDays(m0, 6), S = sessions(await marksOn(db, m0, m6)), day = S.filter(s => s.datums === d);
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => { const dd = addDays(m0, i), x = S.filter(s => s.datums === dd), fut = dd > today();
    const f = (am, need) => !need ? 'nevajag' : fut ? '' : x.some(s => s.anorm === anorm && s.amats === am) ? 'ok' : (i >= 5 ? 'brivs' : 'nav');
    return { datums: dd, uzk: f('uzk', o.vajag_uzk), set: f('set', o.vajag_set) }; });
  const mStart = d.slice(0, 8) + '01', MS = sessions(await marksOn(db, mStart, d)).filter(s => s.anorm === anorm);
  const W = await all(db, 'SELECT phone, vards, amats, anorm, aktivs FROM dl_worker WHERE anorm = ? ORDER BY amats, vards', anorm), Oall = await objs(db), Wall = await all(db, 'SELECT phone, vards, amats FROM dl_worker');
  const sms = await all(db, 'SELECT laiks, virziens, phone, anorm, teksts, statuss FROM dl_sms WHERE anorm = ? AND laiks >= ? ORDER BY laiks DESC LIMIT 30', anorm, d);
  return { objekts: objState(o, day), datums: d, posmi: day.filter(s => s.anorm === anorm).map(s => ({ amats: s.amats, vards: role >= 2 ? s.vards : '', sak: s.sak, beidz: s.beidz, min: s.min, ids: role >= 3 ? s.ids : [] })),
    nedela: week, menesis: { uzk: MS.filter(s => s.amats === 'uzk').reduce((n, s) => n + s.min, 0), set: MS.filter(s => s.amats === 'set').reduce((n, s) => n + s.min, 0) },
    darbinieki: W.map(w => ({ vards: role >= 2 ? w.vards : '', amats: w.amats, phone: role >= 2 ? w.phone : hidePh(w.phone), aktivs: !!w.aktivs })), sms: sms.map(x => smsRow(x, Oall, Wall, role)) };
}
async function tabele(db, no, lidz, role) {
  if (!isD(no) || !isD(lidz) || lidz < no) throw new Error('Nepareizs periods'); if (addDays(no, 92) < lidz) throw new Error('Periods līdz 3 mēnešiem');
  const O = await objs(db), S = sessions(await marksOn(db, no, lidz)), td = today(), days = [];
  for (let d = no; d <= lidz && d <= td; d = addDays(d, 1)) days.push(d);
  const rows = O.filter(o => o.aktivs || S.some(s => s.anorm === o.anorm)).map(o => {
    const x = S.filter(s => s.anorm === o.anorm), miss = days.filter(d => dow(d) <= 5 && ((o.vajag_uzk && !x.some(s => s.datums === d && s.amats === 'uzk')) || (o.vajag_set && !x.some(s => s.datums === d && s.amats === 'set'))));
    return { anorm: o.anorm, adrese: o.adrese, kods: o.kods, uzk: x.filter(s => s.amats === 'uzk').reduce((n, s) => n + s.min, 0), set: x.filter(s => s.amats === 'set').reduce((n, s) => n + s.min, 0), trukaDienas: miss };
  });
  const det = S.map(s => ({ datums: s.datums, adrese: (O.find(o => o.anorm === s.anorm) || {}).adrese || s.anorm, amats: s.amats, vards: role >= 2 ? s.vards : '', sak: s.sak, beidz: s.beidz, min: s.min }));
  return { no, lidz, rindas: rows, kopa: { uzk: rows.reduce((n, r) => n + r.uzk, 0), set: rows.reduce((n, r) => n + r.set, 0) }, detalas: det };
}
async function recipients(db, b) {
  const W = await all(db, 'SELECT phone, amats, anorm FROM dl_worker WHERE aktivs = 1'), k = b.kam;
  if (k === 'set' || k === 'uzk') return W.filter(w => w.amats === k);
  if (k === 'obj') return W.filter(w => w.anorm === b.anorm && (!b.amats || w.amats === b.amats));
  if (k === 'nav') { const S = sessions(await marksOn(db, today())); return W.filter(w => !S.some(s => s.phone === w.phone)); }
  return W;
}
async function iestatijumi(db) {
  const all_o = await all(db, `SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, d.kods, d.vajag_uzk, d.vajag_set, d.aktivs FROM objects o LEFT JOIN dl_obj d ON d.anorm = o.anorm ORDER BY o.adrese`);
  return { objekti: all_o.map(o => ({ anorm: o.anorm, adrese: o.adrese, vaditajs: o.vaditajs, grupa: o.grupa, kods: o.kods || '', vajag_uzk: o.kods ? !!o.vajag_uzk : true, vajag_set: o.kods ? !!o.vajag_set : true, aktivs: !!(o.kods && o.aktivs) })),
    darbinieki: await all(db, 'SELECT phone, vards, amats, anorm, aktivs FROM dl_worker ORDER BY vards, phone'), cfg: await cfgOf(db) };
}
export async function api(request, env, X) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  let b = {}; try { b = await request.json(); } catch (e) { return out({ ok: false, error: 'Nederīgs pieprasījums' }, 400); }
  const db = env.DB, a = b.action;
  try {
    let me = b.pin ? await personByPin(db, b.pin) : null;
    if (b.pin && !me) { await new Promise(r => setTimeout(r, 700)); return out({ ok: false, error: 'Nepareizs PIN', code: 'auth' }); }
    if (!me) me = { name: 'Pārvaldnieks', perms: { dl: 'skatitajs' } };   // skatīšanās bez ielogošanās
    const role = me.perms.dl || (me.perms.portal === 'admin' ? 'admin' : 'skatitajs'), W = ROLE_W[role] || 0;
    const need = (n) => { if (W < n) throw new Error(n >= 3 ? 'Tikai administrators' : 'Vajag pieteicēja vai administratora tiesības'); };
    const d = isD(b.datums) ? b.datums : today();
    if (a === 'boot') { const r = await boot(db, d, W); r.varteja.iestatita = !!(env.SMS_USER && env.SMS_PASS); return out(Object.assign({ ok: true, me: { name: me.name, role }, today: today() }, r)); }
    if (a === 'objekts') return out(Object.assign({ ok: true }, await objekts(db, String(b.anorm || ''), d, W)));
    if (a === 'tabele') return out(Object.assign({ ok: true }, await tabele(db, b.no, b.lidz, W)));
    if (a === 'smsZurnals') { need(2); const O = await objs(db), Wk = await all(db, 'SELECT phone, vards, amats FROM dl_worker');
      return out({ ok: true, sms: (await all(db, 'SELECT laiks, virziens, phone, anorm, teksts, statuss FROM dl_sms WHERE laiks >= ? ORDER BY laiks DESC LIMIT 300', addDays(d, -2))).map(x => smsRow(x, O, Wk, W)) }); }
    if (a === 'sms') { need(2); const t = String(b.teksts || '').trim(); if (!t) throw new Error('Ieraksti tekstu'); if (t.length > 640) throw new Error('Teksts par garu (līdz 640 zīmēm)');
      const to = await recipients(db, b); if (!to.length) throw new Error('Nav kam sūtīt');
      return out({ ok: true, nosutits: await sendSms(env, to.map(w => w.phone), t, b.kam === 'obj' ? b.anorm : '') }); }
    if (a === 'atgadinat') { need(2); const o = (await objs(db)).find(x => x.anorm === b.anorm); if (!o) throw new Error('Objekts nav atrasts'); const am = b.amats === 'set' ? 'set' : 'uzk';
      const to = (await recipients(db, { kam: 'obj', anorm: o.anorm, amats: am })).map(w => w.phone); if (!to.length) throw new Error('Šim objektam nav ' + (am === 'set' ? 'sētnieka' : 'uzkopēja') + ' ar tālruni');
      return out({ ok: true, nosutits: await sendSms(env, to, 'Atgādinājums: ' + o.adrese + ' — neesi atzīmējies darbā. Darbu sākot sūti SAKU ' + o.kods + '.', o.anorm) }); }
    if (a === 'labot') { need(3);
      if (b.id) { if (b.atcelt) await db.prepare("UPDATE dl_mark SET veids = 'atcelts', kas = ? WHERE id = ?").bind(me.name, b.id).run();
        else { if (!okT(b.laiks)) throw new Error('Laiks HH:MM'); await db.prepare('UPDATE dl_mark SET laiks = ?, kas = ?, avots = ? WHERE id = ?').bind(b.laiks, me.name, 'labots', b.id).run(); }
        return out({ ok: true }); }
      const am = b.amats === 'set' ? 'set' : 'uzk'; if (!b.anorm || !okT(b.sak) || (b.beidz && !okT(b.beidz))) throw new Error('Norādi objektu un laiku HH:MM');
      const m = { datums: d, vards: String(b.vards || '').slice(0, 80), anorm: b.anorm, amats: am, phone: normPhone(b.phone), avots: 'labots', kas: me.name };
      await addMark(db, Object.assign({}, m, { veids: 'sak', laiks: b.sak })); if (b.beidz) await addMark(db, Object.assign({}, m, { veids: 'beidz', laiks: b.beidz }));
      return out({ ok: true }); }
    if (a === 'iestatijumi') { need(3); return out(Object.assign({ ok: true }, await iestatijumi(db))); }
    if (a === 'saveObj') { need(3); const k = String(b.kods || '').trim().toUpperCase();
      if (!b.anorm) throw new Error('Nav objekta');
      if (!k) { await db.prepare('UPDATE dl_obj SET aktivs = 0 WHERE anorm = ?').bind(b.anorm).run(); return out({ ok: true }); }
      if (!/^[0-9A-Z-]{1,8}$/.test(k)) throw new Error('Kods — līdz 8 cipariem/burtiem, piem. 104');
      const other = await db.prepare('SELECT anorm FROM dl_obj WHERE kods = ? AND anorm != ?').bind(k, b.anorm).first(); if (other) throw new Error('Kods ' + k + ' jau ir citam objektam');
      await db.prepare('INSERT INTO dl_obj (anorm, kods, vajag_uzk, vajag_set, aktivs) VALUES (?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET kods = excluded.kods, vajag_uzk = excluded.vajag_uzk, vajag_set = excluded.vajag_set, aktivs = excluded.aktivs')
        .bind(b.anorm, k, b.vajag_uzk === false ? 0 : 1, b.vajag_set === false ? 0 : 1, b.aktivs === false ? 0 : 1).run();
      return out({ ok: true }); }
    if (a === 'saveWorker') { need(3); const p = normPhone(b.phone); if (!p) throw new Error('Nepareizs tālrunis — 8 cipari vai +371…');
      const am = b.amats === 'set' ? 'set' : 'uzk', old = normPhone(b.oldPhone);
      if (old && old !== p) { if (await workerOf(db, p)) throw new Error('Šis numurs jau ir sarakstā'); await db.prepare('UPDATE dl_worker SET phone = ? WHERE phone = ?').bind(p, old).run(); }
      await db.prepare('INSERT INTO dl_worker (phone, vards, amats, anorm, aktivs) VALUES (?, ?, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET vards = excluded.vards, amats = excluded.amats, anorm = excluded.anorm, aktivs = excluded.aktivs')
        .bind(p, String(b.vards || '').trim().slice(0, 80), am, String(b.anorm || ''), b.aktivs === false ? 0 : 1).run();
      return out({ ok: true, phone: p }); }
    if (a === 'saveCfg') { need(3); const c = Object.assign({}, await cfgOf(db));
      if (okT(b.rits)) c.rits = b.rits; if (okT(b.vakars)) c.vakars = b.vakars; if (typeof b.atgadinat === 'boolean') c.atgadinat = b.atgadinat;
      await kvSet(db, 'dl:cfg', c).run(); return out({ ok: true, cfg: c }); }
    if (a === 'registerHook') { need(3);
      if (!env.SMS_USER || !env.SMS_PASS || !env.DL_HOOK_KEY) throw new Error('Worker noslēpumi SMS_USER, SMS_PASS, DL_HOOK_KEY nav iestatīti');
      const base = new URL(request.url).origin, res = [];
      for (const ev of ['sms:received', 'system:ping']) { const r = await fetch(SMS_API + '/webhooks', { method: 'POST', headers: { Authorization: gwAuth(env), 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: base + '/dl/sms?key=' + encodeURIComponent(env.DL_HOOK_KEY), event: ev }) }); res.push(ev + ': ' + r.status); }
      return out({ ok: true, rezultats: res }); }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
