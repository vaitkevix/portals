/* SH | Prombūtņu reģistrs (Personāls, C3): slimības lapa B/A, bezalgas, mācības, cits — darbinieks, no/līdz. Arī no SMS «SLIMS».
 * Kopā ar apstiprinātiem atvaļinājumiem (pers_vac) dod dienu kodus Darba laika tabelei (C1) un aizvietošanas melnrakstus (C4).
 * Datus nedzēš — «dzēst» = dzests 1. © VAITKEVIX, SIA */
import { today, addDays, nowStr, uid, akey } from './util.js';
import { audit } from './audit.js';
import { notify } from './webpush.js';

export const ABS_T = { B: 'Slimības lapa B', S: 'Slimības lapa A', AB: 'Bezalgas atvaļinājums', M: 'Mācības', C: 'Cits' };
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
export const vkey = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const isD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
export const dmyIso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : isD(String(s || '').slice(0, 10)) ? String(s).slice(0, 10) : ''; };

/** Prombūtnes periodā (pārklājas ar no..lidz). lidz '' = vēl turpinās */
export async function absList(db, no, lidz) {
  return all(db, "SELECT * FROM pers_abs WHERE dzests = 0 AND no <= ? AND (lidz = '' OR lidz >= ?) ORDER BY no DESC", lidz, no).catch(() => []);
}
/** Dienu kodi pa darbiniekiem: { vkey: { 'YYYY-MM-DD': 'A' | 'B' | … } } — A no apstiprinātiem atvaļinājumiem (izņemot «strādās atvaļinājuma laikā») */
export async function absMap(db, no, lidz) {
  const M = {}, put = (v, a, b, code) => { const k = vkey(v); if (!k || !a) return; const m = M[k] || (M[k] = {}), e0 = b || today(), end = e0 < lidz ? e0 : lidz;
    for (let d = a < no ? no : a; d <= end && d <= lidz; d = addDays(d, 1)) if (!m[d] || code !== 'A') m[d] = code; };
  for (const r of await all(db, "SELECT darbinieks, no, lidz, strada FROM pers_vac WHERE statuss = 'Apstiprināts'").catch(() => [])) {
    if (r.strada) continue; const a = dmyIso(r.no), b = dmyIso(r.lidz); if (a && b && a <= lidz && b >= no) put(r.darbinieks, a, b, 'A');
  }
  for (const r of await absList(db, no, lidz)) put(r.vards, r.no, r.lidz, r.tips || 'C');
  return M;
}

/** Saglabā prombūtni (jauna vai labota). who = { name, role }. Atgriež ierakstu. */
export async function absSave(env, who, f) {
  const db = env.DB, vards = String(f.vards || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (vards.split(' ').filter(x => x.length > 1).length < 2) throw new Error('Izvēlieties darbinieku (vārds un uzvārds)');
  const tips = ABS_T[f.tips] ? f.tips : ''; if (!tips) throw new Error('Izvēlieties prombūtnes veidu');
  const no = isD(f.no) ? f.no : '', lidz = isD(f.lidz) ? f.lidz : '';
  if (!no) throw new Error('Norādiet, no kura datuma');
  if (lidz && lidz < no) throw new Error('«Līdz» nevar būt pirms «no»');
  if (tips !== 'B' && tips !== 'S' && !lidz) throw new Error('Norādiet, līdz kuram datumam');
  const piez = String(f.piezime || '').trim().slice(0, 300), id = /^[a-z0-9]{10}$/.test(String(f.id || '')) ? f.id : '';
  if (id) {
    const old = await db.prepare('SELECT * FROM pers_abs WHERE id = ? AND dzests = 0').bind(id).first(); if (!old) throw new Error('Ieraksts nav atrasts');
    if (who.role !== 'admin' && old.kas !== who.name) throw new Error('Labot var tas, kas ievadīja, vai administrators');
    await db.prepare('UPDATE pers_abs SET vards = ?, vkey = ?, tips = ?, no = ?, lidz = ?, piezime = ? WHERE id = ?').bind(vards, vkey(vards), tips, no, lidz, piez, id).run();
    await audit(db, who.name, 'Prombūtnes', vards, [['Veids', ABS_T[old.tips] || old.tips, ABS_T[tips]], ['No', old.no, no], ['Līdz', old.lidz, lidz], ['Piezīme', old.piezime, piez]].filter(x => x[1] !== x[2]));
    return db.prepare('SELECT * FROM pers_abs WHERE id = ?').bind(id).first();
  }
  const dup = await db.prepare("SELECT id FROM pers_abs WHERE dzests = 0 AND vkey = ? AND no <= ? AND (lidz = '' OR lidz >= ?)").bind(vkey(vards), lidz || '9999-12-31', no).first();
  if (dup) throw new Error(vards + ' jau ir prombūtne šajā periodā');
  const nid = uid();
  await db.prepare('INSERT INTO pers_abs (id, vards, vkey, tips, no, lidz, piezime, avots, kas, izveidots, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(nid, vards, vkey(vards), tips, no, lidz, piez, String(f.avots || 'roku').slice(0, 20), who.name, nowStr(), String(f.phone || '').slice(0, 20)).run();
  await audit(db, who.name, 'Prombūtnes', vards, ['prombūtne', '', ABS_T[tips] + ' ' + no + (lidz ? ' – ' + lidz : ' – …')]);
  const r = await db.prepare('SELECT * FROM pers_abs WHERE id = ?').bind(nid).first();
  await standingDrafts(env, { src: 'abs:' + nid, vards, no, lidz, prombutne: tips === 'B' || tips === 'S' ? 'DNL' : 'Atvaļinājums', kas: who.name }).catch(e => console.error('abs drafts', e));
  return r;
}
export async function absDel(db, who, id) {
  const old = await db.prepare('SELECT * FROM pers_abs WHERE id = ? AND dzests = 0').bind(String(id || '')).first(); if (!old) throw new Error('Ieraksts nav atrasts');
  if (who.role !== 'admin' && old.kas !== who.name) throw new Error('Noņemt var tas, kas ievadīja, vai administrators');
  await db.prepare('UPDATE pers_abs SET dzests = 1 WHERE id = ?').bind(old.id).run();
  await db.prepare("UPDATE standing SET melnraksts = 'noraidīts' WHERE avots LIKE ? AND melnraksts = '1'").bind('abs:' + old.id + ':%').run().catch(() => 0);   // neapstiprināti melnraksti vairs nav vajadzīgi
  await audit(db, who.name, 'Prombūtnes', old.vards, ['prombūtne', ABS_T[old.tips] + ' ' + old.no + (old.lidz ? ' – ' + old.lidz : ''), 'noņemta']);
}

/* ---------- C4: atvaļinājums / prombūtne → Aizvietošanas pastāvīgās aizvietošanas melnraksts darbinieka objektos ---------- */
const typeOf = (am) => { am = String(am || '').toLowerCase(); const s = /s[eē]tn|set\b/.test(am), u = /uzkop|uzk\b/.test(am); return s && u || am === 'abi' ? 'Abi' : s ? 'Sētnieks' : 'Uzkopēja'; };
/** Darbinieka objekti: Darba laika piesaistes (pēc vārda) + Personāla pieņemšanas/grozījumu objekti; papildus — objektu nosaukumi tekstā */
async function objectsOf(db, vards, extra) {
  const k = vkey(vards), O = await all(db, 'SELECT anorm, adrese, vaditajs FROM objects'), byKey = {}; O.forEach(o => byKey[akey(o.adrese)] = o);
  const res = new Map(), add = (o, am) => { if (!o) return; const x = res.get(o.anorm); if (x) { if (x.am !== am) x.am = 'abi'; } else res.set(o.anorm, Object.assign({ am }, o)); };
  const names = (v) => String(v || '').split(';').map(s => s.split(/\s+[—–-]\s+/)[0].trim()).filter(Boolean);
  for (const n of names(extra)) add(byKey[akey(n)], typeOf(String(extra).split(';').find(e => e.indexOf(n) !== -1) || ''));
  if (!res.size) {
    const W = (await all(db, 'SELECT phone, vards, amats, anorm FROM dl_worker WHERE aktivs = 1').catch(() => [])).filter(w => vkey(w.vards) === k);
    for (const w of W) {
      const A = await all(db, 'SELECT anorm, amats FROM dl_assign WHERE phone = ?', w.phone).catch(() => []);
      if (!A.length && w.anorm) A.push({ anorm: w.anorm, amats: w.amats });
      A.forEach(a => add(O.find(o => o.anorm === a.anorm), a.amats === 'set' ? 'Sētnieks' : a.amats === 'abi' ? 'Abi' : 'Uzkopēja'));
    }
  }
  if (!res.size) {   // pēdējā apstiprinātā pieņemšana / grozījums
    const H = (await all(db, "SELECT vards, objekts FROM pers_hire WHERE statuss = 'Apstiprināts'").catch(() => [])).filter(h => vkey(h.vards) === k).slice(-1)[0];
    const G = (await all(db, "SELECT darbinieks, objekts FROM pers_chg WHERE statuss = 'Apstiprināts' AND objekts != ''").catch(() => [])).filter(g => vkey(g.darbinieks) === k).slice(-1)[0];
    const src = (G && G.objekts) || (H && H.objekts) || '';
    for (const e of String(src).split(';')) { const n = e.split(/\s+[—–-]\s+/)[0].trim(); if (n) add(byKey[akey(n)], typeOf(e)); }
  }
  return [...res.values()];
}
/** { src, vards, no, lidz, prombutne, objekti?, kas } → melnraksti standing tabulā (melnraksts = '1'); dublikātus neveido */
export async function standingDrafts(env, p) {
  const db = env.DB, t = today(); if (p.lidz && p.lidz < t) return 0;
  const O = p.objs ? p.objs.map(o => Object.assign({ am: o.amats === 'set' ? 'Sētnieks' : o.amats === 'abi' ? 'Abi' : 'Uzkopēja' }, o)) : await objectsOf(db, p.vards, p.objekti); if (!O.length) return 0;   // objs — jau zināmi objekti (Neieradās)
  const types = new Set((await all(db, "SELECT name FROM types WHERE grp = 'Aizvietošana'").catch(() => [])).map(r => r.name));
  const no = p.no > t ? p.no : t, st = [], mgr = {};
  for (const o of O) {
    const avots = p.src + ':' + o.anorm;
    if (await db.prepare('SELECT 1 FROM standing WHERE avots = ?').bind(avots).first()) continue;
    const tips = types.has(o.am) ? o.am : [...types][0] || o.am;
    st.push(db.prepare("INSERT INTO standing (id, adrese, tips, apraksts, vaditajs, prombutne, no, beigas, brivdienas, steidzami, laiks, foto, izlaistas, izveidots, seq, melnraksts, brigade, avots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', '', ?, ?, '1', '', ?)")
      .bind(uid(), o.adrese, tips, p.apraksts || ('Aizvieto: ' + p.vards), o.vaditajs || '', p.prombutne, no, p.lidz || '', nowStr(), Date.now() * 100 + st.length, avots));
    if (o.vaditajs) (mgr[o.vaditajs] = mgr[o.vaditajs] || []).push(o.adrese);
  }
  if (st.length) await db.batch(st);
  const per = (d) => d ? d.slice(8) + '.' + d.slice(5, 7) + '.' : '…';
  if (!p.silent) for (const m in mgr) await notify(env, [m], { title: 'Aizvietošana: jāapstiprina melnraksts', body: p.vards + ' ' + (p.prombutne === 'DNL' ? 'slimo' : 'prombūtnē') + ' ' + per(no) + '–' + per(p.lidz) + ': ' + mgr[m].slice(0, 3).join(', '), url: '/sh/#aizv' }).catch(() => 0);
  return st.length;
}
