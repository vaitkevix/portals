/* SH | Darba laiks — sētnieki un uzkopēji atzīmējas TIKAI ar SMS: «START <objekta kods>» un «STOP» (arī «?» — statuss).
 * SMS vārteja: Android telefons birojā ar «SMS Gateway for Android» (sms-gate.app, Cloud režīms) → webhook POST /dl/sms?key=<DL_HOOK_KEY>.
 * Adminam svarīga adrese: pie katra objekta uzkopējs un sētnieks — darbā / beidza / nav.
 * API POST /dl (PIN): perms.dl = admin | vaditajs (pieteicējs) | skatitajs (neredz tālruņus). Vecās dl_mark rindas paliek.
 * Noslēpumi (Worker secrets): SMS_USER, SMS_PASS, DL_HOOK_KEY, pēc izvēles DL_SIGN_KEY (lietotnes Settings → Webhooks → Signing Key). © VAITKEVIX, SIA */
import { personByPin } from './portal.js';
import { lvHolidays } from './personals.js';
import { dlInherit, dlSync } from './majaslieta.js';
import { today, addDays, dow, nowStr, uid, kv, kvSet, CORS, out } from './util.js';

export const KEY = 'dl';
const ROLE_W = { admin: 3, vaditajs: 2, skatitajs: 0 };
const AM = { uzk: 'uzkopējs', set: 'sētnieks', abi: 'uzkopējs un sētnieks' };
const AMS = ['uzk', 'set', 'abi'];
/* Darbiniekam «abi» — amatu šajā reizē nosaka objekts: ko objektam vajag, kuram amatam nav cita darbinieka, kas vēl nav atzīmēts šodien */
async function roleAt(db, W, o, S) {
  if (W.amats !== 'abi') return W.amats || 'uzk';
  let r = ['uzk', 'set'].filter(a => a === 'uzk' ? o.vajag_uzk : o.vajag_set); if (!r.length) r = ['uzk', 'set'];
  if (r.length > 1) { const other = await all(db, "SELECT amats FROM dl_worker WHERE aktivs = 1 AND anorm = ? AND phone != ? AND amats IN ('uzk', 'set')", o.anorm, W.phone);
    const f = r.filter(a => !other.some(x => x.amats === a)); if (f.length) r = f; }
  if (r.length > 1) { const f = r.filter(a => roleState(S, o.anorm, a).statuss === 'nav'); if (f.length) r = f; }
  return r[0];
}
const SMS_API = 'https://api.sms-gate.app/3rdparty/v1';
const DEF_CFG = { rits: '07:30', vakars: '20:00', atgadinat: true, numurs: '' };   // numurs — SMS telefona numurs uzlīmēm
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
  let m = /^(SAKU|SAKT|SAKUMS|START|S)(?=[\s#0-9]|$)\s*#?\s*([0-9A-Z-]{1,8})?/.exec(s);
  if (m && /^(DARBU|DARBA|DARBS|DARB|TAGAD|SEIT|OBJEKTA)$/.test(m[2] || '')) { const n = /^\S+\s+[A-Z]+\s*(?:#\s*|\s+)([0-9A-Z-]{1,8})/.exec(s); m[2] = n ? n[1] : ''; }   // «SAKU DARBU [104]» — vārds nav kods
  if (m && (m[1] !== 'S' || m[2])) return { cmd: 'sak', kods: m[2] || '' };
  if (/^(BEIDZU|BEIDZ|BEIGAS|BEIGT|STOP|B)\b/.test(s) || /^(STOP|BEIDZU)/.test(s)) return { cmd: 'beidz' };
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
  const x = S.filter(s => s.anorm === anorm && (s.amats === amats || s.amats === 'abi')); if (!x.length) return { statuss: 'nav', laiks: '' };
  const o = x.filter(s => !s.beidz); if (o.length) return { statuss: 'darba', laiks: o[0].sak, kopa: x.length };
  return { statuss: 'beidza', laiks: x[0].sak, beidz: x[x.length - 1].beidz, kopa: x.length };
}
function objState(o, S) {
  const r = { anorm: o.anorm, adrese: o.adrese, kods: o.kods, vaditajs: o.vaditajs, vajag_uzk: !!o.vajag_uzk, vajag_set: !!o.vajag_set,
    uzk: o.vajag_uzk ? roleState(S, o.anorm, 'uzk') : { statuss: 'nevajag' }, set: o.vajag_set ? roleState(S, o.anorm, 'set') : { statuss: 'nevajag' } };
  r.trukst = (o.vajag_uzk && r.uzk.statuss === 'nav') || (o.vajag_set && r.set.statuss === 'nav'); return r;
}
/** Visu aktīvo objektu šodienas stāvoklis: { anorm: objState } (vadītāja panelim) */
export async function objStates(db, d) {
  d = d || today(); const O = (await objs(db)).filter(o => o.aktivs), S = sessions(await marksOn(db, d)), out = {};
  O.forEach(o => out[o.anorm] = objState(o, S)); return { datums: d, darbaDiena: dow(d) <= 5, map: out };
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
  const id = uid();
  await db.prepare('INSERT INTO dl_sms (id, laiks, virziens, phone, anorm, teksts, statuss, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, nowStr() + ':' + String(new Date().getSeconds()).padStart(2, '0'), virziens, phone || '', anorm || '', String(teksts || '').slice(0, 640), statuss || '', msgId || '').run();
  return id;
}
/* SMS = 1 daļa: latviešu garumzīmes → bez (GSM-7 160 zīmes, nevis 70); domuzīmes/pēdiņas → vienkāršas. Kirilicu neaiztiek. */
const LV = { 'ā': 'a', 'č': 'c', 'ē': 'e', 'ģ': 'g', 'ī': 'i', 'ķ': 'k', 'ļ': 'l', 'ņ': 'n', 'š': 's', 'ū': 'u', 'ž': 'z', 'Ā': 'A', 'Č': 'C', 'Ē': 'E', 'Ģ': 'G', 'Ī': 'I', 'Ķ': 'K', 'Ļ': 'L', 'Ņ': 'N', 'Š': 'S', 'Ū': 'U', 'Ž': 'Z' };
export const gsm = (t) => String(t || '').replace(/[āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]/g, c => LV[c]).replace(/[—–]/g, '-').replace(/[«»„“”]/g, '"').replace(/[‘’]/g, "'");
const up1 = (x) => String(x || '').charAt(0).toUpperCase() + String(x || '').slice(1);
const gwAuth = (env) => 'Basic ' + btoa(env.SMS_USER + ':' + env.SMS_PASS);
/* Sūta vienu tekstu vairākiem (pa 50 numuriem). Žurnālā — rinda katram numuram. */
export async function sendSms(env, to, text, anorm) {
  const db = env.DB, list = [...new Set((to || []).map(normPhone).filter(Boolean))]; if (!list.length) return 0;
  text = gsm(text);
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

/* Jaunam darbiniekam — īsa instrukcija ar viņa objektu kodiem (sūta vienreiz; atkārtoti — ar pogu). kv dl:welcome:<tel> = laiks */
export async function welcomeText(db, phone) { return (await welcomeParts(db, phone)).join('\n\n'); }
/* Visi darbinieka objekti (nekad nenogriež): rindas «kods adrese»; ja >160 zīmēm — vairākas SMS, dalot pa rindām */
export async function welcomeParts(db, phone) {
  const w = await workerOf(db, phone); if (!w) return [];
  const A = await all(db, 'SELECT anorm FROM dl_assign WHERE phone = ?', phone), set = new Set(A.map(x => x.anorm)); if (w.anorm) set.add(w.anorm);
  const all0 = await objs(db), inh = await dlInherit(db).catch(() => ({})), seen = new Set(), O = [];
  for (const a of set) {   // apvienotā objekta māja → apvienotā objekta kods
    let o = all0.find(x => x.anorm === a); if ((!o || !o.aktivs || !o.kods) && inh[a]) o = all0.find(x => x.aktivs && x.anorm === inh[a].anorm) || o;
    const key = o ? o.anorm : a; if (seen.has(key)) continue; seen.add(key);
    O.push({ kods: o && o.aktivs && o.kods ? o.kods : '', adrese: o ? o.adrese : a });
  }
  const ascii = (x) => gsm(x).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
  const v = ascii(String(w.vards || '').trim().split(/\s+/)[0]);
  const one = O.length === 1 && O[0].kods;
  const lines = [(v ? 'Sveiki, ' + v + '!' : 'Sveiki!'), 'SMS uz so numuru:', 'START ' + (one ? O[0].kods : 'kods') + ' - sakot darbu', 'STOP - beidzot', '? - statuss'];
  if (one) lines.push('Objekts: ' + ascii(O[0].adrese));
  else if (!O.length) lines.push('Objekta kodu pajauta vaditajam.');
  else { lines.push('Kodi:'); O.forEach(o => lines.push((o.kods || 'bez koda') + ' | ' + ascii(o.adrese))); }
  const glen = (x) => x.length + (x.match(/[|^{}\[\]~\\€]/g) || []).length;   // «|» GSM-7 aizņem 2 vietas
  const parts = []; let cur = '';
  for (const l0 of lines) { const l = l0.slice(0, 150); if (cur && glen(cur + '\n' + l) > 160) { parts.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; }
  if (cur) parts.push(cur);
  return parts;
}
export async function sendWelcome(env, phone, force) {
  const db = env.DB, key = 'dl:welcome:' + phone;
  if (!force && await kv(db, key)) return { sent: false, why: 'jau nosūtīts' };
  const P = await welcomeParts(db, phone); if (!P.length) return { sent: false, why: 'nav darbinieka' };
  for (const t of P) await sendSms(env, [phone], t, '');
  await kvSet(db, key, nowStr()).run();
  return { sent: true, text: P.join('\n\n'), sms: P.length };
}

/* ---------- ienākošā SMS ---------- */
/* Darbinieka amats konkrētā objektā (dl_assign); vecie ieraksti — galvenais objekts dl_worker.anorm */
async function assignOf(db, phone, anorm) { const r = await db.prepare('SELECT amats FROM dl_assign WHERE phone = ? AND anorm = ?').bind(phone, anorm).first(); return r ? r.amats : ''; }
/** Aktīvie darbinieki objektā ar amatu tajā: [{ phone, vards, amats, aktivs }] */
async function workersAt(db, anorm, withInactive) {
  return all(db, `SELECT w.phone, w.vards, COALESCE(a.amats, w.amats) amats, w.aktivs FROM dl_worker w LEFT JOIN dl_assign a ON a.phone = w.phone AND a.anorm = ?
    WHERE (a.anorm IS NOT NULL OR w.anorm = ?)` + (withInactive ? '' : ' AND w.aktivs = 1') + ' ORDER BY amats, w.vards', anorm, anorm);
}
async function allAssign(db) { return all(db, `SELECT w.phone, a.anorm, a.amats FROM dl_assign a JOIN dl_worker w ON w.phone = a.phone WHERE w.aktivs = 1
  UNION SELECT w.phone, w.anorm, w.amats FROM dl_worker w WHERE w.aktivs = 1 AND w.anorm != '' AND NOT EXISTS (SELECT 1 FROM dl_assign x WHERE x.phone = w.phone AND x.anorm = w.anorm)`); }
const fits = (am, want) => am === want || am === 'abi';
async function workerOf(db, phone) { return db.prepare('SELECT phone, vards, amats, anorm, aktivs FROM dl_worker WHERE phone = ?').bind(phone).first(); }
async function addMark(db, m) {
  await db.prepare('INSERT INTO dl_mark (id, datums, vards, veids, laiks, vieniba, avots, kas, izveidots, anorm, amats, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), m.datums, m.vards || '', m.veids, m.laiks, '', m.avots || 'sms', m.kas || '', nowStr(), m.anorm, m.amats, m.phone || '').run();
}
/* Apstrādā vienu SMS → atbildes teksts (vai '' — neatbildēt) */
export async function handleSms(db, phone, text) {
  const W = await workerOf(db, phone), c = parseCmd(text), d = today(), t = hm();
  if (!W || !W.aktivs) return { reply: 'Numurs nav reģistrēts SH Darba laikā.\nZvani darbu vadītājam.', anorm: '' };
  const S = sessions(await marksOn(db, d)).filter(s => s.phone === phone), open = S.filter(s => !s.beidz);
  const O = await objs(db), adr = (a) => (O.find(o => o.anorm === a) || {}).adrese || a, am = AM[W.amats] || 'darbinieks';
  if (c.cmd === 'sak') {
    let o = null;
    const up = async (x) => { if (!x || x.aktivs) return x; const h = (await dlInherit(db).catch(() => ({})))[x.anorm]; return h ? O.find(y => y.aktivs && y.anorm === h.anorm) || x : x; };   // apvienotā objekta māja (vecs mājas kods) → apvienotais objekts
    if (c.kods) { o = O.find(x => x.aktivs && String(x.kods).toUpperCase() === c.kods) || await up(O.find(x => String(x.kods).toUpperCase() === c.kods)); if (o && !o.aktivs) o = null; if (!o) return { reply: 'Kods ' + c.kods + ' nav atrasts.\nPārbaudi kodu uz uzlīmes un sūti vēlreiz, piem.:\nSTART 104', anorm: '' }; }
    else { o = await up(O.find(x => x.anorm === W.anorm) || (W.anorm ? { anorm: W.anorm } : null)); if (o && !o.aktivs) o = null; if (!o) return { reply: 'Sūti START un objekta kodu no uzlīmes, piem.:\nSTART 104', anorm: '' }; }
    const same = open.find(s => s.anorm === o.anorm);
    if (same) return { reply: o.adrese + '\nJau esi darbā kopš ' + same.sak + '\nBeigās sūti STOP', anorm: o.anorm };
    for (const s of open) await addMark(db, { datums: d, vards: W.vards, veids: 'beidz', laiks: t, anorm: s.anorm, amats: s.amats, phone, kas: phone });   // pārgāja uz citu objektu
    const ra = (await assignOf(db, phone, o.anorm)) || await roleAt(db, W, o, sessions(await marksOn(db, d)));   // amats šajā objektā (abi → abi)
    await addMark(db, { datums: d, vards: W.vards, veids: 'sak', laiks: t, anorm: o.anorm, amats: ra, phone, kas: phone });
    return { reply: o.adrese + '\n' + up1(AM[ra]) + ' darbā no ' + t + '\nBeigās sūti STOP', anorm: o.anorm };
  }
  if (c.cmd === 'beidz') {
    if (!open.length) {
      /* STOP pēc pusnakts: vakardienas vaļējo posmu aizver 24:00 un šodien pieraksta 00:00–STOP (līdz 06:00).
       * Vēlāk (aizmirsts STOP) neko neizdomā — posms paliek «nav beigu» tabelē, vadītājs labo. */
      const y = addDays(d, -1), yo = sessions(await marksOn(db, y)).filter(s => s.phone === phone && !s.beidz);
      if (yo.length && mins(t) < 6 * 60) {
        const s = yo[yo.length - 1];
        await addMark(db, { datums: y, vards: W.vards, veids: 'beidz', laiks: '24:00', anorm: s.anorm, amats: s.amats, phone, kas: phone });
        if (mins(t) > 0) { await addMark(db, { datums: d, vards: W.vards, veids: 'sak', laiks: '00:00', anorm: s.anorm, amats: s.amats, phone, kas: phone });
          await addMark(db, { datums: d, vards: W.vards, veids: 'beidz', laiks: t, anorm: s.anorm, amats: s.amats, phone, kas: phone }); }
        return { reply: adr(s.anorm) + '\nDarbs beigts ' + t + ' (' + dur(1440 - mins(s.sak) + mins(t)) + ')\nPaldies!', anorm: s.anorm };
      }
      if (yo.length) return { reply: 'Šodien nav atzīmēts darba sākums.\nVakar ' + adr(yo[0].anorm) + ' palika bez STOP - paziņo vadītājam beigu laiku.', anorm: yo[0].anorm };
      return { reply: 'Šodien nav atzīmēts darba sākums.\nSākot darbu sūti:\nSTART kods', anorm: W.anorm };
    }
    const s = open[open.length - 1];
    await addMark(db, { datums: d, vards: W.vards, veids: 'beidz', laiks: t, anorm: s.anorm, amats: s.amats, phone, kas: phone });
    const m = Math.max(0, mins(t) - mins(s.sak));
    return { reply: adr(s.anorm) + '\nDarbs beigts ' + t + ' (' + dur(m) + ')\nPaldies!', anorm: s.anorm };
  }
  if (c.cmd === 'stat') {
    if (open.length) return { reply: adr(open[0].anorm) + '\nTu esi darbā kopš ' + open[0].sak + '\nBeigās sūti STOP', anorm: open[0].anorm };
    if (S.length) { const l = S[S.length - 1]; return { reply: 'Šodien: ' + adr(l.anorm) + '\n' + l.sak + '-' + l.beidz + '\nŠobrīd neesi darbā.', anorm: l.anorm }; }
    return { reply: 'Šodien neesi atzīmējies.\nSākot darbu sūti:\nSTART kods', anorm: W.anorm };
  }
  return { reply: 'Nesapratu.\nSTART kods - sākot darbu\nSTOP - beidzot\n? - statuss', anorm: W.anorm };
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
  const lid = await logSms(db, 'ien', phone, '', text, 'apstrādā', msgId);   // ieraksta PIRMS apstrādes — atkārtota piegāde = dublikāts
  const r = await handleSms(db, phone, text), known = !!(await workerOf(db, phone));
  await db.prepare('UPDATE dl_sms SET anorm = ?, statuss = ? WHERE id = ?').bind(r.anorm || '', known ? 'ok' : 'nezināms numurs', lid).run();
  if (!known) { const k = 'dl:unk:' + phone; if ((await kv(db, k)) === today()) r.reply = ''; else await kvSet(db, k, today()).run(); }   // nezināmam — atbilde reizi dienā
  if (r.reply) { const job = sendSms(env, [phone], r.reply, r.anorm); if (X && X.bg) X.bg(job); else await job; }
  return out({ ok: true });
}

/* ---------- atgādinājumi (no 5 min trigera) ---------- */
export async function reminders(env, force) {
  const db = env.DB, d = today(), t = hm(), C = await cfgOf(db);
  if (!C.atgadinat || dow(d) > 5 || (!force && lvHolidays(+d.slice(0, 4)).has(d))) return { rits: 0, vakars: 0 };   // svētku dienās nesūta
  let a = 0, b = 0;
  const due = async (k) => (await kv(db, k)) !== d, done = (k) => kvSet(db, k, d).run();   // atzīme PĒC sūtīšanas
  if ((force ? force === 'rits' : (mins(t) >= mins(C.rits) && mins(t) < mins(C.rits) + 120)) && await due('dl:remRits')) {
    const O = (await objs(db)).filter(o => o.aktivs), S = sessions(await marksOn(db, d)), W = await allAssign(db);
    for (const o of O) { const sent = new Set();   // «abi» darbiniekam vienā objektā tikai viena SMS
      for (const am of ['uzk', 'set']) {
      if (!(am === 'uzk' ? o.vajag_uzk : o.vajag_set) || roleState(S, o.anorm, am).statuss !== 'nav') continue;
      const to = [...new Set(W.filter(w => w.anorm === o.anorm && fits(w.amats, am) && !sent.has(w.phone) && !S.some(s => s.phone === w.phone && s.anorm === o.anorm)).map(w => w.phone))];
      to.forEach(p => sent.add(p));
      if (to.length) a += await sendSms(env, to, 'Atgādinājums: ' + o.adrese + '\nŠodien neesi atzīmējies darbā.\nSākot darbu sūti:\nSTART ' + o.kods, o.anorm);
    } }
    await done('dl:remRits');
  }
  if ((force ? force === 'vakars' : (mins(t) >= mins(C.vakars) && mins(t) < mins(C.vakars) + 120)) && await due('dl:remVak')) {
    const O = await objs(db), open = sessions(await marksOn(db, d)).filter(s => !s.beidz && s.phone);
    for (const s of open) { const o = O.find(x => x.anorm === s.anorm) || { adrese: s.anorm };
      b += await sendSms(env, [s.phone], o.adrese + '\nTu joprojām esi atzīmēts darbā.\nJa esi beidzis, sūti STOP', s.anorm); }
    await done('dl:remVak');
  }
  return { rits: a, vakars: b };
}
export async function cron(env) { if (env.SMS_USER) await reminders(env); }

/* ---------- API portālam un lietotnei ---------- */
const hidePh = (p) => p ? p.slice(0, 5) + '•••' + p.slice(-2) : '';
async function boot(db, d, role) {
  const O = (await objs(db)).filter(o => o.aktivs), S = sessions(await marksOn(db, d)), st = O.map(o => objState(o, S));
  const AS = await allAssign(db);   // katram piesaistītajam darbiniekam savs aplītis
  st.forEach(r => ['uzk', 'set'].forEach(k => { if (r[k].statuss === 'nevajag') return;
    const mine = S.filter(s => s.anorm === r.anorm && fits(s.amats, k));
    const ph = [...new Set(AS.filter(w => w.anorm === r.anorm && fits(w.amats, k)).map(w => w.phone).concat(mine.map(s => s.phone || s.vards)))];
    r[k].ppl = ph.map(p => { const x = mine.filter(s => (s.phone || s.vards) === p); return !x.length ? 'nav' : x.some(s => !s.beidz) ? 'darba' : 'beidza'; }); }));
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
    const f = (am, need) => !need ? 'nevajag' : fut ? '' : x.some(s => s.anorm === anorm && (s.amats === am || s.amats === 'abi')) ? 'ok' : (i >= 5 ? 'brivs' : 'nav');
    return { datums: dd, uzk: f('uzk', o.vajag_uzk), set: f('set', o.vajag_set) }; });
  const mStart = d.slice(0, 8) + '01', MS = sessions(await marksOn(db, mStart, d)).filter(s => s.anorm === anorm);
  const W = await workersAt(db, anorm, true), Oall = await objs(db), Wall = await all(db, 'SELECT phone, vards, amats FROM dl_worker');
  const sms = await all(db, 'SELECT laiks, virziens, phone, anorm, teksts, statuss FROM dl_sms WHERE anorm = ? AND laiks >= ? ORDER BY laiks DESC LIMIT 30', anorm, d);
  const roleP = (k) => { if (!(k === 'uzk' ? o.vajag_uzk : o.vajag_set)) return [];   // katrs lomas darbinieks atsevišķi
    const mine = day.filter(s => s.anorm === anorm && fits(s.amats, k));
    const keys = [...new Set(W.filter(w => w.aktivs && fits(w.amats, k)).map(w => w.phone).concat(mine.map(s => s.phone || s.vards)))];
    return keys.map(p => { const w = W.find(x => x.phone === p), x = mine.filter(s => (s.phone || s.vards) === p);
      return { vards: role >= 2 ? ((w && w.vards) || (x[0] && x[0].vards) || '') : '', statuss: !x.length ? 'nav' : x.some(s => !s.beidz) ? 'darba' : 'beidza', posmi: x.map(s => ({ sak: s.sak, beidz: s.beidz, min: s.min })) }; }); };
  return { objekts: objState(o, day), datums: d, ppl: { uzk: roleP('uzk'), set: roleP('set') }, posmi: day.filter(s => s.anorm === anorm).map(s => ({ amats: s.amats, vards: role >= 2 ? s.vards : '', sak: s.sak, beidz: s.beidz, min: s.min, ids: role >= 3 ? s.ids : [] })),
    nedela: week, menesis: { uzk: MS.filter(s => s.amats === 'uzk').reduce((n, s) => n + s.min, 0), set: MS.filter(s => s.amats === 'set').reduce((n, s) => n + s.min, 0), abi: MS.filter(s => s.amats === 'abi').reduce((n, s) => n + s.min, 0) },
    darbinieki: W.map(w => ({ vards: role >= 2 ? w.vards : '', amats: w.amats, phone: role >= 2 ? w.phone : hidePh(w.phone), aktivs: !!w.aktivs })), sms: sms.map(x => smsRow(x, Oall, Wall, role)) };
}
async function tabele(db, no, lidz, role) {
  if (!isD(no) || !isD(lidz) || lidz < no) throw new Error('Nepareizs periods'); if (addDays(no, 92) < lidz) throw new Error('Periods līdz 3 mēnešiem');
  const O = await objs(db), S = sessions(await marksOn(db, no, lidz)), td = today(), days = [];
  for (let d = no; d <= lidz && d <= td; d = addDays(d, 1)) days.push(d);
  const rows = O.filter(o => o.aktivs || S.some(s => s.anorm === o.anorm)).map(o => {
    const x = S.filter(s => s.anorm === o.anorm), miss = days.filter(d => dow(d) <= 5 && ((o.vajag_uzk && !x.some(s => s.datums === d && (s.amats === 'uzk' || s.amats === 'abi'))) || (o.vajag_set && !x.some(s => s.datums === d && (s.amats === 'set' || s.amats === 'abi')))));
    return { anorm: o.anorm, adrese: o.adrese, kods: o.kods, navBeigu: x.filter(s => !s.beidz && s.datums < td).length, uzk: x.filter(s => s.amats === 'uzk').reduce((n, s) => n + s.min, 0), set: x.filter(s => s.amats === 'set').reduce((n, s) => n + s.min, 0), abi: x.filter(s => s.amats === 'abi').reduce((n, s) => n + s.min, 0), trukaDienas: miss };
  });
  const det = S.map(s => ({ datums: s.datums, adrese: (O.find(o => o.anorm === s.anorm) || {}).adrese || s.anorm, amats: s.amats, vards: role >= 2 ? s.vards : '', sak: s.sak, beidz: s.beidz, min: s.min,
    navBeigu: !s.beidz && s.datums < td }));   // aizmirsts STOP — 0 h, jālabo
  return { no, lidz, rindas: rows, kopa: { uzk: rows.reduce((n, r) => n + r.uzk, 0), set: rows.reduce((n, r) => n + r.set, 0), abi: rows.reduce((n, r) => n + r.abi, 0) }, detalas: det };
}
/** Nostrādātais pa darbiniekiem (Personāla algām): { phone: { vards, min, dienas } } periodā no..lidz (YYYY-MM-DD) */
export async function workerHours(db, no, lidz) {
  const out = {};
  for (const x of sessions(await marksOn(db, no, lidz))) { const k = x.phone || ('v:' + String(x.vards || '').toLowerCase()); const o = out[k] || (out[k] = { vards: x.vards || '', phone: x.phone || '', min: 0, dienas: new Set() });
    o.min += x.min || 0; o.dienas.add(x.datums); if (!x.beidz && x.datums < today()) o.navBeigu = (o.navBeigu || 0) + 1; }
  Object.values(out).forEach(o => o.dienas = o.dienas.size);
  return out;
}
async function recipients(db, b) {
  const W = await all(db, 'SELECT phone, amats, anorm FROM dl_worker WHERE aktivs = 1'), k = b.kam;
  const uniq = (L) => { const m = new Map(); L.forEach(w => m.set(w.phone, w)); return [...m.values()]; };
  if (k === 'set' || k === 'uzk') { const A = await allAssign(db); return uniq(W.filter(w => fits(w.amats, k) || A.some(x => x.phone === w.phone && fits(x.amats, k)))); }
  if (k === 'obj') return uniq((await workersAt(db, b.anorm)).filter(w => !b.amats || fits(w.amats, b.amats)));
  if (k === 'nav') { const S = sessions(await marksOn(db, today())); return W.filter(w => !S.some(s => s.phone === w.phone)); }
  return W;
}
/* Vadītāja objekts: objekts.vaditajs = vārds vai tikai priekšvārds (piem. «Rostislavs» ↔ «Rostislavs F.») */
const nm = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const isMine = (vad, name) => { const a = nm(vad), b = nm(name); return !!a && !!b && (a === b || a === b.split(' ')[0] || b.startsWith(a + ' ') || a.startsWith(b + ' ')); };
/** Vadītāja darbinieki: strādā viņa objektos vai viņš pievienoja */
async function myPhones(db, name) {
  const O = (await all(db, 'SELECT anorm, vaditajs FROM objects')).filter(o => isMine(o.vaditajs, name)).map(o => o.anorm), set = new Set(O);
  const W = await all(db, 'SELECT phone, anorm, pievienoja FROM dl_worker'), A = await all(db, 'SELECT phone, anorm FROM dl_assign');
  return { objekti: O, phones: [...new Set(W.filter(w => set.has(w.anorm) || isMine(w.pievienoja, name)).map(w => w.phone).concat(A.filter(a => set.has(a.anorm)).map(a => a.phone)))] };
}
async function iestatijumi(db) {
  const all_o = await all(db, `SELECT o.anorm, o.adrese, o.vaditajs, o.grupa, d.kods, d.vajag_uzk, d.vajag_set, d.aktivs FROM objects o LEFT JOIN dl_obj d ON d.anorm = o.anorm ORDER BY o.adrese`);
  const inh = await dlInherit(db).catch(() => ({}));
  return { objekti: all_o.map(o => ({ anorm: o.anorm, adrese: o.adrese, vaditajs: o.vaditajs, grupa: o.grupa, kods: o.kods || '', vajag_uzk: o.kods ? !!o.vajag_uzk : true, vajag_set: o.kods ? !!o.vajag_set : true, aktivs: !!(o.kods && o.aktivs), apv: inh[o.anorm] || null })),
    darbinieki: await all(db, 'SELECT phone, vards, amats, anorm, aktivs, pievienoja FROM dl_worker ORDER BY vards, phone'), piesaistes: await all(db, 'SELECT phone, anorm, amats FROM dl_assign'), cfg: await cfgOf(db) };
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
      return out({ ok: true, nosutits: await sendSms(env, to, 'Atgādinājums: ' + o.adrese + '\nNeesi atzīmējies darbā.\nSākot darbu sūti:\nSTART ' + o.kods, o.anorm) }); }
    if (a === 'labot') { need(3);
      if (b.aizvert) { if (!okT(b.laiks)) throw new Error('Laiks HH:MM'); const m = await db.prepare("SELECT * FROM dl_mark WHERE id = ? AND veids = 'sak'").bind(b.aizvert).first(); if (!m) throw new Error('Atzīme nav atrasta');
        if (mins(b.laiks) < mins(m.laiks)) throw new Error('Beigas nevar būt pirms sākuma ' + m.laiks);
        await addMark(db, { datums: m.datums, vards: m.vards, veids: 'beidz', laiks: b.laiks, anorm: m.anorm, amats: m.amats, phone: m.phone, avots: 'labots', kas: me.name }); return out({ ok: true }); }
      if (b.id) { if (b.atcelt) await db.prepare("UPDATE dl_mark SET veids = 'atcelts', kas = ? WHERE id = ?").bind(me.name, b.id).run();
        else { if (!okT(b.laiks)) throw new Error('Laiks HH:MM'); await db.prepare('UPDATE dl_mark SET laiks = ?, kas = ?, avots = ? WHERE id = ?').bind(b.laiks, me.name, 'labots', b.id).run(); }
        return out({ ok: true }); }
      const am = AMS.indexOf(b.amats) !== -1 ? b.amats : 'uzk'; if (!b.anorm || !okT(b.sak) || (b.beidz && !okT(b.beidz))) throw new Error('Norādi objektu un laiku HH:MM');
      const m = { datums: d, vards: String(b.vards || '').slice(0, 80), anorm: b.anorm, amats: am, phone: normPhone(b.phone), avots: 'labots', kas: me.name };
      await addMark(db, Object.assign({}, m, { veids: 'sak', laiks: b.sak })); if (b.beidz) await addMark(db, Object.assign({}, m, { veids: 'beidz', laiks: b.beidz }));
      return out({ ok: true }); }
    if (a === 'iestatijumi') { need(2); const r = await iestatijumi(db), m = await myPhones(db, me.name); return out(Object.assign({ ok: true, mani: m.phones, maniObj: m.objekti }, r)); }
    if (a === 'saveObj') { need(3); const k = String(b.kods || '').trim().toUpperCase();
      if (!b.anorm) throw new Error('Nav objekta');
      const inh = (await dlInherit(db))[b.anorm]; if (inh && k) throw new Error('Šī māja ir apvienotajā objektā «' + inh.adrese + '» — kods ' + inh.kods + ' tiek ņemts no tā');
      if (!k) { await db.prepare('UPDATE dl_obj SET aktivs = 0 WHERE anorm = ?').bind(b.anorm).run(); return out({ ok: true }); }
      if (!/^[0-9A-Z-]{1,8}$/.test(k)) throw new Error('Kods — līdz 8 cipariem/burtiem, piem. 104');
      const other = await db.prepare('SELECT anorm FROM dl_obj WHERE kods = ? AND anorm != ?').bind(k, b.anorm).first(); if (other) throw new Error('Kods ' + k + ' jau ir citam objektam');
      await db.prepare('INSERT INTO dl_obj (anorm, kods, vajag_uzk, vajag_set, aktivs) VALUES (?, ?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET kods = excluded.kods, vajag_uzk = excluded.vajag_uzk, vajag_set = excluded.vajag_set, aktivs = excluded.aktivs')
        .bind(b.anorm, k, b.vajag_uzk === false ? 0 : 1, b.vajag_set === false ? 0 : 1, b.aktivs === false ? 0 : 1).run();
      await dlSync(db, b.anorm); return out({ ok: true }); }
    if (a === 'delWorker') { need(3); const p = normPhone(b.phone); if (!p) throw new Error('Nav tālruņa');   // atzīmes un SMS vēsture paliek
      await db.batch([db.prepare('DELETE FROM dl_worker WHERE phone = ?').bind(p), db.prepare('DELETE FROM dl_assign WHERE phone = ?').bind(p)]); return out({ ok: true }); }
    if (a === 'unassign') { need(2); const p = normPhone(b.phone), an = String(b.anorm || ''); if (!p || !an) throw new Error('Nav datu');   // noņem darbinieku no objekta; nedzēš
      if (W < 3 && (await myPhones(db, me.name)).phones.indexOf(p) === -1) throw new Error('Šis darbinieks ir cita vadītāja — noņemt var administrators');
      await db.prepare('DELETE FROM dl_assign WHERE phone = ? AND anorm = ?').bind(p, an).run();
      const rest = await all(db, 'SELECT anorm FROM dl_assign WHERE phone = ? ORDER BY anorm', p), w0 = await workerOf(db, p);
      let ak = 1; if (w0) { const na = w0.anorm === an ? (rest[0] ? rest[0].anorm : '') : w0.anorm; ak = na || rest.length ? w0.aktivs : 0;
        await db.prepare('UPDATE dl_worker SET anorm = ?, aktivs = ? WHERE phone = ?').bind(na, ak, p).run(); }
      return out({ ok: true, neaktivs: !ak }); }
    if (a === 'saveWorker') { need(2); const p = normPhone(b.phone); if (!p) throw new Error('Nepareizs tālrunis — ievadiet valsts kodu un numuru');
      if (String(b.vards || '').trim().split(/\s+/).filter(x => x.length > 1).length < 2) throw new Error('Ierakstiet pilnu vārdu un uzvārdu');
      if (b.aktivs !== false) {   // aktīvam darbiniekam obligāti: vismaz viens objekts ar amatu
        const L = Array.isArray(b.objekti) ? b.objekti.filter(x => x && x.anorm) : [];
        if (!L.length) throw new Error('Pievienojiet vismaz vienu objektu');
        if (L.some(x => AMS.indexOf(x.amats) === -1)) throw new Error('Katram objektam izvēlieties amatu');
        const ok = new Set((await all(db, 'SELECT anorm FROM objects')).map(o => o.anorm)); if (L.some(x => !ok.has(x.anorm))) throw new Error('Objekts nav atrasts sarakstā');
      }
      const wasNew = !(await workerOf(db, normPhone(b.oldPhone) || p));
      if (W < 3) {   // vadītājs: jauns darbinieks vai savējais
        const ex = normPhone(b.oldPhone) || p, mine = (await myPhones(db, me.name)).phones;
        if ((await workerOf(db, ex)) && mine.indexOf(ex) === -1) throw new Error('Šis darbinieks ir cita vadītāja — labot var administrators');
        if (!normPhone(b.oldPhone) && await workerOf(db, p)) throw new Error('Darbinieks ar šo numuru jau ir sarakstā');
      }
      const am = AMS.indexOf(b.amats) !== -1 ? b.amats : 'uzk', old = normPhone(b.oldPhone);
      if (old && old !== p) { if (await workerOf(db, p)) throw new Error('Šis numurs jau ir sarakstā'); await db.batch([db.prepare('UPDATE dl_worker SET phone = ? WHERE phone = ?').bind(p, old), db.prepare('UPDATE dl_assign SET phone = ? WHERE phone = ?').bind(p, old)]); }
      if (Array.isArray(b.objekti)) {   // objekti un amats katrā: [{ anorm, amats }]
        const L = b.objekti.filter(x => x && x.anorm).map(x => ({ anorm: String(x.anorm), amats: AMS.indexOf(x.amats) !== -1 ? x.amats : am }));
        await db.batch([db.prepare('DELETE FROM dl_assign WHERE phone = ?').bind(p), ...L.map(x => db.prepare('INSERT OR REPLACE INTO dl_assign (phone, anorm, amats) VALUES (?, ?, ?)').bind(p, x.anorm, x.amats))]);
        if (!b.anorm && L.length) b.anorm = L[0].anorm;
      }
      await db.prepare('INSERT INTO dl_worker (phone, vards, amats, anorm, aktivs, pievienoja) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET vards = excluded.vards, amats = excluded.amats, anorm = excluded.anorm, aktivs = excluded.aktivs')
        .bind(p, String(b.vards || '').trim().replace(/\s+/g, ' ').slice(0, 80), am, String(b.anorm || ''), b.aktivs === false ? 0 : 1, me.name).run();
      let welcome = null;   // jaunam aktīvam darbiniekam — SMS ar instrukciju un kodiem (ja nav atslēgts ar b.noSms)
      if (wasNew && b.aktivs !== false && !b.noSms) welcome = await sendWelcome(env, p, false).catch(e => ({ sent: false, why: String(e.message || e) }));
      return out({ ok: true, phone: p, welcome }); }
    if (a === 'welcome') { need(2); const p = normPhone(b.phone); if (!p) throw new Error('Nepareizs tālrunis');
      if (W < 3 && (await myPhones(db, me.name)).phones.indexOf(p) === -1) throw new Error('Šis darbinieks ir cita vadītāja');
      if (b.preview) return out({ ok: true, text: await welcomeText(db, p) });
      return out(Object.assign({ ok: true }, await sendWelcome(env, p, true))); }
    if (a === 'saveCfg') { need(3); const c = Object.assign({}, await cfgOf(db));
      if (okT(b.rits)) c.rits = b.rits; if (okT(b.vakars)) c.vakars = b.vakars; if (typeof b.atgadinat === 'boolean') c.atgadinat = b.atgadinat; if (b.numurs != null) c.numurs = normPhone(b.numurs) || '';
      await kvSet(db, 'dl:cfg', c).run(); return out({ ok: true, cfg: c }); }
    if (a === 'registerHook') { need(3);
      if (!env.SMS_USER || !env.SMS_PASS || !env.DL_HOOK_KEY) throw new Error('Worker noslēpumi SMS_USER, SMS_PASS, DL_HOOK_KEY nav iestatīti');
      const u = new URL(request.url), i = u.pathname.indexOf('/dl'), base = u.origin + (i > 0 ? u.pathname.slice(0, i) : ''), res = [];   // piem. https://vaitkevix.cloud/sh/api
      try {   // vecās (arī nepareizās) /dl/sms adreses noņem, lai nedublējas
        const old = await (await fetch(SMS_API + '/webhooks', { headers: { Authorization: gwAuth(env) } })).json();
        for (const w of (Array.isArray(old) ? old : [])) if (/\/dl\/sms/.test(w.url || '') && w.id) await fetch(SMS_API + '/webhooks/' + encodeURIComponent(w.id), { method: 'DELETE', headers: { Authorization: gwAuth(env) } });
      } catch (e) { console.error('webhooks', e); }
      for (const ev of ['sms:received', 'system:ping']) { const r = await fetch(SMS_API + '/webhooks', { method: 'POST', headers: { Authorization: gwAuth(env), 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: base + '/dl/sms?key=' + encodeURIComponent(env.DL_HOOK_KEY), event: ev }) }); res.push(ev + ': ' + r.status); }
      return out({ ok: true, rezultats: res }); }
    return out({ ok: false, error: 'Nezināma darbība' });
  } catch (e) { return out({ ok: false, error: e.message || String(e) }); }
}
