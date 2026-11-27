/* SH | Rīta ziņa vadītājam (07:15, cron): katram darbu vadītājam (objects.vaditajs) — šodienas darbi viņa objektos, vakar nepaspētie / «nevar»,
 * kas nav sācis darbu (Darba laiks, START līdz 08:00), atvērtās pretenzijas, iedzīvotāju pieteikumi, obligāto pārbaužu termiņi, laika prognoze
 * un AI 2–3 teikumi «Kam pievērst uzmanību» (kešs dienā, kv rits:ai:<datums>:<vārds>, limits aiLimit 'rits').
 * Push vienmēr (ja vadītājs nav izslēdzis — kv rits:off), e-pasts tikai, ja Administrēšana → E-pasts «Rīta ziņa vadītājiem» (kv mail:rits.on, noklusējumā izslēgts).
 * Portāla kartīte «Rīta ziņa» rāda to pašu (kv rits:d:<datums>:<vārds>). © VAITKEVIX, SIA */
import { today, addDays, nowStr, lvD, kv, kvSet } from './util.js';
import { notify } from './webpush.js';
import { aiContent, aiLimit } from './ai.js';
import { notStarted, isWorkday } from './noshow.js';
import * as mail from './mail.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIS = [['pl', 'pl_visit', 'Pļaušana'], ['logi', 'logi_visit', 'Logi'], ['darz', 'darz_visit', 'Dārzs'], ['stav', 'stav_visit', 'Stāvvieta'], ['sniegs', 'sniegs_visit', 'Sniegs']];
const APPN = { aizv: 'Aizvietošana', pl: 'Pļaušana', logi: 'Logi', darz: 'Dārzs', stav: 'Stāvvieta', sniegs: 'Sniegs' };

export async function offList(db) { const L = await kv(db, 'rits:off'); return Array.isArray(L) ? L : []; }
export async function mailCfg(db) { return Object.assign({ on: false }, (await kv(db, 'mail:rits')) || {}); }

/** Vadītāja rīta ziņas dati (bez AI). d — diena; now — HH:MM (kas nav START: pēc 08:00 šodien, citādi vakar) */
export async function digest(env, name, d, now) {
  const db = env.DB, y = addDays(d, -1);
  const O = await all(db, 'SELECT anorm, adrese FROM objects WHERE vaditajs = ? ORDER BY ord, adrese', name);
  if (!O.length) return null;
  const mine = new Set(O.map(o => o.anorm)), adr = {}; O.forEach(o => adr[o.anorm] = o.adrese);
  const sodien = [], vakar = [];
  for (const [app, T] of VIS) {
    (await all(db, `SELECT anorm, adrese, datums, statuss FROM ${T} WHERE datums IN (?, ?)`, d, y).catch(() => [])).forEach(r => {
      if (!mine.has(r.anorm)) return;
      if (r.datums === d && r.statuss === 'plan') sodien.push({ app, adrese: r.adrese });
      if (r.datums === y && ((r.statuss === 'plan' && app !== 'sniegs') || r.statuss === 'cant')) vakar.push({ app, adrese: r.adrese, st: r.statuss === 'cant' ? 'nevar' : 'nepaspēts' });
    });
  }
  (await all(db, 'SELECT anorm, adrese, datums, tips, brigade, statuss FROM jobs WHERE datums IN (?, ?)', d, y).catch(() => [])).forEach(r => {
    if (!mine.has(r.anorm)) return;
    if (r.datums === d && r.statuss !== 'izpildīts') sodien.push({ app: 'aizv', adrese: r.adrese, tips: r.tips, bez: !r.brigade });
    if (r.datums === y && r.statuss !== 'izpildīts') vakar.push({ app: 'aizv', adrese: r.adrese, st: r.statuss === 'nevar izpildīt' ? 'nevar' : 'nepaspēts' });
  });
  const later = now >= '08:00', nd = later ? d : y;
  const nav = (later || isWorkday(y)) && isWorkday(nd) ? (await notStarted(db, nd, '08:00', mine).catch(() => [])).map(w => ({ vards: w.vards, sak: w.sak, objekti: w.objs.map(o => o.adrese) })) : [];
  const claims = (await all(db, "SELECT app, anorm, adrese, datums, teksts FROM claim WHERE statuss = 'atverta'").catch(() => [])).filter(c => mine.has(c.anorm)).map(c => ({ app: c.app, adrese: c.adrese, datums: c.datums, teksts: String(c.teksts || '').slice(0, 120) }));
  const req = (await all(db, "SELECT anorm, kategorija, steidz, avots FROM ml_req WHERE statuss = 'jauns'").catch(() => [])).filter(r => mine.has(r.anorm)).map(r => ({ adrese: adr[r.anorm], kategorija: r.kategorija, steidz: r.steidz, avots: r.avots }));
  const lim = addDays(d, 7);
  const iek = (await all(db, 'SELECT * FROM ml_iek WHERE aktivs = 1').catch(() => [])).filter(i => mine.has(i.anorm)).map(i => {
    const n = i.nakama || (i.pedeja ? addMonthsS(i.pedeja, i.intervals || 12) : ''); return { adrese: adr[i.anorm], nosaukums: i.nosaukums || i.veids, nakama: n };
  }).filter(i => i.nakama && i.nakama <= lim).sort((a, b) => a.nakama.localeCompare(b.nakama)).slice(0, 10);
  const W = (await kv(db, 'wx')) || {}, wx = W[d] ? { r: W[d].r, s: W[d].s, t: W[d].t } : null;
  return { datums: d, vards: name, objekti: O.length, sodien, vakar, nav, navD: nd, claims, req, iek, wx };
}
function addMonthsS(d, n) { const x = new Date(d + 'T12:00:00Z'), day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); }
export const isEmpty = (D) => !D || !(D.sodien.length || D.vakar.length || D.nav.length || D.claims.length || D.req.length || D.iek.length);

export function wxText(w) {
  if (!w) return '';
  const p = []; if (w.t != null) p.push('min ' + Math.round(w.t) + '°');
  if (w.s >= 0.5) p.push('sniegs ' + Math.round(w.s) + ' cm'); else if (w.r >= 1) p.push('lietus ' + Math.round(w.r) + ' mm');
  if (w.t != null && w.t <= 0 && w.r >= 0.5) p.push('iespējams apledojums');
  return p.join(', ');
}
/** Īss kopsavilkums bez AI (push teksts, ja AI nav) */
export function plain(D) {
  const p = [];
  if (D.sodien.length) p.push(D.sodien.length + ' darbi šodien');
  if (D.vakar.length) p.push(D.vakar.length + ' vakar nepaspēti');
  if (D.nav.length) p.push(D.nav.length + ' bez START');
  if (D.claims.length) p.push(D.claims.length + ' pretenzijas');
  if (D.req.length) p.push(D.req.length + ' jauni pieteikumi');
  if (D.iek.length) p.push(D.iek.length + ' pārbaužu termiņi');
  const w = wxText(D.wx); if (w) p.push(w);
  return p.join(' · ') || 'Viss kārtībā';
}

const SYS = 'Tu esi apsaimniekošanas uzņēmuma darbu vadītāja asistents. No dotajiem faktiem uzraksti 2–3 īsus teikumus latviešu valodā «Kam šodien pievērst uzmanību». ' +
  'Svarīgākais pirmais (nav atnākuši darbinieki, steidzami pieteikumi, pretenzijas, nokavētas pārbaudes, laikapstākļi). Neizdomā neko, ko faktos nav; adreses raksti precīzi. Bez ievada un sveiciena, bez saraksta zīmēm.';
/** AI teksts ar kešu dienā (vienam vadītājam vienreiz dienā). Kļūda → '' */
export async function aiText(env, D) {
  if (!env.ANTHROPIC_API_KEY || isEmpty(D)) return '';
  const k = 'rits:ai:' + D.datums + ':' + D.vards, c = await kv(env.DB, k); if (c && c.t) return c.t;
  try {
    await aiLimit(env.DB, 'rits', 80);
    const f = (L, fn, n) => L.slice(0, n || 8).map(fn).join('; ');
    const facts = [
      'Objekti: ' + D.objekti,
      D.sodien.length && 'Šodien darbi (' + D.sodien.length + '): ' + f(D.sodien, x => (APPN[x.app] || x.app) + ' ' + x.adrese + (x.bez ? ' (bez brigādes)' : ''), 10),
      D.vakar.length && 'Vakar nepaspēti / nevar (' + D.vakar.length + '): ' + f(D.vakar, x => (APPN[x.app] || x.app) + ' ' + x.adrese + ' — ' + x.st),
      D.nav.length && (D.navD === D.datums ? 'Šodien' : 'Vakar') + ' līdz 08:00 nav START: ' + f(D.nav, x => x.vards + ' (' + x.objekti.slice(0, 2).join(', ') + ')'),
      D.claims.length && 'Atvērtas pretenzijas: ' + f(D.claims, x => x.adrese + ': ' + x.teksts, 5),
      D.req.length && 'Jauni pieteikumi (iedzīvotāji/darbinieki): ' + f(D.req, x => x.adrese + ' — ' + (x.kategorija || 'cits') + (x.steidz === 'augsta' ? ' (steidzami)' : ''), 6),
      D.iek.length && 'Pārbaužu termiņi ≤7 d. vai nokavēti: ' + f(D.iek, x => x.adrese + ' ' + x.nosaukums + ' līdz ' + x.nakama, 6),
      D.wx && 'Laiks šodien: ' + wxText(D.wx)].filter(Boolean).join('\n');
    const t = String(await aiContent(env, 'Šodien ' + D.datums + '. Fakti:\n' + facts, 400, SYS)).trim().replace(/^["„“]|["”“]$/g, '').slice(0, 600);
    await kvSet(env.DB, k, { t }).run();
    return t;
  } catch (e) { console.error('rits ai', e); return ''; }
}

function html(D) {
  const sec = (h, L, fn) => L.length ? `<h3 style="margin:16px 0 6px;font-size:15px">${esc(h)} · ${L.length}</h3><div style="font-size:14px;line-height:1.5">${L.slice(0, 25).map(x => '<div>' + fn(x) + '</div>').join('')}</div>` : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#17201c;max-width:640px"><div style="font-weight:800;letter-spacing:.08em;color:#0f6b5c;font-size:12px">SELECTUM HOME</div>
    <h2 style="margin:6px 0 4px;font-size:20px">Rīta ziņa · ${esc(lvD(D.datums))}</h2><p style="margin:0 0 10px;color:#4a534f">${esc(D.vards)} · ${D.objekti} objekti${D.wx ? ' · ' + esc(wxText(D.wx)) : ''}</p>
    ${D.ai ? `<p style="margin:0 0 6px;padding:10px 12px;background:#eef7f3;border-radius:10px;font-size:14px"><b>Kam pievērst uzmanību:</b> ${esc(D.ai)}</p>` : ''}
    ${sec(D.navD === D.datums ? 'Nav sācis darbu līdz 08:00' : 'Vakar nesāka darbu līdz 08:00', D.nav, x => '<b>' + esc(x.vards) + '</b> — ' + esc(x.objekti.join(', ')) + (x.sak ? ' (START ' + esc(x.sak) + ')' : ''))}
    ${sec('Vakar nepaspēts / nevar', D.vakar, x => esc(APPN[x.app] || x.app) + ' · ' + esc(x.adrese) + ' — ' + esc(x.st))}
    ${sec('Šodien darbi', D.sodien, x => esc(APPN[x.app] || x.app) + ' · ' + esc(x.adrese) + (x.bez ? ' (bez brigādes)' : ''))}
    ${sec('Atvērtās pretenzijas', D.claims, x => esc(x.adrese) + ' (' + esc(lvD(x.datums)) + '): ' + esc(x.teksts))}
    ${sec('Jauni pieteikumi', D.req, x => esc(x.adrese) + ' — ' + esc(x.kategorija || 'cits') + (x.steidz === 'augsta' ? ' · steidzami' : ''))}
    ${sec('Pārbaužu termiņi', D.iek, x => esc(x.adrese) + ' · ' + esc(x.nosaukums) + ' — ' + esc(lvD(x.nakama)))}
    <p style="margin:16px 0 0;font-size:12px;color:#6d7672">Atveriet portālu: https://vaitkevix.cloud/sh/ · Izslēgt var portālā kartītē «Rīta ziņa». © VAITKEVIX, SIA</p></div>`;
}

/** Visiem vadītājiem (vai only). force — neatkarīgi no laika (admina poga). Atgriež atskaiti. */
export async function sendAll(env, force, only) {
  const db = env.DB, d = today(), now = nowStr().slice(11, 16), off = new Set(await offList(db)), mc = await mailCfg(db);
  const P = {}; (await all(db, 'SELECT name, email, active FROM people').catch(() => [])).forEach(p => P[p.name] = p);
  const names = (await all(db, "SELECT DISTINCT vaditajs v FROM objects WHERE vaditajs != ''")).map(r => r.v).filter(n => P[n] && P[n].active && (!only || n === only));
  const res = [];
  for (const n of names) {
    const D = await digest(env, n, d, now).catch(e => { console.error('rits', n, e); return null; });
    if (!D) continue;
    D.ai = await aiText(env, D); D.laiks = nowStr();
    await kvSet(db, 'rits:d:' + d + ':' + n, D).run();
    if (off.has(n) || isEmpty(D)) { res.push({ kam: n, skip: off.has(n) ? 'izslēgts' : 'nav ko ziņot' }); continue; }
    const sent = await notify(env, [n], { title: 'Rīta ziņa · ' + D.sodien.length + ' darbi šodien', body: (D.ai || plain(D)).slice(0, 220), url: '/sh/#rits' }).catch(() => 0);
    let em = '';
    if (mc.on && P[n].email && mail.valid(P[n].email)) {
      try { const r = await mail.send(env, { to: P[n].email, subject: 'Rīta ziņa ' + lvD(d) + ' · ' + plain(D).slice(0, 80), html: html(D), fromName: 'SELECTUM HOME' }); em = r.failed.length ? 'kļūda: ' + r.failed[0].error : 'nosūtīts'; }
      catch (e) { em = 'kļūda: ' + String(e.message || e).slice(0, 120); }
    }
    res.push({ kam: n, push: sent, epasts: em });
  }
  await kvSet(db, 'rits:log', { datums: d, laiks: nowStr(), res }).run();
  return { datums: d, res };
}
/** Cron ik 5 min: vienreiz dienā pēc 07:15 (līdz 10:00); tīra vecos kešus (> 7 d.) */
export async function cron(env) {
  const db = env.DB, d = today(), t = nowStr().slice(11, 16);
  if (t < '07:15' || t > '10:00' || (await kv(db, 'rits:last')) === d) return;
  await kvSet(db, 'rits:last', d).run();
  await db.prepare("DELETE FROM kv WHERE (k LIKE 'rits:d:%' OR k LIKE 'rits:ai:%') AND substr(k, instr(substr(k, 6), ':') + 6, 10) < ?").bind(addDays(d, -7)).run().catch(() => 0);
  await sendAll(env, false);
}

/** Portāla kartīte: šodienas ziņa (no cron keša, citādi aprēķina bez AI) + izslēgts? */
export async function card(env, name) {
  const db = env.DB, d = today(), off = (await offList(db)).indexOf(name) !== -1;
  let D = await kv(db, 'rits:d:' + d + ':' + name);
  if (!D) { D = await digest(env, name, d, nowStr().slice(11, 16)); if (!D) return null; D.ai = ''; }
  return Object.assign(D, { off, teksts: plain(D) });
}
export async function setOff(db, name, off) {
  const L = new Set(await offList(db)); if (off) L.add(name); else L.delete(name);
  await kvSet(db, 'rits:off', [...L]).run(); return { off: L.has(name) };
}
