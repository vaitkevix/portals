/* SH | G2 komentāri pie darba grafika lietotnēs (pl, logi, sniegs, darz, stav, aizv): vadītājs ↔ izpildītājs, teksts + bilde, push otrai pusei.
 * Tabula thread (app, visit). Mazs palīgs — katra lietotne izsauc savā modulī ar savu KEY un darbu tabulu. © VAITKEVIX, SIA */
import { nowStr, uid } from './util.js';
import { notify, managers, personNames } from './webpush.js';

const IMG_RE = /^data:image\/(jpeg|png|webp);base64,/;
/** Komentāru skaits pa darbiem (kartītēm): { visitId: n } */
export async function threadCounts(db, app, ids) {
  ids = (ids || []).filter(Boolean); const m = {}; if (!ids.length) return m;
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const r = (await db.prepare(`SELECT visit, COUNT(*) n FROM thread WHERE app = ? AND visit IN (${part.map(() => '?').join(',')}) GROUP BY visit`).bind(app, ...part).all().catch(() => ({ results: [] }))).results || [];
    r.forEach(x => m[x.visit] = x.n);
  }
  return m;
}
/** action thread (saraksts) | threadAdd (jauns). v = darbs {id, adrese, datums, brigade, izpilditajs}; w = lomas svars (2+ vadītājs) */
export async function threadApi(env, X, app, name, v, me, w, b) {
  const db = env.DB;
  if (!v) throw new Error('Darbs nav atrasts — atjaunojiet');
  if (me.company && v.brigade && v.brigade !== me.name) throw new Error('Šis darbs nav jūsu brigādei');
  if (b.action === 'threadAdd') {
    if (w < 1) throw new Error('Komentēt var izpildītājs vai vadītājs');
    const tx = String(b.teksts || '').trim().slice(0, 1000);
    const photos = (b.photos || []).filter(p => IMG_RE.test(String(p))).slice(0, 2);
    if (!tx && !photos.length) throw new Error('Uzrakstiet komentāru');
    const ids = photos.length ? await X.savePhotos({ datums: v.datums, adrese: name + ' · komentārs · ' + v.adrese }, photos) : [];
    const who = me.who || me.name, loma = w >= 2 ? 'vaditajs' : 'izpilditajs';
    await db.prepare('INSERT INTO thread (id, app, visit, kas, loma, laiks, teksts, foto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(uid(), app, String(v.id), String(who).slice(0, 80), loma, nowStr(), tx, ids.join(',')).run();
    const job = (async () => {
      let to;
      if (loma === 'vaditajs') to = await personNames(env, [v.brigade, v.izpilditajs, String(v.izpilditajs || '').split(' · ')[0]].filter(Boolean));
      else { const prev = ((await db.prepare("SELECT DISTINCT kas FROM thread WHERE app = ? AND visit = ? AND loma = 'vaditajs'").bind(app, String(v.id)).all()).results || []).map(r => r.kas);
        to = prev.length ? prev : await managers(env, app); }
      to = to.filter(n => n !== me.name && n !== who);
      await notify(env, to, { title: '💬 ' + name + ' · ' + v.adrese, body: (who + ': ' + (tx || 'bilde')).slice(0, 140), url: '/sh/#' + app });
    })().catch(() => 0);
    if (X && X.bg) X.bg(job); else await job;
  }
  const list = (await db.prepare('SELECT id, kas, loma, laiks, teksts, foto FROM thread WHERE app = ? AND visit = ? ORDER BY laiks, id').bind(app, String(v.id)).all()).results || [];
  return { thread: list };
}
