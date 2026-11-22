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

/* ---------- Aizvietošanas «tilta» tabulas darbības bez Apps Script (tie paši formāti, ko GAS peopleWrite_/masterWrite_/config) ---------- */
const T = { users: '⚙ Lietotāji (Aizvietošana)', types: 'Darbu veidi', obj: 'Objekti', ppl: 'Pilnvaras', comp: 'Uzņēmumi', lists: 'Saraksti', rev: 'Pārbaudīt' };
const col = (n) => { let s = ''; for (n = n || 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const str = (rows) => rows.map(r => r.map(v => v == null ? '' : String(v)));

/** Izveido lapu, ja tās nav */
async function ensure(env, title) {
  const t = await tabs(env);
  if (t.tabs.indexOf(title) !== -1) return;
  await call(env, env.DATA_SS + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title, hidden: /^⚙/.test(title) } } }] }) });
}
async function batchRead(env, ranges) {
  const j = await call(env, env.DATA_SS + '/values:batchGet?valueRenderOption=FORMATTED_VALUE&' + ranges.map(r => 'ranges=' + q(r)).join('&'));
  return (j.valueRanges || []).map(v => v.values || []);
}
/** Virsraksts + rindas; keep = citas kolonnas neaiztiek (Objekti, Darbu veidi) */
async function put(env, tab, head, rows, keep) {
  await ensure(env, tab);
  await clear(env, tab, 'A2:' + (keep ? col(head.length) : 'ZZ'));
  await write(env, tab, 'A1', str([head, ...rows.map(x => head.map((_, i) => x[i]))]));
}

export async function bridgeOp(env, op, r) {
  if (op === 'config') {
    const [u, t, o] = await batchRead(env, [tabA1(T.users, 'A1:D'), tabA1(T.types, 'A1:B'), tabA1(T.obj, 'A1:D')]);
    return {
      users: u.slice(1).filter(x => String(x[0] || '').trim()).map(x => ({ name: String(x[0]).trim(), role: String(x[1] || '').trim().toLowerCase(), pin: String(x[2] || '').trim(), color: String(x[3] || '').trim() })),
      types: t.slice(1).filter(x => String(x[0] || '').trim()).map(x => ({ name: String(x[0]).trim(), group: String(x[1] || 'Papilddarbs').trim() })),
      objects: o.slice(1).filter(x => String(x[0] || '').trim()).map(x => ({ adrese: String(x[0]).trim(), vaditajs: String(x[1] || '').trim(), grupa: String(x[2] || 'SH objekti').trim(), piekluve: String(x[3] || '').trim() }))
    };
  }
  if (op === 'people') {
    const R = { '': '—', admin: 'Administrators', vaditajs: 'Darbu vadītājs', pieteicejs: 'Pieteicējs', 'gatavotājs': 'Gatavotājs', 'vadība': 'Vadība' };
    const head = ['Vārds', 'PIN', 'Krāsa', 'Aktīvs', 'Portāla admins', 'Aizvietošana', 'Izvešana', 'Kaisāmmateriāls', 'Personāls', 'Budžets'];
    const list = r.people || [];
    const rows = list.map(p => { const x = p.perms || {}; return [p.name, String(p.pin), p.color || '', p.active ? 'Jā' : 'Nē', x.portal === 'admin' ? 'Jā' : '',
      R[x.aizv || ''] || x.aizv, R[x.izv || ''] || x.izv, R[x.kais || ''] || x.kais, R[x.pers || ''] || x.pers, R[x.budz || ''] || x.budz]; });
    await ensure(env, T.ppl);
    await clear(env, T.ppl, 'A1:ZZ');
    await write(env, T.ppl, 'A1', str([head, ...rows, [], ['Mainīt tikai portālā vaitkevix.cloud/sh (Administrēšana). Šī lapa tiek pārrakstīta automātiski. © VAITKEVIX, SIA']]));
    const ur = list.filter(p => p.active && p.perms && p.perms.aizv).map(p => [p.name, p.perms.aizv, String(p.pin), p.color || '']);
    await ensure(env, T.users);
    await clear(env, T.users, 'A2:D');
    if (ur.length) await write(env, T.users, 'A2', str(ur));
    return { written: rows.length };
  }
  if (op === 'master') {
    if (r.objects) await put(env, T.obj, ['Adrese', 'Vaditajs', 'Grupa', 'Piekluve'], r.objects, true);
    if (r.types) await put(env, T.types, ['Darbs', 'Grupa'], r.types, true);
    if (r.companies) await put(env, T.comp, ['Uzņēmums', 'Veids', 'Parole', 'Tālrunis', 'Aktīvs'], r.companies);
    if (r.lists) await put(env, T.lists, ['Saraksts', 'Vērtība'], r.lists);
    if (r.review) await put(env, T.rev, ['Kas', 'Ieraksts', 'Ko darīju', 'Jāpārbauda'], r.review);
    return { ok: 1 };
  }
  if (op === 'addObjects' || op === 'importObjects') {
    const nk = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const cur = (await read(env, T.obj, 'A2:D')).map(x => [0, 1, 2, 3].map(i => x[i] == null ? '' : String(x[i])));
    const idx = {}; cur.forEach((x, i) => { if (x[0]) idx[nk(x[0])] = i; });
    if (op === 'addObjects') {
      const add = []; (r.rows || []).forEach(x => { const k = nk(x[0]); if (x[0] && idx[k] === undefined) { idx[k] = -1; add.push(x); } });
      if (add.length) await append(env, T.obj, str(add));
    } else {
      (r.rows || []).forEach(x => { const k = nk(x[0]); if (idx[k] !== undefined) cur[idx[k]] = x; else { idx[k] = cur.length; cur.push(x); } });
      if (cur.length) await write(env, T.obj, 'A2', str(cur));
    }
    return {};
  }
  return null;   // citas darbības (bildes, AI, push) — vēl caur Apps Script
}

/** Spogulis D1 → lapa (nakts kopija). Ja D1 krietni mazāk rindu — vispirms slēpta arhīva kopija; dati lapā nepazūd bez kopijas. */
export async function mirror(env, tab, head, rows, day) {
  await ensure(env, tab);
  const had = Math.max(0, (await read(env, tab, 'A:A')).length - 1);
  if (had >= 10 && rows.length < had * 0.5) {
    const j = await call(env, env.DATA_SS + '?fields=sheets.properties');
    const sh = (j.sheets || []).map(s => s.properties).find(p => p.title === tab), nm = '⚙ Arhīvs ' + tab + ' ' + day;
    if (sh && !(j.sheets || []).some(s => s.properties.title === nm))
      await call(env, env.DATA_SS + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [
        { duplicateSheet: { sourceSheetId: sh.sheetId, newSheetName: nm, insertSheetIndex: (j.sheets || []).length } }] }) })
        .then(r => { const id = r.replies && r.replies[0].duplicateSheet.properties.sheetId;
          return id != null && call(env, env.DATA_SS + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: id, hidden: true }, fields: 'hidden' } }] }) }); });
  }
  await write(env, tab, 'A1', str([head, ...rows.map(x => head.map((_, i) => x[i]))]));
  if (had > rows.length) await clear(env, tab, 'A' + (rows.length + 2) + ':ZZ');
  return { tab, rows: rows.length, had };
}

/** Kā ievadīts ar roku (datumi, skaitļi, formulas). Teksts, kas sākas ar = + - @, paliek teksts. */
export const txt = (v) => { v = v == null ? '' : String(v); return /^[=+\-@']/.test(v) ? "'" + v : v; };
export async function writeUser(env, tab, rng, rows, ss) {
  return call(env, (ss || env.DATA_SS) + '/values/' + q(tabA1(tab, rng)) + '?valueInputOption=USER_ENTERED', { method: 'PUT', body: JSON.stringify({ values: rows }) });
}
/** Pieliek rindu beigās; atgriež tās numuru lapā */
export async function appendUser(env, tab, rows, ss) {
  const j = await call(env, (ss || env.DATA_SS) + '/values/' + q(tabA1(tab, 'A1')) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: rows }) });
  const m = /!A(\d+)/.exec((j.updates && j.updates.updatedRange) || '');
  return m ? +m[1] : 0;
}

/** Vienreizēja nolasīšana pārnešanai (kv «peek» = A1 diapazons) → kv «peekOut» (formulas un vērtības) */
export async function peek(env, db) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = 'peek'").first();
  if (!r || !r.v || !env.GOOGLE_SA) return;
  const [tab, rng] = r.v.split('!');
  const f = await call(env, env.DATA_SS + '/values/' + q(tabA1(tab, rng)) + '?valueRenderOption=FORMULA');
  const v = await call(env, env.DATA_SS + '/values/' + q(tabA1(tab, rng)) + '?valueRenderOption=FORMATTED_VALUE');
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('peekOut', ?), ('peek', '')").bind(JSON.stringify({ f: f.values || [], v: v.values || [] })).run();
}

/** Neformatētas vērtības (skaitļi kā skaitļi, datumi kā sērijas numuri) — pārnešanai uz D1 */
export async function readRaw(env, tab, rng, ss) {
  const j = await call(env, (ss || env.DATA_SS) + '/values/' + q(tabA1(tab, rng)) + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
  return j.values || [];
}
/** Sheets sērijas numurs (dienas kopš 30.12.1899, lokālais laiks) → { y, m, d, H, M } */
export function serial(n) {
  const ms = Math.round((Number(n) - 25569) * 864e5), d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds() };
}
