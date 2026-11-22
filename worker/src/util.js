/* SH | kopīgi palīgrīki grafika lietotnēm (datumi, kv, adreses ģeokodēšanai, atbilde). Lietotņu loģika — katrai savā failā. © VAITKEVIX, SIA */
const TZ = 'Europe/Riga';
export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS) });
const fmtD = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtT = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const today = () => fmtD.format(new Date());
export const nowStr = () => fmtT.format(new Date()).replace(',', '').slice(0, 16);
export const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const dow = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };   // 1 = P … 7 = Sv
export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
/* Adrese bez liekā: «iela», «, Rīga, Latvija, LV1014»; sākas ar lielo burtu */
export const cleanAddr = (a) => { let b = String(a || '').replace(/(\S)\s+iela\b/gi, '$1'); for (let i = 0; i < 4; i++) b = b.replace(/,\s*(Latvija|LV-?\s?\d{4}|Rīga|Riga)\s*$/i, '').trim(); return b.replace(/\s+/g, ' ').trim().replace(/(^|\|\s*|\/\s*)(\p{Ll})/gu, (m, p, c) => p + c.toUpperCase()); };
export const anorm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const lvD = (d) => { const [, m, dd] = d.split('-'); return +dd + '.' + m + '.'; };
export async function kv(db, k) { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); try { return r ? JSON.parse(r.v) : null; } catch (e) { return null; } }
export const kvSet = (db, k, v) => db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, JSON.stringify(v));
export function geoQuery(adr) {
  let a = String(adr || '').trim(), city = 'Rīga';
  if (/^\s*j\s*\|/i.test(a)) city = 'Jūrmala';
  a = a.replace(/^\s*(j|vn[iī])\s*\|\s*/i, '').replace(/,?\s*latvija.*$/i, '').replace(/,?\s*lv-?\d{4}\b/i, '');
  a = a.replace(/(\d+[a-z]?)\s*,\s*\d+[a-z]?(\s*,\s*\d+[a-z]?)*/i, '$1').replace(/\s+k-\d+/i, '');
  if (!/r[iī]ga|j[uū]rmala|mārupe|marupe|ķekava|kekava|salaspils|ādaži|adazi/i.test(a)) a += ', ' + city;
  return a + ', Latvija';
}
