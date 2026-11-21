/* SH | Web Push bez trešās puses: šifrēšana RFC 8291 (aes128gcm) + VAPID RFC 8292. Strādā iPhone (sākuma ekrāna lietotne), Android, datorā.
 * Abonementi: D1 push_subs (pēc cilvēka vārda). Noslēpums: Worker secret VAPID_PRIVATE (JWK), publiskā atslēga: var VAPID_PUBLIC. © VAITKEVIX, SIA */
const te = new TextEncoder();
export const b64u = (buf) => { let s = ''; new Uint8Array(buf).forEach(c => s += String.fromCharCode(c)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const ub64 = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }
async function hkdf(salt, ikm, info, len) { const prk = await hmac(salt, ikm); return (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len); }

/* Šifrē ziņu konkrētam abonementam (opts — tikai testam: fiksētas atslēgas un sāls) */
export async function encrypt(payload, p256dh, auth, opts) {
  const uaPub = ub64(p256dh), authB = ub64(auth);
  const as = (opts && opts.asKeys) || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authB, ecdh, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = (opts && opts.salt) || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

/* VAPID paraksts (ES256 JWT) */
async function vapid(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE), aud = new URL(endpoint).origin;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), c = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://vaitkevix.cloud/sh/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(h + '.' + c));
  return 'vapid t=' + h + '.' + c + '.' + b64u(sig) + ', k=' + env.VAPID_PUBLIC;
}
export async function sendOne(env, sub, msg) {
  const body = await encrypt(JSON.stringify(msg), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, { method: 'POST', body, headers: { Authorization: await vapid(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: msg.urgent ? 'high' : 'normal' } });
  return r.status;
}

/* Paziņot cilvēkiem pēc vārda. msg: { title, body, url, urgent }. Kļūdas neapstādina darbību. */
export async function notify(env, names, msg) {
  names = [...new Set((names || []).filter(Boolean))]; if (!names.length || !env.VAPID_PRIVATE || !env.VAPID_PUBLIC) return 0;
  let subs = [];
  try { subs = (await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subs WHERE name IN (${names.map(() => '?').join(',')})`).bind(...names).all()).results || []; } catch (e) { return 0; }
  let sent = 0;
  await Promise.all(subs.map(async (s) => { try { const st = await sendOne(env, s, msg); if (st === 404 || st === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run(); else if (st < 300) sent++; } catch (e) { console.error('push', e); } }));
  return sent;
}
/* Kam paziņot: lietotnes vadītāji un admini (+ portāla admini) */
export async function managers(env, app) {
  const rows = (await env.DB.prepare('SELECT name, perms, active FROM people').all()).results || [];
  return rows.filter(r => r.active).filter(r => { let p = {}; try { p = JSON.parse(r.perms || '{}'); } catch (e) {} return p.portal === 'admin' || p[app] === 'admin' || p[app] === 'vaditajs'; }).map(r => r.name);
}
/* Vai šis vārds ir cilvēks (nevis SIA), kam var sūtīt */
export async function personNames(env, names) {
  names = (names || []).filter(Boolean); if (!names.length) return [];
  return ((await env.DB.prepare(`SELECT name FROM people WHERE active = 1 AND name IN (${names.map(() => '?').join(',')})`).bind(...names).all()).results || []).map(r => r.name);
}
