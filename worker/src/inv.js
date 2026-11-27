/* SH | I8 Materiāli un inventārs: inv_item (sāls, smiltis, mix, maisi, ķīmija, tehnika; vienība; minimums) un inv_move (+ ienākums, − izsniegts/izlietots, korekcija).
 * Automātiskās kustības (cron, dedublē pēc avots): Sniega tīrīšana «done» ar kaisīts + kg → − t; Kaisāmmateriāla piegāde (maisi × 25 kg) → − t.
 * C11 sezonas krājums (kv kais:krajums, t) — tas pats atlikums: pirmajā reizē pārnes kā inventarizāciju, «Sezona» → Saglabāt = inventarizācija šeit.
 * Zem minimuma → push adminiem (vienreiz, līdz atjaunots) + «Izveidot pasūtījumu» (piezīme). Tehnikai: kam izsniegts, motorstundas, nākamā apkope. © VAITKEVIX, SIA */
import { today, addDays, nowStr, uid, kv, kvSet } from './util.js';
import { notify, managers } from './webpush.js';
import { audit } from './audit.js';

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const str = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n);
const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? Math.round(x * 1000) / 1000 : 0; };
export const VEIDI = { materials: 'Kaisāmais materiāls', maisi: 'Maisi', kimija: 'Ķīmija', tehnika: 'Tehnika', cits: 'Cits' };
export const MV = { ienakums: 'Ienākums', izsniegts: 'Izsniegts', izlietots: 'Izlietots', korekcija: 'Korekcija', inventarizacija: 'Inventarizācija' };
const BASE = [['sals', 'Sāls', 't'], ['smilts', 'Smiltis', 't'], ['mix', 'Smilts + sāls (mix)', 't']];
const BAG_KG = 25;
export const matKey = (m) => { m = String(m || '').toLowerCase(); return /mix|\/|\+/.test(m) ? 'mix' : /s[aā]l/.test(m) ? 'sals' : /smilt/.test(m) ? 'smilts' : ''; };

/** Pamata materiāli (sāls/smiltis/mix) + pārnes C11 krājumu (vienreiz) */
export async function ensure(db) {
  if (await db.prepare("SELECT 1 FROM inv_item WHERE kods = 'sals'").first()) return;
  const K = (await kv(db, 'kais:krajums')) || {}, st = [kvSet(db, 'inv:start', today())];   // automātiskās kustības tikai no šīs dienas (agrākās jau ir krājuma skaitlī)
  for (const [k, n, u] of BASE) {
    const id = uid(); st.push(db.prepare("INSERT OR IGNORE INTO inv_item (id, kods, nosaukums, veids, vieniba, minimums, aktivs, laiks) VALUES (?, ?, ?, 'materials', ?, 0, 1, ?)").bind(id, k, n, u, nowStr()));
    if (+K[k] > 0) st.push(db.prepare("INSERT INTO inv_move (id, item, datums, daudz, veids, kas, avots, piezime, laiks) VALUES (?, ?, ?, ?, 'inventarizacija', ?, ?, 'Pārnests no sezonas krājuma (C11)', ?)").bind(uid(), id, K.atjaunots || today(), +K[k], K.kas || 'sistēma', 'c11:' + k, nowStr()));
  }
  await db.batch(st);
}
/** Atlikumi: { id: daudz } */
async function balances(db) { const B = {}; (await all(db, 'SELECT item, SUM(daudz) s FROM inv_move GROUP BY item')).forEach(r => B[r.item] = Math.round((r.s || 0) * 1000) / 1000); return B; }
export async function items(db) {
  await ensure(db);
  const B = await balances(db), t = today();
  return (await all(db, 'SELECT * FROM inv_item WHERE aktivs = 1 ORDER BY veids, nosaukums')).map(i => Object.assign(i, { atlikums: B[i.id] || 0,
    zem: i.veids !== 'tehnika' && i.minimums > 0 && (B[i.id] || 0) < i.minimums,
    apkope: i.veids === 'tehnika' && ((i.apk_dat && i.apk_dat <= addDays(t, 14)) || (i.apk_mh > 0 && i.mh >= i.apk_mh - 5)) }));
}
/** C11: sezonas krājums no inventāra (t) — tas pats skaitlis */
export async function krajums(db) { const L = await items(db), K = {}; for (const [k] of BASE) { const i = L.find(x => x.kods === k); if (i) K[k] = i.atlikums; } return K; }
/** C11 «Saglabāt krājumu» = inventarizācija (kustība līdz norādītajam atlikumam) */
export async function setStock(db, who, vals) {
  const L = await items(db), st = [];
  for (const [k] of BASE) { if (vals[k] == null || vals[k] === '') continue; const i = L.find(x => x.kods === k); if (!i) continue;
    const d = Math.round((num(vals[k]) - i.atlikums) * 1000) / 1000; if (!d) continue;
    st.push(db.prepare("INSERT INTO inv_move (id, item, datums, daudz, veids, kas, avots, piezime, laiks) VALUES (?, ?, ?, ?, 'inventarizacija', ?, '', 'Sezona → krājums', ?)").bind(uid(), i.id, today(), d, who, nowStr())); }
  if (st.length) await db.batch(st);
}

/** Cron (ik 30 min): automātiskās kustības no Sniega (kg) un Kaisāmmateriāla (maisi) pēdējās 14 dienās + zem minimuma paziņojums */
export async function cron(env) {
  const db = env.DB; if (Date.now() - +((await kv(db, 'inv:at')) || 0) < 25 * 60e3) return; await kvSet(db, 'inv:at', Date.now()).run();
  await ensure(db);
  const I = {}; (await all(db, "SELECT id, kods FROM inv_item WHERE kods IN ('sals', 'smilts', 'mix')")).forEach(r => I[r.kods] = r.id);
  const d14 = addDays(today(), -14), d0 = (await kv(db, 'inv:start')) || d14, from = d0 > d14 ? d0 : d14, st = [];
  for (const v of await all(db, "SELECT id, anorm, adrese, datums, izpilditajs, brigade, izpilde FROM sniegs_visit WHERE statuss = 'done' AND datums >= ? AND izpilde LIKE '%\"kg\"%'", from).catch(() => [])) {
    let iz = {}; try { iz = JSON.parse(v.izpilde || '{}'); } catch (e) {}
    const k = matKey(iz.kaisits), kg = +iz.kg || 0; if (!k || !I[k] || kg <= 0 || iz.kaisits === 'Nav') continue;
    st.push(db.prepare("INSERT OR IGNORE INTO inv_move (id, item, datums, daudz, veids, anorm, adrese, kas, avots, piezime, laiks) VALUES (?, ?, ?, ?, 'izlietots', ?, ?, ?, ?, 'Sniega tīrīšana — kaisīts', ?)")
      .bind(uid(), I[k], v.datums, -Math.round(kg) / 1000, v.anorm, v.adrese, v.izpilditajs || v.brigade || '', 'sniegs:' + v.id, nowStr()));
  }
  for (const t of await all(db, "SELECT id, adrese, materials, piegadati, kurjers, piegadats FROM kais_task WHERE statuss = 'Piegādāts' AND piegadati != ''").catch(() => [])) {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(t.piegadats || '')), d = m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : '';
    if (!d || d < from) continue;
    const k = matKey(t.materials), n = num(t.piegadati); if (!k || !I[k] || n <= 0) continue;
    const an = String(t.adrese || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    st.push(db.prepare("INSERT OR IGNORE INTO inv_move (id, item, datums, daudz, veids, anorm, adrese, kas, avots, piezime, laiks) VALUES (?, ?, ?, ?, 'izsniegts', ?, ?, ?, ?, ?, ?)")
      .bind(uid(), I[k], d, -Math.round(n * BAG_KG) / 1000, an, t.adrese, t.kurjers || '', 'kais:' + t.id, 'Kaisāmmateriāla piegāde — ' + n + ' maisi', nowStr()));
  }
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  /* zem minimuma → adminiem vienreiz (kv inv:low:<id>), atkal tikai, kad atlikums bija atjaunots */
  const L = await items(db), low = [];
  for (const i of L.filter(x => x.veids !== 'tehnika' && x.minimums > 0)) {
    const k = 'inv:low:' + i.id, was = await kv(db, k);
    if (i.zem && !was) { low.push(i); await kvSet(db, k, today()).run(); }
    else if (!i.zem && was) await db.prepare('DELETE FROM kv WHERE k = ?').bind(k).run();
  }
  if (low.length) await notify(env, await managers(env, 'portal'), { title: '📦 Zem minimuma: ' + low.map(i => i.nosaukums).join(', ').slice(0, 60), body: low.map(i => i.nosaukums + ' ' + fmt(i.atlikums) + ' ' + i.vieniba + ' (min ' + fmt(i.minimums) + ')').join('; ') + ' — Administrēšana → Inventārs', url: '/sh/', urgent: false }).catch(() => 0);
}
const fmt = (x) => String(Math.round(x * 1000) / 1000).replace('.', ',');

/* ---------- Administrēšana → Inventārs (portāla admins) ---------- */
export async function adminApi(env, a, b, who) {
  const db = env.DB;
  if (a === 'invList') return { items: await items(db), veidi: VEIDI, mv: MV, moves: (await all(db, 'SELECT m.*, i.nosaukums, i.vieniba FROM inv_move m JOIN inv_item i ON i.id = m.item ORDER BY m.datums DESC, m.laiks DESC LIMIT 60')) };
  if (a === 'invItem') {
    const f = b.f || {}, old = f.id ? await db.prepare('SELECT * FROM inv_item WHERE id = ?').bind(str(f.id, 20)).first() : null;
    const v = { nosaukums: str(f.nosaukums, 80), veids: VEIDI[f.veids] ? f.veids : 'cits', vieniba: str(f.vieniba, 12) || 'gab.', minimums: Math.max(0, num(f.minimums)), piezime: str(f.piezime, 300),
      izsniegts: str(f.izsniegts, 80), mh: Math.max(0, num(f.mh)), apk_mh: Math.max(0, num(f.apk_mh)), apk_dat: /^\d{4}-\d{2}-\d{2}$/.test(f.apk_dat || '') ? f.apk_dat : '', aktivs: f.aktivs === false ? 0 : 1 };
    if (!v.nosaukums) throw new Error('Ierakstiet nosaukumu');
    if (old) {
      await db.prepare('UPDATE inv_item SET nosaukums = ?, veids = ?, vieniba = ?, minimums = ?, piezime = ?, izsniegts = ?, mh = ?, apk_mh = ?, apk_dat = ?, aktivs = ?, laiks = ? WHERE id = ?')
        .bind(v.nosaukums, old.kods ? old.veids : v.veids, old.kods ? old.vieniba : v.vieniba, v.minimums, v.piezime, v.izsniegts, v.mh, v.apk_mh, v.apk_dat, old.kods ? 1 : v.aktivs, nowStr(), old.id).run();
      await audit(db, who, 'Inventārs', v.nosaukums, ['nosaukums', 'minimums', 'izsniegts', 'mh', 'apk_mh', 'apk_dat', 'aktivs'].filter(k => String(old[k]) !== String(v[k])).map(k => [({ minimums: 'minimums', izsniegts: 'izsniegts', mh: 'motorstundas', apk_mh: 'apkope pie mh', apk_dat: 'apkope līdz', aktivs: 'aktīvs', nosaukums: 'nosaukums' })[k], String(old[k]), String(v[k])]));
    } else {
      await db.prepare('INSERT INTO inv_item (id, kods, nosaukums, veids, vieniba, minimums, piezime, izsniegts, mh, apk_mh, apk_dat, aktivs, laiks) VALUES (?, \'\', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .bind(uid(), v.nosaukums, v.veids, v.vieniba, v.minimums, v.piezime, v.izsniegts, v.mh, v.apk_mh, v.apk_dat, nowStr()).run();
      await audit(db, who, 'Inventārs', v.nosaukums, ['jauns', '', VEIDI[v.veids] + ', ' + v.vieniba]);
    }
    return adminApi(env, 'invList', {}, who);
  }
  if (a === 'invMove') {
    const i = await db.prepare('SELECT * FROM inv_item WHERE id = ?').bind(str(b.item, 20)).first(); if (!i) throw new Error('Nav atrasts');
    const mv = MV[b.veids] ? b.veids : ''; if (!mv) throw new Error('Izvēlieties kustības veidu');
    let q = Math.abs(num(b.daudz)); if (!q && mv !== 'inventarizacija') throw new Error('Ierakstiet daudzumu');
    if (mv === 'izsniegts' || mv === 'izlietots') q = -q;
    if (mv === 'korekcija') q = num(b.daudz);
    if (mv === 'inventarizacija') { const B = await balances(db); q = Math.round((num(b.daudz) - (B[i.id] || 0)) * 1000) / 1000; if (!q) throw new Error('Atlikums jau ir tāds'); }
    const d = /^\d{4}-\d{2}-\d{2}$/.test(b.datums || '') && b.datums <= today() ? b.datums : today();
    const an = str(b.adrese, 200).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    await db.prepare("INSERT INTO inv_move (id, item, datums, daudz, veids, anorm, adrese, kas, avots, piezime, laiks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)")
      .bind(uid(), i.id, d, q, mv, an, str(b.adrese, 200), str(b.kam, 80) || who, str(b.piezime, 300), nowStr()).run();
    if (i.veids === 'tehnika' && mv === 'izsniegts' && b.kam) await db.prepare('UPDATE inv_item SET izsniegts = ? WHERE id = ?').bind(str(b.kam, 80), i.id).run();
    if (mv === 'ienakums' && i.pasutits) await db.prepare("UPDATE inv_item SET pasutits = '' WHERE id = ?").bind(i.id).run();
    await audit(db, who, 'Inventārs', i.nosaukums, [MV[mv], '', fmt(q) + ' ' + i.vieniba + (b.adrese ? ' · ' + str(b.adrese, 80) : '') + (b.piezime ? ' · ' + str(b.piezime, 80) : '')]);
    return adminApi(env, 'invList', {}, who);
  }
  if (a === 'invOrder') {   // «Izveidot pasūtījumu» — piezīme (kas, kad, cik); pazūd ar nākamo ienākumu
    const i = await db.prepare('SELECT * FROM inv_item WHERE id = ?').bind(str(b.item, 20)).first(); if (!i) throw new Error('Nav atrasts');
    const p = today() + ' · ' + who + (b.daudz ? ' · ' + fmt(num(b.daudz)) + ' ' + i.vieniba : '') + (b.piezime ? ' · ' + str(b.piezime, 120) : '');
    await db.prepare('UPDATE inv_item SET pasutits = ? WHERE id = ?').bind(p, i.id).run();
    await audit(db, who, 'Inventārs', i.nosaukums, ['pasūtījums', i.pasutits || '', p]);
    return adminApi(env, 'invList', {}, who);
  }
  if (a === 'invHist') return { moves: await all(db, 'SELECT * FROM inv_move WHERE item = ? ORDER BY datums DESC, laiks DESC LIMIT 200', str(b.item, 20)) };
  throw new Error('Nezināma darbība');
}
/** Panelim: zem minimuma un tehnikas apkopes */
export async function warn(db) { try { const L = await items(db); return L.filter(i => i.zem || i.apkope).map(i => ({ id: i.id, nosaukums: i.nosaukums, veids: i.veids, atlikums: i.atlikums, minimums: i.minimums, vieniba: i.vieniba, zem: i.zem, apkope: i.apkope, apk_dat: i.apk_dat, mh: i.mh, apk_mh: i.apk_mh, pasutits: i.pasutits, izsniegts: i.izsniegts })); } catch (e) { return []; } }
