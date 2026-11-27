/* SH | R2 bilžu sīktēli: pirmajā pieprasījumā samazina (Photon WASM), saglabā R2 «<id>@w<platums>», tālāk atdod gatavo. © VAITKEVIX, SIA */
import { PhotonImage, SamplingFilter, resize } from '@cf-wasm/photon/workerd';

const W = { w300: 300, w400: 400, w600: 600 };
/** → { body, type } vai null (tad rādīt oriģinālu) */
export async function thumbR2(env, id, sz) {
  const w = W[sz]; if (!w || !env.FOTO) return null;
  const key = id + '@w' + w, have = await env.FOTO.get(key);
  if (have) return { body: have.body, type: (have.httpMetadata && have.httpMetadata.contentType) || 'image/jpeg' };
  const o = await env.FOTO.get(id); if (!o) return null;
  const buf = new Uint8Array(await o.arrayBuffer()); if (buf.length < 90000) return null;   // jau mazs
  let img, out;
  try {
    img = PhotonImage.new_from_byteslice(buf);
    const iw = img.get_width(), ih = img.get_height(); if (iw <= w) return null;
    out = resize(img, w, Math.max(1, Math.round(ih * w / iw)), SamplingFilter.Triangle);
    const bytes = out.get_bytes_jpeg(76);
    await env.FOTO.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { no: id } });
    return { body: bytes, type: 'image/jpeg' };
  } finally { try { img && img.free(); } catch (e) {} try { out && out.free(); } catch (e) {} }
}
