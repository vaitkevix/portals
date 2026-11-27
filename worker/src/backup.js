/* SH | D1 rezerves kopija: reizi diennaktī (pēc 03:00 Rīgas laikā) visa datubāze kā SQL (gzip) uz R2 «sh-foto» mapē backup/,
 * glabā pēdējās KEEP kopijas. /img šīs atslēgas nerāda (tur der tikai id bez «/»).
 * Atjaunot: bunx wrangler r2 object get sh-foto/backup/d1-YYYY-MM-DD.sql.gz --remote --file b.sql.gz && gunzip b.sql.gz
 *           bunx wrangler d1 execute <jauna-db> --remote --file b.sql      © VAITKEVIX, SIA */
import { today } from './util.js';

const KEEP = 30, PAGE = 500;
const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return String(v);
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v) || Array.isArray(v)) {
    const b = Array.isArray(v) ? v : new Uint8Array(v.buffer ? v.buffer : v);
    return "X'" + Array.from(b, x => (x & 255).toString(16).padStart(2, '0')).join('') + "'";
  }
  return "'" + String(v).replace(/'/g, "''") + "'";
};
const id = (n) => '"' + String(n).replace(/"/g, '""') + '"';
const rigaHour = () => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', hour: '2-digit', hour12: false }).format(new Date());

/** Visa D1 kā SQL teksts → { sql, tables, rows } */
export async function dumpSql(db) {
  const objs = (await db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY type = 'table' DESC, name").all()).results || [];
  const out = ['-- SH D1 «aizvietosana» rezerves kopija ' + new Date().toISOString(), 'PRAGMA defer_foreign_keys = TRUE;'];
  let rows = 0, tables = 0;
  for (const o of objs.filter(x => x.type === 'table')) {
    out.push('', o.sql + ';'); tables++;
    for (let off = 0; ; off += PAGE) {
      const r = (await db.prepare('SELECT * FROM ' + id(o.name) + ' LIMIT ? OFFSET ?').bind(PAGE, off).all()).results || [];
      for (const row of r) { const k = Object.keys(row); out.push('INSERT INTO ' + id(o.name) + ' (' + k.map(id).join(', ') + ') VALUES (' + k.map(c => q(row[c])).join(', ') + ');'); }
      rows += r.length; if (r.length < PAGE) break;
    }
  }
  for (const o of objs.filter(x => x.type !== 'table')) out.push(o.sql + ';');   // indeksi, trigeri, skati — pēc datiem
  return { sql: out.join('\n') + '\n', tables, rows };
}

async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(s).arrayBuffer();
}

/** Cron (*\/5): vienreiz dienā pēc 03:00. force=true — uzreiz (admina poga / tests). */
export async function backupD1(env, force) {
  if (!env.FOTO) throw new Error('Nav R2 (FOTO)');
  const t = today();
  if (!force) {
    if (rigaHour() < 3) return null;
    const last = await env.DB.prepare("SELECT v FROM kv WHERE k = 'backup:last'").first();
    if (last && last.v === t) return null;
  }
  const d = await dumpSql(env.DB), gz = await gzip(d.sql), key = 'backup/d1-' + t + '.sql.gz';
  await env.FOTO.put(key, gz, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { tables: String(d.tables), rows: String(d.rows) } });
  // vecās nost — paturam KEEP jaunākās
  const L = []; let cur;
  do { const r = await env.FOTO.list({ prefix: 'backup/d1-', cursor: cur }); L.push(...r.objects.map(o => o.key)); cur = r.truncated ? r.cursor : null; } while (cur);
  L.sort(); const old = L.slice(0, Math.max(0, L.length - KEEP)); if (old.length) await env.FOTO.delete(old);
  const info = { key, bytes: gz.byteLength, sqlBytes: d.sql.length, tables: d.tables, rows: d.rows, at: new Date().toISOString(), kopijas: L.length - old.length };
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('backup:last', ?)").bind(t),
    env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('backup:info', ?)").bind(JSON.stringify(info)),
  ]);
  return info;
}
