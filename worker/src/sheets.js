// SH | Google Sheets API tieši no Worker (bez Apps Script). Servisa konts: Worker secret GOOGLE_SA (JSON atslēga). © VAITKEVIX, SIA
// Tabulai jābūt iedalītai servisa konta e-pastam (Redaktors). DATA_SS = «SH | Dati» ID (wrangler.toml [vars]).

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
let tok = null;   // { t, exp } — Worker izolāta kešs

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(new TextEncoder().encode(s));

function saOf(env) {
  if (!env.GOOGLE_SA) throw new Error('Nav GOOGLE_SA (Google servisa konta atslēgas)');
  return typeof env.GOOGLE_SA === 'string' ? JSON.parse(env.GOOGLE_SA) : env.GOOGLE_SA;
}

async function pemKey(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Servisa konta JWT → OAuth piekļuves žetons (derīgs ~1 h, kešots) */
export async function token(env, scope) {
  const now = Math.floor(Date.now() / 1000);
  if (tok && tok.exp - 60 > now) return tok.t;
  const sa = saOf(env);
  const head = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64uStr(JSON.stringify({ iss: sa.client_email, scope: scope || 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await pemKey(sa.private_key), new TextEncoder().encode(head + '.' + body)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + sig });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google pieteikšanās: ' + (j.error_description || j.error || r.status));
  tok = { t: j.access_token, exp: now + (j.expires_in || 3600) };
  return tok.t;
}

async function call(env, path, opt) {
  const r = await fetch(API + path, Object.assign({}, opt, { headers: Object.assign({ authorization: 'Bearer ' + await token(env), 'content-type': 'application/json' }, (opt || {}).headers) }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google tabula: ' + ((j.error && j.error.message) || r.status));
  return j;
}
const q = (a1) => encodeURIComponent(a1);
const tabA1 = (tab, rng) => "'" + String(tab).replace(/'/g, "''") + "'" + (rng ? '!' + rng : '');

/** Lapas vērtības kā teksts (FORMATTED_VALUE) — [[...], ...] */
export async function read(env, tab, rng, ss) {
  const j = await call(env, (ss || env.DATA_SS) + '/values/' + q(tabA1(tab, rng)) + '?valueRenderOption=FORMATTED_VALUE');
  return j.values || [];
}
/** Pārraksta apgabalu (RAW — teksts paliek teksts) */
export async function write(env, tab, rng, rows, ss) {
  return call(env, (ss || env.DATA_SS) + '/values/' + q(tabA1(tab, rng)) + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ values: rows }) });
}
/** Pieliek rindas lapas beigās */
export async function append(env, tab, rows, ss) {
  return call(env, (ss || env.DATA_SS) + '/values/' + q(tabA1(tab, 'A1')) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: rows }) });
}
/** Notīra apgabalu (piem. 'A2:Z') */
export async function clear(env, tab, rng, ss) {
  return call(env, (ss || env.DATA_SS) + '/values/' + q(tabA1(tab, rng)) + ':clear', { method: 'POST', body: '{}' });
}
/** Lapu nosaukumi (pārbaudei, vai piekļuve strādā) */
export async function tabs(env, ss) {
  const j = await call(env, (ss || env.DATA_SS) + '?fields=properties.title,sheets.properties.title');
  return { title: j.properties && j.properties.title, tabs: (j.sheets || []).map(s => s.properties.title) };
}

/** «SH | Dati» → Objekti: [{adrese, vaditajs, grupa, piekluve}] (tas pats formāts, ko deva GAS 'config') */
export async function objekti(env) {
  const v = await read(env, 'Objekti', 'A1:D');
  return v.slice(1).filter(r => String(r[0] || '').trim()).map(r => ({ adrese: String(r[0]).trim(), vaditajs: String(r[1] || '').trim(), grupa: String(r[2] || 'SH objekti').trim(), piekluve: String(r[3] || '').trim() }));
}
