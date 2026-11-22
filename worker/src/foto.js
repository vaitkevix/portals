// SH | Bildes Cloudflare R2 (bucket sh-foto, binding FOTO). Id «r2-<32 hex>» der arī vecajam /img?id= formātam. © VAITKEVIX, SIA
export const API = 'https://vaitkevix.cloud/sh/api';

/** data:image/...;base64 → R2; atgriež id vai '' */
export async function put(env, data, meta) {
  const m = /^data:(image\/(?:jpeg|png|webp|heic|heif|gif));base64,(.+)$/s.exec(String(data || ''));
  if (!m || !env.FOTO) return '';
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  if (bin.length > 15e6) throw new Error('Bilde par lielu');
  const id = 'r2-' + crypto.randomUUID().replace(/-/g, '');
  await env.FOTO.put(id, bin, { httpMetadata: { contentType: m[1] }, customMetadata: Object.fromEntries(Object.entries(meta || {}).map(([k, v]) => [k, String(v).slice(0, 200)])) });
  return id;
}
export async function putMany(env, list, meta) { const out = []; for (const d of list || []) { const id = await put(env, d, meta); if (id) out.push(id); } return out; }
/** Saite pārlūkam (Kaisāmmateriāls/Izvešana glabā pilnu URL) */
export const url = (id) => id ? API + '/img?id=' + id + '&sz=w1600' : '';

/* ---------- Vecās Google Drive bildes → R2 (atslēga «d-<drive id>»). /img vispirms skatās R2, tad Drive. ---------- */
export const driveKey = (id) => 'd-' + id;
export async function copyDrive(env, id) {
  if (!env.FOTO || !/^[\w-]{20,80}$/.test(id) || id.startsWith('r2-')) return false;
  if (await env.FOTO.head(driveKey(id))) return true;
  const g = await fetch('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w1600', { redirect: 'follow' });
  const ct = g.headers.get('content-type') || '';
  if (!g.ok || !/^image\//.test(ct)) return false;
  await env.FOTO.put(driveKey(id), await g.arrayBuffer(), { httpMetadata: { contentType: ct }, customMetadata: { no: 'drive' } });
  return true;
}
const DRIVE_RE = /\/d\/([\w-]{20,80})|[?&]id=([\w-]{20,80})/g;
/** Visas Drive bilžu id datubāzē (Aizvietošana, grafiki, Kaisāmmateriāls) */
export async function driveIds(db) {
  const ids = new Set(), q = async (sql) => ((await db.prepare(sql).all()).results || []);
  const csv = (v) => String(v || '').split(/[,\s]+/).forEach(x => { if (/^[\w-]{20,80}$/.test(x) && !x.startsWith('r2-')) ids.add(x); });
  for (const t of ['jobs', 'problems', 'standing', 'pl_visit', 'logi_visit', 'darz_visit', 'stav_visit', 'sniegs_visit'])
    (await q('SELECT foto FROM ' + t + " WHERE foto != ''").catch(() => [])).forEach(r => csv(r.foto));
  for (const t of ['kais_task', 'izv_task']) (await q("SELECT foto_pirms, foto_pec FROM " + t + " WHERE foto_pirms != '' OR foto_pec != ''").catch(() => [])).forEach(r => {
    [r.foto_pirms, r.foto_pec].forEach(u => { let m; DRIVE_RE.lastIndex = 0; while ((m = DRIVE_RE.exec(String(u || '')))) ids.add(m[1] || m[2]); }); });
  return [...ids];
}
/** Cron: pa daļām nokopē (līdz 25 reizē); kv «foto:drive» = pēdējā atskaite */
export async function migrateDrive(env) {
  if (!env.FOTO) return;
  const db = env.DB, st = await db.prepare("SELECT v FROM kv WHERE k = 'foto:driveDone'").first();
  if (st && st.v === '1') return;
  // nokopēto saraksts kv (nevis R2 head katram — Worker saišu limits ~1000 vienā izsaukumā)
  const cr = await db.prepare("SELECT v FROM kv WHERE k = 'foto:copied'").first(), have = new Set(cr && cr.v ? JSON.parse(cr.v) : []);
  const ids = await driveIds(db); let ops = 0, fail = 0;
  for (const id of ids) {
    if (have.has(id)) continue;
    if (ops >= 25) break; ops++;
    if (await copyDrive(env, id).catch(() => false)) have.add(id); else fail++;
  }
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('foto:copied', ?)").bind(JSON.stringify([...have])).run();
  const img = (id) => API + '/img?sz=w1600&id=' + id;
  const fix = (v) => String(v || '').split(/\s+/).filter(Boolean).map(u => { const m = /\/d\/([\w-]{20,80})|[?&]id=([\w-]{20,80})/.exec(u), id = m && (m[1] || m[2]);
    return id && /drive\.google\.com/.test(u) && have.has(id) ? img(id) : u; }).join('\n');
  // Kaisāmmateriāls un Izvešana glabā pilnas saites → Worker /img (rāda no R2)
  let left = 0;
  for (const t of ['kais_task', 'izv_task']) {
    const rows = (await db.prepare("SELECT id, foto_pirms, foto_pec FROM " + t + " WHERE foto_pirms LIKE '%drive.google.com%' OR foto_pec LIKE '%drive.google.com%'").all()).results || [];
    for (const r of rows) { const a = fix(r.foto_pirms), b = fix(r.foto_pec);
      if (a !== r.foto_pirms || b !== r.foto_pec) await db.prepare('UPDATE ' + t + ' SET foto_pirms = ?, foto_pec = ? WHERE id = ?').bind(a, b, r.id).run();
      if (/drive\.google\.com/.test(a + b)) left++; }
  }
  const done = ids.filter(id => have.has(id)).length;
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('foto:drive', ?)").bind(new Date().toISOString() + ' kopā ' + ids.length + ', R2 ' + done + ', neizdevās ' + fail + ', saites ar Drive ' + left).run();
  if (done === ids.length && !left) await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('foto:driveDone', '1')").run();
}
