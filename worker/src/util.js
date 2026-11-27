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
/** Adreses salīdzināšanai: bez garumzīmēm, bez «iela», Rīgas/LV, VNĪ/KK prefiksiem */
export const akey = (s) => anorm(s).replace(/^(kk|ir|ee) /, '').replace(/^(j|vni) ?\| ?/, '').replace(/,?\s*(latvija|lv-?\s?\d{4}|riga|rigas pils\.?)\s*/g, ' ')
  .replace(/\b(iela|gatve|bulvaris|prospekts|cels|laukums)\b/g, ' ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
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

/* Apvienotā objekta adrese → mājas («Aglonas 11 / Prūšu 4b», «Dumbrāja 18, 18 k-1»); [] ja viena māja. (no majaslieta.js) */
const PFX = /^\s*([A-ZĀČĒĢĪĶĻŅŠŪŽ]{1,4}\s*\|\s*)/;
export function splitAddr(a) {
  let s = String(a || '').trim(); const pm = s.match(PFX), pfx = pm ? pm[1] : ''; if (pm) s = s.slice(pm[0].length);
  const raw = s.split(/\s+\/\s+|\s*;\s*|\s*,\s*/).map(x => x.trim()).filter(x => x && !/^(lv-?\s?\d{4}|rīga|riga|latvija)$/i.test(x));   // «24/26» = viena māja
  if (raw.length < 2) return [];
  let street = '', base = ''; const out = [];
  for (const p of raw) {
    if (!/\d/.test(p) || /st[āa]v|^(dz|dzīv|kv|telpa)\b\.?|^\d+\.\s/i.test(p)) return [];   // «2. stāvs», «dz. 3» — nav cita māja
    if (/^k-?\s*\d/i.test(p)) { if (!base) return []; out.push(base + ' k-' + p.replace(/^k-?\s*/i, '')); }   // «Jomas 57, k-1», «K2»
    else if (/^\d/.test(p)) { if (!street) return []; const x = street + ' ' + p; out.push(x); base = x.replace(/\s+k-?\s*\d+\S*$/i, ''); }
    else { street = p.replace(/\s+\d[^\s]*(\s+k-?\s*\d+\S*)?$/i, '').trim(); out.push(p); base = p.replace(/\s+k-?\s*\d+\S*$/i, ''); }
  }
  // «Jomas 57, k-1» — viena māja ar korpusu, nevis apvienojums; apvienots tikai, ja ≥2 dažādi numuri vai ≥2 korpusi
  const nums = new Set(out.map(x => x.replace(/\s+k-?\s*\d+\S*$/i, '').toLowerCase())), ks = out.filter(x => /\sk-?\s*\d/i.test(x)).length;
  if (nums.size < 2 && ks < 2) return [];
  return out.map(x => ({ adrese: x, pfx }));
}
