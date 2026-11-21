/* SH | laikapstākļu prognoze (Open-Meteo, bez atslēgas) — Rīga: lietus mm, sniegs cm, t° min. Kopīga: kv 'wx'. © VAITKEVIX, SIA */
import { kv, kvSet } from './util.js';
export async function fetchWx(db) {
  const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=56.95&longitude=24.11&daily=precipitation_sum,snowfall_sum,temperature_2m_min&timezone=Europe%2FRiga&past_days=2&forecast_days=6');
  if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  const j = await r.json(), m = {}, D = j.daily || {};
  (D.time || []).forEach((d, i) => m[d] = { r: +(D.precipitation_sum[i] || 0), s: +(D.snowfall_sum[i] || 0), t: D.temperature_2m_min[i] == null ? null : +D.temperature_2m_min[i] });
  await db.batch([kvSet(db, 'wx', m), kvSet(db, 'wx:at', Date.now())]);
  return m;
}
/* Ik 3 h (cron ik 30 min) */
export async function wxCron(env) { if (Date.now() - +((await kv(env.DB, 'wx:at')) || 0) > 3 * 3600e3) await fetchWx(env.DB); }
