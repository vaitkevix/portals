// SH | Objekta kartīte administrēšanā: viss par objektu vienuviet — algas pa amatiem, Darba laiks (kods, vajadzība, darbinieki),
// Personāla darbinieki, klients, grafiki. Algas izmanto Personāls (piedāvājums pieņemot darbā). © VAITKEVIX, SIA
import { anorm } from './util.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const GRAF = [['pl', 'pl_obj', 'Zāles pļaušana'], ['logi', 'logi_obj', 'Logu mazgāšana'], ['darz', 'darz_obj', 'Dārzniecība'], ['stav', 'stav_obj', 'Pazemes stāvvietas'], ['sniegs', 'sniegs_obj', 'Sniega tīrīšana']];
const pj = (s, d) => { try { return JSON.parse(s || '') || d; } catch (e) { return d; } };

/** Visas objektu algas: { anorm: [{ amats, alga, slodze }] } */
export async function allAlgas(db) {
  const o = {}; (await all(db, "SELECT anorm, algas FROM obj_info WHERE algas != '[]'").catch(() => [])).forEach(r => o[r.anorm] = pj(r.algas, [])); return o;
}

export async function info(db, adrese) {
  const k = anorm(adrese), out = { anorm: k };
  const oi = await first(db, 'SELECT algas, piezimes, pazemes FROM obj_info WHERE anorm = ?', k).catch(() => null);
  out.algas = pj(oi && oi.algas, []); out.piezimes = (oi && oi.piezimes) || ''; out.pazemes = !!(oi && oi.pazemes);
  const d = await first(db, 'SELECT kods, vajag_uzk, vajag_set, aktivs FROM dl_obj WHERE anorm = ?', k).catch(() => null);
  out.dl = { kods: d && d.aktivs ? d.kods : '', vajag_uzk: d ? !!d.vajag_uzk : true, vajag_set: d ? !!d.vajag_set : true,
    darbinieki: (await all(db, 'SELECT phone, vards, amats, aktivs FROM dl_worker WHERE anorm = ? ORDER BY aktivs DESC, vards', k).catch(() => [])) };
  const c = await first(db, 'SELECT c.name FROM client_obj o JOIN clients c ON c.id = o.client WHERE o.anorm = ?', k).catch(() => null);
  out.klients = c ? c.name : '';
  out.grafiki = [];
  for (const [app, tbl, name] of GRAF) { const r = await first(db, 'SELECT aktivs FROM ' + tbl + ' WHERE anorm = ?', k).catch(() => null); if (r) out.grafiki.push({ app, name, aktivs: !!r.aktivs }); }
  // Personāls: apstiprināti/jauni pieņemšanas ieraksti ar šo objektu
  const low = String(adrese || '').trim().toLowerCase();
  out.personals = (await all(db, "SELECT id, vards, amats, objekts, statuss, sakums FROM pers_hire WHERE statuss != 'Noraidīts'").catch(() => []))
    .filter(h => String(h.objekts || '').split(';').some(e => e.split('—')[0].trim().toLowerCase() === low)).map(h => ({ id: h.id, vards: h.vards, statuss: h.statuss, sakums: h.sakums,
      amats: (String(h.objekts).split(';').find(e => e.split('—')[0].trim().toLowerCase() === low) || '').split('—').slice(1).filter(x => !/\d\s*(EUR|€)?\s*$/i.test(x.trim())).join('').trim() }));
  return out;
}

export async function save(db, b) {
  const k = anorm(b.adrese); if (!k) throw new Error('Nav objekta');
  const algas = (Array.isArray(b.algas) ? b.algas : []).map(a => ({ amats: String(a.amats || '').trim(), alga: Math.round((parseFloat(String(a.alga || '').replace(',', '.')) || 0) * 100) / 100, slodze: String(a.slodze || '').trim().slice(0, 40) }))
    .filter(a => a.amats && a.alga > 0);
  const kods = b.dl ? String(b.dl.kods || '').trim().toUpperCase() : '';
  if (kods) {   // vispirms pārbauda — lai nekas netiek saglabāts pa pusei
    if (!/^[0-9A-Z-]{1,8}$/.test(kods)) throw new Error('Darba laika kods — līdz 8 cipariem/burtiem, piem. 104');
    if (await first(db, 'SELECT anorm FROM dl_obj WHERE kods = ? AND anorm != ?', kods, k)) throw new Error('Darba laika kods ' + kods + ' jau ir citam objektam');
  }
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO obj_info (anorm, algas, piezimes, atjaunots) VALUES (?, ?, ?, ?) ON CONFLICT(anorm) DO UPDATE SET algas = excluded.algas, piezimes = excluded.piezimes, atjaunots = excluded.atjaunots')
    .bind(k, JSON.stringify(algas), String(b.piezimes || '').trim().slice(0, 2000), now).run();
  if ('pazemes' in b) {   // Pazemes stāvvieta: nav → pazūd no Stāvvietām, grafiks apturēts (vēsture paliek)
    await db.prepare('UPDATE obj_info SET pazemes = ? WHERE anorm = ?').bind(b.pazemes ? 1 : 0, k).run();
    if (!b.pazemes) await db.batch([db.prepare('UPDATE stav_obj SET aktivs = 0 WHERE anorm = ?').bind(k), db.prepare("DELETE FROM stav_visit WHERE anorm = ? AND statuss = 'plan' AND avots != 'pieteikums'").bind(k)]).catch(() => 0);
  }
  if (b.dl) {   // Darba laiks: SMS kods un vajadzība (tā pati loģika kā Darba laika Iestatījumos)
    if (!kods) await db.prepare('UPDATE dl_obj SET aktivs = 0 WHERE anorm = ?').bind(k).run();
    else {
      await db.prepare('INSERT INTO dl_obj (anorm, kods, vajag_uzk, vajag_set, aktivs) VALUES (?, ?, ?, ?, 1) ON CONFLICT(anorm) DO UPDATE SET kods = excluded.kods, vajag_uzk = excluded.vajag_uzk, vajag_set = excluded.vajag_set, aktivs = 1')
        .bind(k, kods, b.dl.vajag_uzk === false ? 0 : 1, b.dl.vajag_set === false ? 0 : 1).run();
    }
  }
  return info(db, b.adrese);
}
