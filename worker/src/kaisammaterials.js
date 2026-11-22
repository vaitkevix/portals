// SH | Kaisāmmateriāls — bez Apps Script: pieteikumi D1 (kais_task), Google tabula «Kaisāmmateriāls · Pieteikumi» = kopija ar tām pašām kolonnām. © VAITKEVIX, SIA
// Ieslēdz kv «kais:native» = '1' (pēc imports()). Bildes: Drive caur veco GAS (saveFileToDrive), līdz būs R2.
import * as G from './sheets.js';

const TAB = 'Kaisāmmateriāls · Pieteikumi';
const BAG_KG = 25, PENDING = 'Gaida piegādi', DONE = 'Piegādāts';
const HEAD = ['ID', 'Datums', 'Adrese', 'Pasūtītājs', 'Materiāls', 'Pasūtīti maisi', 'Komentārs', 'Bilde (pieteikums)', 'Statuss', 'Kurjers',
  'Bilde (pēc piegādes)', 'Piegādāti maisi', 'Kurjera komentārs', 'Piegādes laiks', 'Pasūtīts (kg)', 'Piegādāts (kg)'];
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };

export const isNative = async (env) => (await kvGet(env.DB, 'kais:native')) === '1';

const out = (t) => ({ rowIndex: t.row, id: t.id, date: t.datums, address: t.adrese, requester: t.pasutitajs, material: t.materials, bagsEst: t.maisi, comment: t.komentars,
  photoBefore: t.foto_pirms, status: t.statuss || PENDING, sia: t.kurjers, photoAfter: t.foto_pec, m3Hauled: t.piegadati, carrierComment: t.kurj_kom, deliveredAt: t.piegadats });

export async function tasks(db) { return (await all(db, 'SELECT * FROM kais_task ORDER BY row')).map(out); }
/** Portāla kopskatam (portal.js lasa kv «kais:getTasks») */
async function cache(db) { await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('kais:getTasks', ?), ('kaist:getTasks', ?)").bind(JSON.stringify({ ok: true, result: await tasks(db) }), String(Date.now())).run(); }

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
  try { const t = JSON.parse(await gas('saveFileToDrive', JSON.stringify([data, name]))); return (t.ok && t.result) || ''; } catch (e) { return ''; }
}

export async function saveTask(env, ctx, gas, d) {
  const db = env.DB;
  if (!String(d.address || '').trim()) throw new Error('Nav norādīta adrese');
  const id = /^KM-\d{10,}$/.test(String(d.id || '')) ? String(d.id) : 'KM-' + Date.now();
  if (await db.prepare('SELECT 1 FROM kais_task WHERE id = ?').bind(id).first()) return { status: 'success', id };
  const photo = d.photo ? await savePhoto(env, gas, d.photo, id + '_Pieteikums.jpg') : '';
  const mx = await db.prepare('SELECT MAX(row) m FROM kais_task').first();
  await db.prepare('INSERT INTO kais_task (id, row, datums, adrese, pasutitajs, materials, maisi, komentars, foto_pirms, statuss, sheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(id, ((mx && mx.m) || 1) + 1, nowLV(), String(d.address || '').trim(), String(d.requester || ''), String(d.material || ''), num(d.bagsEst), String(d.comment || ''), photo, PENDING).run();
  await cache(db);
  ctx.waitUntil(pushSheet(env).catch(e => console.error('kais sheet', e)));
  return { status: 'success', id };
}

export async function completeTask(env, ctx, gas, d) {
  const db = env.DB;
  const t = await db.prepare('SELECT * FROM kais_task WHERE row = ?').bind(parseInt(d.rowIndex, 10) || 0).first();
  if (!t) return { status: 'error', message: 'Pieteikums netika atrasts' };
  if (t.statuss === DONE) return { status: 'error', message: 'Šis pieteikums jau ir atzīmēts kā piegādāts' };
  const photo = await savePhoto(env, gas, d.photoAfter || '', t.id + '_Piegadats.jpg');
  await db.prepare('UPDATE kais_task SET statuss = ?, kurjers = ?, foto_pec = ?, piegadati = ?, kurj_kom = ?, piegadats = ?, sheet = 0 WHERE id = ?')
    .bind(DONE, String(d.sia || ''), photo || t.foto_pec, num(d.m3Hauled), String(d.carrierComment || ''), nowLV(), t.id).run();
  await cache(db);
  ctx.waitUntil(pushSheet(env).catch(e => console.error('kais sheet', e)));
  return { status: 'success' };
}

/** Nesinhronizētās rindas → tabula (jaunas pieliek beigās ar kg formulām, esošās atjauno pēc ID kolonnā A) */
export async function pushSheet(env) {
  if (!env.GOOGLE_SA) return;
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
export async function handle(env, ctx, fn, args, gas) {
  const db = env.DB, a = Array.isArray(args) ? args : [];
  if (fn === 'getTasks') return await tasks(db);
  if (fn === 'getInitialData') return await initialData(db);
  if (fn === 'saveTask') return await saveTask(env, ctx, gas, a[0] || {});
  if (fn === 'completeTask') return await completeTask(env, ctx, gas, a[0] || {});
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
