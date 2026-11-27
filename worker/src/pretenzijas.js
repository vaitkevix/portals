/* SH | E3 pretenzijas grafika lietotnēs (pļaušana, logi, sniegs, dārzs, stāvvietas): vadītājs pie izpildīta apmeklējuma «Pretenzija» (teksts + bilde)
 * → push izpildītājam; izpildītājs «Labots» ar jaunu bildi → push vadītājam. Atvērta pretenzija = apmeklējums neiet aktā/rēķinā (klienti.js).
 * Mazs palīgs — katra lietotne izsauc savā modulī ar savu KEY un tabulu. © VAITKEVIX, SIA */
import { nowStr, uid, lvD, assertOpen } from './util.js';
import { notify, managers, personNames } from './webpush.js';
import { audit } from './audit.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,/;
const pub = (c) => ({ id: c.id, visit: c.visit, adrese: c.adrese, datums: c.datums, teksts: c.teksts, foto: c.foto, kas: c.kas, laiks: c.laiks, izpilditajs: c.izpilditajs, statuss: c.statuss, lab_kas: c.lab_kas, lab_laiks: c.lab_laiks, lab_foto: c.lab_foto, lab_piez: c.lab_piez });

/** Pretenzijas lietotnes boot atbildei: atvērtās + pēdējo 30 dienu labotās. SIA redz tikai savējās. */
export async function claimsOf(db, app, me) {
  const L = await all(db, "SELECT * FROM claim WHERE app = ? AND (statuss = 'atverta' OR lab_laiks >= date('now', '-30 day')) ORDER BY laiks DESC LIMIT 200", app).catch(() => []);
  return L.filter(c => !me.company || c.izpilditajs === me.name || c.izpilditajs.startsWith(me.name + ' ·')).map(pub);
}
/** action: claim | claimFix. w = lomas svars (admin 3, vaditajs 2, izpilditajs 1) */
export async function claimApi(env, X, app, name, T, me, w, b) {
  const db = env.DB, a = b.action;
  if (a === 'claim') {
    if (w < 2) throw new Error('Pretenziju var iesniegt vadītājs');
    const v = await db.prepare(`SELECT * FROM ${T} WHERE id = ?`).bind(String(b.id || '')).first(); if (!v) throw new Error('Apmeklējums nav atrasts — atjaunojiet');
    if (v.statuss !== 'done') throw new Error('Pretenziju var iesniegt tikai par izpildītu darbu');
    await assertOpen(db, v.datums);
    if (await db.prepare("SELECT 1 FROM claim WHERE app = ? AND visit = ? AND statuss = 'atverta'").bind(app, v.id).first()) throw new Error('Šim darbam jau ir atvērta pretenzija');
    const tx = String(b.teksts || '').trim().slice(0, 1000); if (tx.length < 3) throw new Error('Aprakstiet, kas nav kārtībā');
    const photos = (b.photos || []).filter(p => IMG_RE.test(String(p))).slice(0, 4);
    const ids = photos.length ? await X.savePhotos({ datums: v.datums, adrese: name + ' · pretenzija · ' + v.adrese }, photos) : [];
    const id = uid(), who = v.brigade || v.izpilditajs || '';
    await db.prepare('INSERT INTO claim (id, app, visit, anorm, adrese, datums, teksts, foto, kas, laiks, izpilditajs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, app, v.id, v.anorm, v.adrese, v.datums, tx, ids.join(','), me.name, nowStr(), who).run();
    await audit(db, me.name, name, v.adrese, ['Pretenzija ' + lvD(v.datums), '', tx.slice(0, 200)]);
    const to = await personNames(env, [v.brigade, v.izpilditajs, String(v.izpilditajs || '').split(' · ')[0]].filter(Boolean)).catch(() => []);
    const job = notify(env, to, { title: '⚠ Pretenzija · ' + name, body: v.adrese + ' (' + lvD(v.datums) + '): ' + tx.slice(0, 100), url: '/sh/#' + app, urgent: true }).catch(() => 0);
    if (X && X.bg) X.bg(job); else await job;
    return { id };
  }
  if (a === 'claimFix') {
    if (w < 1) throw new Error('Atzīmēt var izpildītājs');
    const c = await db.prepare("SELECT * FROM claim WHERE id = ? AND app = ?").bind(String(b.cid || ''), app).first(); if (!c) throw new Error('Pretenzija nav atrasta');
    if (c.statuss !== 'atverta') return { already: true };
    await assertOpen(db, c.datums);
    if (me.company && c.izpilditajs && c.izpilditajs !== me.name && !c.izpilditajs.startsWith(me.name + ' ·')) throw new Error('Šī pretenzija nav jūsu brigādei');
    const photos = (b.photos || []).filter(p => IMG_RE.test(String(p))).slice(0, 4); if (!photos.length) throw new Error('Pievienojiet bildi pēc labošanas');
    const ids = await X.savePhotos({ datums: c.datums, adrese: name + ' · labots · ' + c.adrese }, photos);
    const piez = String(b.piezime || '').trim().slice(0, 300);
    await db.prepare("UPDATE claim SET statuss = 'labota', lab_kas = ?, lab_laiks = ?, lab_foto = ?, lab_piez = ? WHERE id = ? AND statuss = 'atverta'").bind(me.who || me.name, nowStr(), ids.join(','), piez, c.id).run();
    await audit(db, me.who || me.name, name, c.adrese, ['Pretenzija ' + lvD(c.datums), 'atvērta', 'labota' + (piez ? ': ' + piez : '')]);
    const job = (async () => notify(env, [...new Set([c.kas].concat(await managers(env, app)))], { title: '✓ Labots · ' + name, body: c.adrese + ' (' + lvD(c.datums) + ')' + (piez ? ': ' + piez : ''), url: '/sh/#' + app }))().catch(() => 0);
    if (X && X.bg) X.bg(job); else await job;
    return { ok: true };
  }
  throw new Error('Nezināma darbība');
}
