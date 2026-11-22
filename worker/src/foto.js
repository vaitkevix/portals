// SH | Bildes Cloudflare R2 (bucket sh-foto, binding FOTO). Id «r2-<32 hex>» der arī vecajam /img?id= formātam. © VAITKEVIX, SIA
export const API = 'https://aizvietosana-api.vaitkevix.workers.dev';

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
