// SH | Kaisāmmateriāls — bez Apps Script: pieteikumi D1 (kais_task), Google tabula «Kaisāmmateriāls · Pieteikumi» = kopija ar tām pašām kolonnām. © VAITKEVIX, SIA
// Ieslēdz kv «kais:native» = '1' (pēc imports()). Bildes: Drive caur veco GAS (saveFileToDrive), līdz būs R2.
import * as G from './sheets.js';
import * as F from './foto.js';
import { newJob, answer } from './siadarbs.js';
import { audit } from './audit.js';
import { today as todayR, addDays } from './util.js';
import { geocodeAddresses } from './izvesana.js';

const TAB = 'Kaisāmmateriāls · Pieteikumi';
const BAG_KG = 25, PENDING = 'Gaida piegādi', DONE = 'Piegādāts', CANCELLED = 'Atcelts';
const HEAD = ['ID', 'Datums', 'Adrese', 'Pasūtītājs', 'Materiāls', 'Pasūtīti maisi', 'Komentārs', 'Bilde (pieteikums)', 'Statuss', 'Kurjers',
  'Bilde (pēc piegādes)', 'Piegādāti maisi', 'Kurjera komentārs', 'Piegādes laiks', 'Pasūtīts (kg)', 'Piegādāts (kg)'];
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };

export const isNative = async (env) => (await kvGet(env.DB, 'kais:native')) === '1';

const out = (t) => ({ rowIndex: t.row, id: t.id, date: t.datums, address: t.adrese, requester: t.pasutitajs, material: t.materials, bagsEst: t.maisi, comment: t.komentars,
  photoBefore: t.foto_pirms, status: t.statuss || PENDING, sia: t.kurjers, photoAfter: t.foto_pec, m3Hauled: t.piegadati, carrierComment: t.kurj_kom, deliveredAt: t.piegadats, accepted: t.pienem || '', declined: t.nevar || '', problem: t.problema || '', problemPhoto: t.prob_foto || '', cancelled: t.atcelts || '' });

export async function tasks(db) { return (await all(db, 'SELECT * FROM kais_task ORDER BY row')).map(out); }
/** Agrāk kopija kv portālam; tagad portāls lasa kais_task ar SQL — nekas nav jādara. */
async function cache() {}

export async function initialData(db) {
  const [objs, ppl, comp, mat] = await Promise.all([all(db, 'SELECT adrese FROM objects ORDER BY ord, adrese'), all(db, 'SELECT name, phone, perms, active FROM people ORDER BY ord, name'),
    all(db, 'SELECT name, kinds, active FROM companies ORDER BY ord, name'), all(db, "SELECT value FROM lists WHERE kind = 'materiali' ORDER BY ord, value")]);
  const P = ppl.filter(p => { let x = {}; try { x = JSON.parse(p.perms || '{}'); } catch (e) {} return p.active && x.kais; });
  const phones = {};
  P.forEach(p => { let t = String(p.phone || '').trim(); if (/^\d{8}$/.test(t)) t = '+371 ' + t; if (t) phones[p.name] = t; });
  return { addresses: objs.map(o => o.adrese), people: P.map(p => p.name), siaList: comp.filter(c => c.active && String(c.kinds).split(',').indexOf('kurjers') !== -1).map(c => c.name),
    materials: mat.length ? mat.map(m => m.value) : ['Sāls', 'Smiltis', 'Sāls/smilts mix'], phones };
}

/** Kurjera parole (Uzņēmumi → Parole) */
export async function courierByPassword(db, pw) {
  const p = String(pw || '').trim().toUpperCase(); if (!p) return '';
  const m = (await all(db, "SELECT name, kinds FROM companies WHERE active = 1 AND pass = ?", p)).filter(c => String(c.kinds).split(',').indexOf('kurjers') !== -1);
  return m.length === 1 ? m[0].name : '';
}

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? '' : String(n); };
const nowLV = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return p.day + '.' + p.month + '.' + p.year + ' ' + p.hour + ':' + p.minute; };

/** photo: data:image → Drive (vecais GAS saveFileToDrive) — līdz R2 */
async function savePhoto(env, gas, data, name) {
  if (!data || !/^data:image\//.test(data)) return String(data || '');
  if (env.FOTO) return F.url(await F.put(env, data, { app: 'kais', name }));
  try { const t = JSON.parse(await gas('saveFileToDrive', JSON.stringify([data, name]))); return (t.ok && t.result) || ''; } catch (e) { return ''; }
}

export async function saveTask(env, ctx, gas, d) {
  const db = env.DB;
  if (!String(d.address || '').trim()) throw new Error('Nav norādīta adrese');
  {   // 2026-11-25: pieteikt var tikai Mājas lietas objektus
    const an = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const k = new Set(((await db.prepare('SELECT adrese FROM objects').all()).results || []).map(o => an(o.adrese)));
    if (!k.has(an(d.address))) throw new Error('Adrese «' + String(d.address).trim() + '» nav Mājas lietas objektu sarakstā. Izvēlies adresi no saraksta — jaunu objektu pievieno admins Mājas lietā.');
  }
  const id = /^KM-\d{10,}$/.test(String(d.id || '')) ? String(d.id) : 'KM-' + Date.now();
  if (await db.prepare('SELECT 1 FROM kais_task WHERE id = ?').bind(id).first()) return { status: 'success', id };
  const photo = d.photo ? await savePhoto(env, gas, d.photo, id + '_Pieteikums.jpg') : '';
  await db.prepare('INSERT INTO kais_task (id, row, datums, adrese, pasutitajs, materials, maisi, komentars, foto_pirms, statuss, sheet) SELECT ?, COALESCE(MAX(row), 1) + 1, ?, ?, ?, ?, ?, ?, ?, ?, 0 FROM kais_task')
    .bind(id, nowLV(), String(d.address || '').trim(), String(d.requester || ''), String(d.material || ''), num(d.bagsEst), String(d.comment || ''), photo, PENDING).run();
  await cache(db);
  ctx.waitUntil(pushSheet(env).catch(e => console.error('kais sheet', e)));
  ctx.waitUntil(newJob(env, 'kais', { adrese: String(d.address || '').trim(), materials: String(d.material || '') }));   // E1: SIA paziņojums
  return { status: 'success', id };
}

export async function completeTask(env, ctx, gas, d) {
  const db = env.DB;
  const t = await db.prepare('SELECT * FROM kais_task WHERE row = ?').bind(parseInt(d.rowIndex, 10) || 0).first();
  if (!t) return { status: 'error', message: 'Pieteikums netika atrasts' };
  if (t.statuss === DONE) return { status: 'error', message: 'Šis pieteikums jau ir atzīmēts kā piegādāts' };
  const photo = await savePhoto(env, gas, d.photoAfter || '', t.id + '_Piegadats.jpg');
  const u = await db.prepare('UPDATE kais_task SET statuss = ?, kurjers = ?, foto_pec = ?, piegadati = ?, kurj_kom = ?, piegadats = ?, sheet = 0 WHERE id = ? AND statuss != ?')
    .bind(DONE, String(d.sia || ''), photo || t.foto_pec, num(d.m3Hauled), String(d.carrierComment || ''), nowLV(), t.id, DONE).run();
  if (!(u.meta && u.meta.changes)) return { status: 'error', message: 'Šis pieteikums jau ir atzīmēts kā piegādāts' };   // dubults klikšķis / divi kurjeri
  await cache(db);
  ctx.waitUntil(pushSheet(env).catch(e => console.error('kais sheet', e)));
  return { status: 'success' };
}

/* ---------- problēma / atteikums (kurjers) un atcelšana ar iemeslu (admins vai pieteicējs) ---------- */
export async function reportProblem(env, gas, d, me) {
  const db = env.DB; d = d || {};
  if (!me || !((me.perms || {}).kais === 'kurjers' || isAdm(me))) return { status: 'error', message: 'Problēmu ziņot var kurjers vai administrators' };
  const reason = String(d.reason || '').trim().slice(0, 80); if (!reason) return { status: 'error', message: 'Izvēlieties iemeslu' };
  const t = await db.prepare('SELECT * FROM kais_task WHERE id = ?').bind(String(d.id || '')).first();
  if (!t) return { status: 'error', message: 'Pieteikums nav atrasts' };
  if ((t.statuss || PENDING) !== PENDING) return { status: 'error', message: 'Pieteikums vairs negaida piegādi' };
  const photo = d.photo ? await savePhoto(env, gas, d.photo, t.id + '_Problema.jpg') : '';
  const text = nowLV() + ' · ' + (me.name || '') + ' · ' + reason + (d.comment ? ' — ' + String(d.comment).trim().slice(0, 300) : '');
  await db.prepare('UPDATE kais_task SET problema = ?, prob_foto = ? WHERE id = ?').bind(text, photo || t.prob_foto || '', t.id).run();
  await audit(db, me.name, 'Kaisāmmateriāls', t.adrese, ['Problēma', t.problema || '', text]);
  return { status: 'success', tasks: await tasks(db) };
}
export async function cancelTask(env, d, me) {
  const db = env.DB; d = d || {};
  const t = await db.prepare('SELECT * FROM kais_task WHERE id = ?').bind(String(d.id || '')).first();
  if (!t) return { status: 'error', message: 'Pieteikums nav atrasts' };
  if (!me || me.company || !(isAdm(me) || ((me.perms || {}).kais === 'pieteicejs' && t.pasutitajs === me.name))) return { status: 'error', message: 'Atcelt var administrators vai pieteikuma autors' };
  if (d.undo) {
    if (t.statuss !== CANCELLED) return { status: 'error', message: 'Pieteikums nav atcelts' };
    await db.prepare('UPDATE kais_task SET statuss = ?, sheet = 0 WHERE id = ?').bind(PENDING, t.id).run();
    await audit(db, me.name, 'Kaisāmmateriāls', t.adrese, ['Statuss', CANCELLED, PENDING]);
    return { status: 'success', tasks: await tasks(db) };
  }
  if (t.statuss !== PENDING) return { status: 'error', message: 'Atcelt var tikai gaidošu pieteikumu' };
  const why = String(d.reason || '').trim().slice(0, 300); if (!why) return { status: 'error', message: 'Norādiet iemeslu' };
  await db.prepare('UPDATE kais_task SET statuss = ?, atcelts = ?, sheet = 0 WHERE id = ? AND statuss = ?').bind(CANCELLED, nowLV() + ' · ' + me.name + ' · ' + why, t.id, PENDING).run();
  await audit(db, me.name, 'Kaisāmmateriāls', t.adrese, [['Statuss', PENDING, CANCELLED], ['Atcelšanas iemesls', '', why]]);
  return { status: 'success', tasks: await tasks(db) };
}

/* ---------- sezonas pieteikumi (kais_reg): ziemā ik N dienas un/vai pēc apstiprināta sniega izsaukuma ---------- */
const inSeason = (r, d) => { const m = +String(d).slice(5, 7), a = +r.no_men || 1, b = +r.lidz_men || 12; return a <= b ? m >= a && m <= b : m >= a || m <= b; };
export async function regList(db, me) {
  if (!me || me.company || !(isAdm(me) || (me.perms || {}).kais === 'pieteicejs')) return { status: 'error', message: 'Sezonas pieteikumus pārvalda administrators vai pieteicējs' };
  return { status: 'success', list: await all(db, 'SELECT * FROM kais_reg ORDER BY aktivs DESC, adrese') };
}
export async function regSave(env, d, me) {
  const db = env.DB; d = d || {};
  if (!me || me.company || !(isAdm(me) || (me.perms || {}).kais === 'pieteicejs')) return { status: 'error', message: 'Sezonas pieteikumus pārvalda administrators vai pieteicējs' };
  const old = d.id ? await db.prepare('SELECT * FROM kais_reg WHERE id = ?').bind(String(d.id)).first() : null;
  if (d.id && !old) return { status: 'error', message: 'Nav atrasts' };
  if (old && !isAdm(me) && old.izveidoja !== me.name) return { status: 'error', message: 'Mainīt var tas, kas izveidoja, vai administrators' };
  const adrese = String(d.adrese || '').trim(); if (!adrese) return { status: 'error', message: 'Norādiet adresi' };
  if (!old || old.adrese !== adrese) { const an = (x) => String(x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!((await all(db, 'SELECT adrese FROM objects')).some(o => an(o.adrese) === an(adrese)))) return { status: 'error', message: 'Adrese nav Mājas lietas objektu sarakstā' }; }
  const ik = Math.max(0, Math.min(90, parseInt(d.ik, 10) || 0)), sn = d.sniegs ? 1 : 0;
  if (!ik && !sn) return { status: 'error', message: 'Norādiet «ik N dienas» vai atzīmējiet «pēc sniega izsaukuma»' };
  const v = { adrese, ik, sn, nak: /^\d{4}-\d{2}-\d{2}$/.test(String(d.nakamais || '')) ? String(d.nakamais) : (ik ? addDays(todayR(), ik) : ''), ak: d.aktivs === 0 || d.aktivs === false ? 0 : 1,
    no: Math.max(1, Math.min(12, +d.no_men || 11)), li: Math.max(1, Math.min(12, +d.lidz_men || 3)), mat: String(d.materials || 'Sāls').slice(0, 40), mai: String(d.maisi || '').replace(/[^0-9.,]/g, '').slice(0, 6), kom: String(d.komentars || '').slice(0, 300) };
  if (old) await db.prepare('UPDATE kais_reg SET adrese=?, ik=?, nakamais=?, aktivs=?, no_men=?, lidz_men=?, sniegs=?, materials=?, maisi=?, komentars=? WHERE id = ?').bind(v.adrese, v.ik, v.nak, v.ak, v.no, v.li, v.sn, v.mat, v.mai, v.kom, old.id).run();
  else await db.prepare('INSERT INTO kais_reg (id, adrese, ik, nakamais, aktivs, no_men, lidz_men, sniegs, materials, maisi, komentars, pasutitajs, izveidoja, izveidots) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('K' + Date.now().toString(36), v.adrese, v.ik, v.nak, v.ak, v.no, v.li, v.sn, v.mat, v.mai, v.kom, me.name, me.name, nowLV()).run();
  await audit(db, me.name, 'Kaisāmmateriāls', adrese, ['Sezonas pieteikums', old ? 'ik ' + old.ik + ' d.' + (old.sniegs ? ' + sniegs' : '') + (old.aktivs ? '' : ' (apturēts)') : '', 'ik ' + ik + ' d.' + (sn ? ' + sniegs' : '') + (v.ak ? '' : ' (apturēts)')]);
  return regList(db, me);
}
async function regTask(env, r, why) {
  const db = env.DB;
  if (await db.prepare('SELECT 1 FROM kais_task WHERE adrese = ? AND statuss = ?').bind(r.adrese, PENDING).first()) return 0;   // jau gaida — otru neveido
  const id = 'KM-' + (Date.now() + Math.floor(Math.random() * 1000));
  await db.prepare('INSERT INTO kais_task (id, row, datums, adrese, pasutitajs, materials, maisi, komentars, foto_pirms, statuss, sheet) SELECT ?, COALESCE(MAX(row), 1) + 1, ?, ?, ?, ?, ?, ?, ?, ?, 0 FROM kais_task')
    .bind(id, nowLV(), r.adrese, r.pasutitajs || 'Sezonas', r.materials || 'Sāls', r.maisi || '', '🔁 ' + why + (r.komentars ? ' · ' + r.komentars : ''), '', PENDING).run();
  await newJob(env, 'kais', { adrese: r.adrese, materials: r.materials || '' });
  return 1;
}
/** Cron: sezonā, kad nākamais ≤ šodien → pieteikums; nākamais += ik */
export async function regCron(env) {
  if (!await isNative(env)) return;
  const db = env.DB, t = todayR();
  for (const r of await all(db, "SELECT * FROM kais_reg WHERE aktivs = 1 AND ik > 0 AND nakamais != '' AND nakamais <= ?", t).catch(() => [])) {
    let n = r.nakamais; while (n <= t) n = addDays(n, r.ik);
    const u = await db.prepare('UPDATE kais_reg SET nakamais = ?, pedejais = ? WHERE id = ? AND nakamais = ?').bind(n, t, r.id, r.nakamais).run();
    if (u.meta && u.meta.changes && inSeason(r, t)) await regTask(env, r, 'Sezonas pieteikums (ik ' + r.ik + ' d.)');
  }
}
/** Sniega izsaukums apstiprināts (sniegs.js) → pieteikums objektiem ar atzīmi «pēc sniega izsaukuma» */
export async function onSnowCall(env, datums) {
  try {
    if (!await isNative(env)) return 0;
    const db = env.DB; let n = 0;
    for (const r of await all(db, 'SELECT * FROM kais_reg WHERE aktivs = 1 AND sniegs = 1')) { if (!inSeason(r, datums || todayR())) continue;
      if (r.pedejais === 'sn:' + datums) continue;
      await db.prepare('UPDATE kais_reg SET pedejais = ? WHERE id = ?').bind('sn:' + datums, r.id).run();
      n += await regTask(env, r, 'Pēc sniega izsaukuma ' + String(datums).split('-').reverse().join('.')); }
    return n;
  } catch (e) { console.error('kais onSnowCall', e); return 0; }
}

/** Nesinhronizētās rindas → tabula (jaunas pieliek beigās ar kg formulām, esošās atjauno pēc ID kolonnā A) */
export async function pushSheet(env) {
  if (!env.GOOGLE_SA || (await kvGet(env.DB, 'noGoogle')) === '1') return;
  const db = env.DB, list = await all(db, 'SELECT * FROM kais_task WHERE sheet = 0 ORDER BY row LIMIT 50');
  if (!list.length) return;
  const ids = (await G.read(env, TAB, 'A:A')).map(r => String(r[0] || ''));
  for (const t of list) {
    const v = [t.id, t.datums, G.txt(t.adrese), G.txt(t.pasutitajs), G.txt(t.materials), t.maisi, G.txt(t.komentars), t.foto_pirms, t.statuss, G.txt(t.kurjers), t.foto_pec, t.piegadati, G.txt(t.kurj_kom), t.piegadats];
    let n = ids.indexOf(t.id) + 1;
    if (!n) { n = await G.appendUser(env, TAB, [v]); ids[n - 1] = t.id; }
    else await G.writeUser(env, TAB, 'A' + n + ':N' + n, [v]);
    if (n) await G.writeUser(env, TAB, 'O' + n + ':P' + n, [['=IF(F' + n + '="";"";F' + n + '*' + BAG_KG + ')', '=IF(L' + n + '="";"";L' + n + '*' + BAG_KG + ')']]);
    await db.prepare('UPDATE kais_task SET sheet = 1 WHERE id = ?').bind(t.id).run();
  }
}

/** Vienreizējs imports no tabulas (rindas numurs = rowIndex, kā līdz šim). Esošos ID nepārraksta. */
export async function imports(env) {
  const v = await G.read(env, TAB, 'A1:N');
  const st = [], db = env.DB, have = new Set((await all(db, 'SELECT id FROM kais_task')).map(r => r.id));
  v.forEach((r, i) => { const id = String(r[0] || '').trim(); if (!i || !id || have.has(id)) return; have.add(id);
    const s = (k) => String(r[k] == null ? '' : r[k]);
    st.push(db.prepare('INSERT OR IGNORE INTO kais_task (id, row, datums, adrese, pasutitajs, materials, maisi, komentars, foto_pirms, statuss, kurjers, foto_pec, piegadati, kurj_kom, piegadats, sheet) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
      .bind(id, i + 1, s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8) || PENDING, s(9), s(10), s(11), s(12), s(13))); });
  for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
  await cache(db);
  return { lapa: v.length - 1, ievesti: st.length };
}

/** /kais?fn=… bez Apps Script. Atgriež Response teksta saturu vai null (→ vecais ceļš) */
/* Kas ir sesijā: kurjers (SIA ar kais='kurjers'), admins (portāla vai kais), pieteicējs */
const isAdm = (me) => !!me && !me.company && ((me.perms || {}).portal === 'admin' || (me.perms || {}).kais === 'admin');
export async function handle(env, ctx, fn, args, gas, me) {
  const db = env.DB, a = Array.isArray(args) ? args : [];
  if (fn === 'getTasks') return await tasks(db);
  if (fn === 'getInitialData') { const r = await initialData(db); if (!me) r.phones = {}; return r; }
  if (fn === 'saveTask') { const d = Object.assign({}, a[0] || {}); if (me && !isAdm(me)) d.requester = me.name; return await saveTask(env, ctx, gas, d); }
  if (fn === 'completeTask') {
    const d = Object.assign({}, a[0] || {});
    if (me) {
      const kurj = (me.perms || {}).kais === 'kurjers';
      if (!kurj && !isAdm(me)) return { status: 'error', message: 'Piegādi atzīmēt var tikai kurjers vai administrators' };
      if (!isAdm(me)) d.sia = me.name;   // kurjers atzīmē tikai uz sava vārda
    }
    return await completeTask(env, ctx, gas, d);
  }
  if (fn === 'carrierAnswer') { const r = await answer(env, 'kais', a[0], me); if (r.status === 'success') r.tasks = await tasks(db); return r; }
  if (fn === 'reportProblem') return await reportProblem(env, gas, a[0], me);
  if (fn === 'cancelTask') return await cancelTask(env, a[0], me);
  if (fn === 'regList') return await regList(db, me);
  if (fn === 'regSave') return await regSave(env, a[0], me);
  if (fn === 'geocodeAddresses') return await geocodeAddresses(db, a[0]);
  if (fn === 'saveFileToDrive') return await savePhoto(env, gas, a[0], a[1] || 'bilde.jpg');
  return undefined;
}

/** Pārslēgšana uz D1: kv «kais:switch» = '1' → (kad vecā rinda tukša) imports no tabulas → kais:native = '1'. Rezultāts kv «kais:switchLog». */
export async function maybeSwitch(env) {
  const db = env.DB;
  if ((await kvGet(db, 'kais:switch')) !== '1' || await isNative(env) || !env.GOOGLE_SA) return;
  const q = await db.prepare("SELECT COUNT(*) n FROM izv_q WHERE part = 0 AND fn LIKE 'kais|%' AND err = ''").first();
  if (q && q.n) { await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('kais:switchLog', ?)").bind('gaida rindu: ' + q.n).run(); return; }
  const r = await imports(env);
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('kais:native', '1'), ('kais:switch', 'done'), ('kais:switchLog', ?)").bind(new Date().toISOString() + ' ' + JSON.stringify(r)).run();
}
