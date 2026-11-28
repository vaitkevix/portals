/* SH | Klienti un izpildes akti: klienti ar cenām par vienību katrai lietotnei, objektu piesaiste, mēneša atskaite no visām lietotnēm
 * (daudzums × cena), CSV rēķinam un izpildes akts ar bildēm. Tikai portāla administratoram. © VAITKEVIX, SIA */
import { akey, splitAddr, assertOpen, monthClosed as monthClosedQ } from './util.js';
import { audit, diff } from './audit.js';
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const J = (s) => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
const mins = (a, b) => { if (!/^\d\d:\d\d$/.test(a || '') || !/^\d\d:\d\d$/.test(b || '')) return 0; let m = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3)); if (m < 0) m += 1440; return m; };
const r2 = (n) => Math.round(n * 100) / 100, r4 = (n) => Math.round(n * 1e4) / 1e4;   // cenas — līdz 4 zīmēm (0,0525 €/m²)
/* Bilžu lauks (id, Drive saites, «r2-…») → id saraksts ar komatiem, kā /img sagaida */
const fid = (v) => String(v || '').split(/[\s,]+/).map(x => { const m = /[?&]id=([\w-]{20,80})/.exec(x) || /\/d\/([\w-]{20,80})/.exec(x); return m ? m[1] : /^[\w-]{20,80}$/.test(x) ? x : ''; }).filter(Boolean).join(',');
/* Lietotne → kā skaita daudzumu rēķinam */
export const UNITS = {
  aizv: { name: 'Aizvietošana', unit: 'darbi' },
  pl: { name: 'Zāles pļaušana', unit: 'm²' },
  logi: { name: 'Logu mazgāšana', unit: 'logi' },
  darz: { name: 'Dārzniecība', unit: 'cilvēkst.' },
  stav: { name: 'Pazemes stāvvietas', unit: 'm²' },
  sniegs: { name: 'Sniega tīrīšana', unit: 'h' },
  izv: { name: 'Izvešana', unit: 'm³' },
  kais: { name: 'Kaisāmmateriāls', unit: 'maisi' },
};
/* Fiksētā līgumcena (client_sub) — atskaitē app 'ligums', cenu laukos nerādās */
export const LIG = { name: 'Līgumcena', unit: 'mēn.' };
export const ALL_UNITS = Object.assign({}, UNITS, { ligums: LIG });
const isoD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
const dmyIso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; };
const num = (v) => parseFloat(String(v == null ? '' : v).replace(',', '.')) || 0;
async function all(db, sql, ...a) { try { return (await db.prepare(sql).bind(...a).all()).results || []; } catch (e) { return []; } }

/* ---------- Cenu vēsture (client_price): cena, kas spēkā datumā; bez vēstures — clients.cenas ---------- */
const BASE = '2000-01-01';   // sākotnējā cena (pirms pirmās maiņas)
const todayR = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }).format(new Date());
async function priceHist(db, clientId) {
  const H = {}; for (const r of await all(db, 'SELECT app, cena, no FROM client_price WHERE client = ? ORDER BY no', clientId)) (H[r.app] = H[r.app] || []).push({ no: r.no, cena: r.cena }); return H;
}
const priceAt = (H, cen, app, d) => { const L = H[app]; if (!L || !L.length) return cen[app] || 0; let p = null; for (const x of L) if (x.no <= d) p = x.cena; return p == null ? (cen[app] || 0) : p; };
/** «Mainīt cenu no …»: jauna cena no datuma; pirmajā reizē saglabā arī līdzšinējo kā sākotnējo */
export async function priceChange(db, clientId, app, cena, no, who) {
  if (!UNITS[app]) throw new Error('Nezināms pakalpojums'); if (!isoD(no)) throw new Error('Norādiet datumu «spēkā no»');
  await assertOpen(db, no);
  const c = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first(); if (!c) throw new Error('Klients nav atrasts');
  const cen = J(c.cenas), H = await priceHist(db, clientId), v = r4(Math.max(0, num(cena))), old = priceAt(H, cen, app, no), t = new Date().toISOString();
  const st = [];
  if (!(H[app] || []).length && cen[app] > 0 && no > BASE) st.push(db.prepare('INSERT OR IGNORE INTO client_price (client, app, cena, no, kas, laiks) VALUES (?, ?, ?, ?, ?, ?)').bind(clientId, app, cen[app], BASE, String(who || ''), t));
  st.push(db.prepare('INSERT OR REPLACE INTO client_price (client, app, cena, no, kas, laiks) VALUES (?, ?, ?, ?, ?, ?)').bind(clientId, app, v, no, String(who || ''), t));
  await db.batch(st);
  const now = priceAt(await priceHist(db, clientId), cen, app, todayR()); if (now > 0) cen[app] = now; else delete cen[app];   // klienta formā — šodien spēkā esošā
  await db.prepare('UPDATE clients SET cenas = ? WHERE id = ?').bind(JSON.stringify(cen), clientId).run();
  if (who) await audit(db, who, 'Cenas', c.name, ['Cena ' + UNITS[app].name + ' no ' + no, old ? String(old) : '', String(v)]);
  return { bija: old, cena: v };
}
/** Masveida indeksācija: +X % visām aktīvo klientu cenām no datuma */
export async function priceIndex(db, pct, no, who) {
  pct = num(pct); if (!pct || Math.abs(pct) > 100) throw new Error('Norādiet procentus (piem. 5 vai -3)'); if (!isoD(no)) throw new Error('Norādiet datumu «spēkā no»');
  await assertOpen(db, no);
  let n = 0;
  for (const c of await all(db, 'SELECT id, cenas FROM clients WHERE aktivs = 1')) {
    const cen = J(c.cenas), H = await priceHist(db, c.id);
    for (const app of Object.keys(UNITS)) { const p = priceAt(H, cen, app, no); if (p > 0) { await priceChange(db, c.id, app, Math.round(p * (1 + pct / 100) * 10000) / 10000, no, who); n++; } }
  }
  if (who) await audit(db, who, 'Cenas', 'Visi klienti', ['Indeksācija no ' + no, '', (pct > 0 ? '+' : '') + pct + ' % · ' + n + ' cenas']);
  return { n };
}

export async function clientsData(db) {
  const clients = (await all(db, 'SELECT * FROM clients ORDER BY ord, name')).map(c => Object.assign({}, c, { cenas: J(c.cenas), aktivs: !!c.aktivs }));
  const links = await all(db, 'SELECT o.adrese, c.client FROM client_obj c JOIN objects o ON o.anorm = c.anorm');
  const subs = await all(db, 'SELECT * FROM client_sub ORDER BY ord, no');
  const ph = await all(db, 'SELECT client, app, cena, no FROM client_price ORDER BY no');
  clients.forEach(c => { c.cenVest = ph.filter(x => x.client === c.id).map(x => ({ app: x.app, cena: x.cena, no: x.no })); });
  clients.forEach(c => { c.viewPin = !!c.view_pin; delete c.view_pin; });   // PIN hash pārlūkā nesūta
  clients.forEach(c => { c.objekti = links.filter(l => l.client === c.id).map(l => l.adrese); c.lig = subs.filter(x => x.client === c.id).map(x => ({ id: x.id, adrese: x.adrese, apraksts: x.apraksts, summa: x.summa, no: x.no, lidz: x.lidz, avots: x.avots })); });
  return { clients, units: UNITS, allUnits: ALL_UNITS };
}
const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const CL_F = ['name', 'regnr', 'adrese', 'epasts', 'kontakts', 'liguma_nr', 'aktivs', 'lig_no', 'lig_lidz', 'lig_auto', 'lig_uzt'];
const clFlat = (c, n) => c ? Object.assign(Object.fromEntries(CL_F.map(f => [f, f === 'aktivs' ? (c[f] === false || c[f] === 0 ? 'nē' : 'jā') : f === 'lig_auto' ? (c[f] ? 'jā' : 'nē') : f === 'lig_uzt' ? String(+c[f] || 0) : (c[f] == null ? '' : c[f])])), Object.fromEntries(Object.keys(UNITS).map(k => ['cena ' + UNITS[k].name, (J(c.cenas)[k] || c.cenas && c.cenas[k]) || ''])), { objekti: n }) : {};
export async function saveClient(db, c, who) {
  const id = c.id || uid(), name = String(c.name || '').trim().slice(0, 120); if (!name) throw new Error('Ierakstiet klienta nosaukumu');
  const prev = c.id ? await db.prepare('SELECT * FROM clients WHERE id = ?').bind(c.id).first() : null;
  const prevN = prev ? ((await db.prepare('SELECT COUNT(*) n FROM client_obj WHERE client = ?').bind(id).first()) || {}).n || 0 : 0;
  const cen = {}; Object.keys(UNITS).forEach(k => { const v = +String((c.cenas || {})[k] || '').replace(',', '.'); if (v > 0) cen[k] = r4(v); });
  if (prev) {   // ja pakalpojumam jau ir cenu vēsture — tieša maiņa formā = jauna cena no šodienas (iepriekšējie mēneši nemainās)
    const H = await priceHist(db, id), pc = J(prev.cenas), t = todayR(), tt = new Date().toISOString();
    for (const k of Object.keys(UNITS)) if ((H[k] || []).length && (cen[k] || 0) !== (pc[k] || 0) && !await monthClosedQ(db, t))
      await db.prepare('INSERT OR REPLACE INTO client_price (client, app, cena, no, kas, laiks) VALUES (?, ?, ?, ?, ?, ?)').bind(id, k, cen[k] || 0, t, String(who || ''), tt).run();
  }
  const lg = { lig_no: isoD(c.lig_no), lig_lidz: isoD(c.lig_lidz), lig_auto: c.lig_auto ? 1 : 0, lig_uzt: Math.max(0, Math.min(3650, parseInt(c.lig_uzt, 10) || 0)) };
  if (lg.lig_no && lg.lig_lidz && lg.lig_lidz < lg.lig_no) throw new Error('Līguma beigas ir pirms noslēgšanas');
  if (!prev) Object.keys(lg).forEach(k => { if (c[k] == null) lg[k] = k === 'lig_auto' || k === 'lig_uzt' ? 0 : ''; });
  else Object.keys(lg).forEach(k => { if (c[k] === undefined) lg[k] = prev[k]; });   // vecāka forma bez līguma laukiem — nemaina
  const st = [db.prepare('INSERT INTO clients (id, name, regnr, adrese, epasts, kontakts, liguma_nr, cenas, aktivs, lig_no, lig_lidz, lig_auto, lig_uzt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, regnr = excluded.regnr, adrese = excluded.adrese, epasts = excluded.epasts, kontakts = excluded.kontakts, liguma_nr = excluded.liguma_nr, cenas = excluded.cenas, aktivs = excluded.aktivs, lig_no = excluded.lig_no, lig_lidz = excluded.lig_lidz, lig_auto = excluded.lig_auto, lig_uzt = excluded.lig_uzt')
    .bind(id, name, String(c.regnr || '').slice(0, 30), String(c.adrese || '').slice(0, 200), String(c.epasts || '').slice(0, 120), String(c.kontakts || '').slice(0, 120), String(c.liguma_nr || '').slice(0, 60), JSON.stringify(cen), c.aktivs === false ? 0 : 1, lg.lig_no, lg.lig_lidz, lg.lig_auto, lg.lig_uzt)];
  let ligCh = null;
  if (Array.isArray(c.lig)) {   // līgumcenas rindas — aizvieto ar formā redzamajām
    const was = await all(db, 'SELECT adrese, apraksts, summa, no, lidz FROM client_sub WHERE client = ? ORDER BY ord, no', id), fmt = (L) => L.map(x => (x.adrese || 'visi') + ' · ' + (x.apraksts || '') + ' · ' + r2(x.summa) + ' €' + (x.no ? ' no ' + x.no : '') + (x.lidz ? ' līdz ' + x.lidz : '')).join('; ');
    const L = c.lig.slice(0, 100).map((x, i) => ({ id: String(x.id || uid()).slice(0, 20), adrese: String(x.adrese || '').trim().slice(0, 200), apraksts: String(x.apraksts || '').trim().slice(0, 200), summa: r2(num(x.summa)), no: isoD(x.no), lidz: isoD(x.lidz), avots: String(x.avots || '').slice(0, 60), ord: i })).filter(x => x.summa > 0);
    L.forEach(x => { if (x.lidz && x.no && x.lidz < x.no) throw new Error('Līgumcenai «' + (x.apraksts || x.adrese || 'visi') + '» beigas ir pirms sākuma'); });
    st.push(db.prepare('DELETE FROM client_sub WHERE client = ?').bind(id));
    L.forEach(x => st.push(db.prepare('INSERT INTO client_sub (id, client, anorm, adrese, apraksts, summa, no, lidz, avots, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(x.id, id, x.adrese ? norm(x.adrese) : '', x.adrese, x.apraksts, x.summa, x.no, x.lidz, x.avots, x.ord)));
    if (fmt(was) !== fmt(L)) ligCh = ['Līgumcena', fmt(was), fmt(L)];
  }
  if (Array.isArray(c.objekti)) {
    st.push(db.prepare('DELETE FROM client_obj WHERE client = ?').bind(id));
    for (const a of c.objekti.slice(0, 2000)) st.push(db.prepare('INSERT OR REPLACE INTO client_obj (anorm, client) VALUES (?, ?)').bind(norm(a), id));   // objekts — vienam klientam
  }
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  if (who) { const now = Object.assign({}, c, lg, { name, cenas: cen }), n = Array.isArray(c.objekti) ? c.objekti.length : prevN;
    await audit(db, who, 'Klienti', name, (prev ? diff(clFlat(prev, prevN), clFlat(now, n), Object.keys(clFlat(now, n))) : [['izveidots', '', name]]).concat(ligCh ? [ligCh] : [])); }
  return id;
}
export async function delClient(db, id, who) {
  const c = await db.prepare('SELECT name FROM clients WHERE id = ?').bind(id).first();
  await db.batch([db.prepare('DELETE FROM client_obj WHERE client = ?').bind(id), db.prepare('DELETE FROM clients WHERE id = ?').bind(id)]);   // client_sub paliek (vēsture)
  if (who && c) await audit(db, who, 'Klienti', c.name, ['dzēsts', c.name, '']);
}

/* Mēneša izpilde klientam (vai visiem): rindas pa darbiem + kopsavilkums pa lietotnēm */
export async function report(db, clientId, ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis');
  const c = clientId ? await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first() : null;
  if (clientId && !c) throw new Error('Klients nav atrasts');
  const cen = c ? J(c.cenas) : {}, PH = c ? await priceHist(db, c.id) : {};
  const anorms = c ? new Set((await all(db, 'SELECT anorm FROM client_obj WHERE client = ?', clientId)).map(r => r.anorm)) : null;
  // Kuram klientam pieder darbs: ja rindas anorm ir zināms objekts — tikai pēc tā. Brīvā teksta adreses (izvešana, kaisāmmateriāls,
  // «KK Ģertrūdes 10, Rīga») — pēc akey, bet tikai ja VISI objekti ar šo akey ir šī klienta (citādi neskaidrs → nepiesaista).
  // Apvienotā objekta māja («… / Prūšu 4b») — tikai ja tāda atsevišķa objekta nav.
  let inC = () => true;
  if (anorms) {
    const objs = await all(db, 'SELECT anorm, adrese FROM objects'), known = new Set(objs.map(o => o.anorm)), byK = {}, parts = new Set();
    objs.forEach(o => { const k = akey(o.adrese); if (k) (byK[k] = byK[k] || []).push(o.anorm); });
    objs.filter(o => anorms.has(o.anorm)).forEach(o => splitAddr(o.adrese).forEach(x => { const k = akey(x.adrese); if (k) parts.add(k); }));
    inC = (a, adr) => {
      if (anorms.has(a)) return true;
      if (a && known.has(a)) return false;
      const k = akey(adr); if (!k) return false;
      const o = byK[k]; return o ? o.every(x => anorms.has(x)) : parts.has(k);
    };
  }
  // E3: izpildīts apmeklējums ar neatrisinātu pretenziju aktā/rēķinā neiet — tiek parādīts atsevišķi «Gaida pretenzijas atrisināšanu»
  const CL = {}; (await all(db, "SELECT app, visit, teksts FROM claim WHERE statuss = 'atverta'").catch(() => [])).forEach(x => CL[x.app + ':' + x.visit] = x.teksts);
  const aizturets = [], held = (app, v) => { const t = CL[app + ':' + v.id]; if (t == null) return false; aizturets.push({ app, datums: v.datums, adrese: v.adrese, teksts: t }); return true; };
  const rows = [], d0 = ym + '-01', d1 = ym + '-31', dEnd = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).toISOString().slice(0, 10);
  // Aizvietošana — izpildītie darbi
  for (const j of await all(db, "SELECT id, datums, adrese, anorm, tips, brigade, foto, komentars FROM jobs WHERE statuss = 'izpildīts' AND datums >= ? AND datums <= ?", d0, d1))
    if (inC(j.anorm || norm(j.adrese), j.adrese)) rows.push({ vid: j.id, pub: j.tips, app: 'aizv', datums: j.datums, adrese: j.adrese, daudz: 1, kas: j.brigade, piez: j.tips + (j.komentars ? ' — ' + j.komentars : ''), foto: j.foto });
  // Zāles pļaušana — m²
  for (const v of await all(db, "SELECT v.id, v.datums, v.adrese, v.anorm, v.izpilditajs, v.foto, v.piezime, p.m2 FROM pl_visit v LEFT JOIN pl_obj p ON p.anorm = v.anorm WHERE v.statuss = 'done' AND v.datums >= ? AND v.datums <= ?", d0, d1))
    if (inC(v.anorm, v.adrese) && !held('pl', v)) rows.push({ vid: v.id, pub: '', app: 'pl', datums: v.datums, adrese: v.adrese, daudz: +v.m2 || 0, kas: v.izpilditajs, piez: v.piezime, foto: v.foto });
  // Logi — nomazgātie logi
  for (const v of await all(db, "SELECT v.id, v.datums, v.adrese, v.anorm, v.izpilditajs, v.foto, v.foto_pirms, v.piezime, v.izpilde, s.qty FROM logi_visit v LEFT JOIN logi_obj s ON s.anorm = v.anorm WHERE v.statuss = 'done' AND v.datums >= ? AND v.datums <= ?", d0, d1))
    if (inC(v.anorm, v.adrese) && !held('logi', v)) { const iz = J(v.izpilde); rows.push({ vid: v.id, pub: [iz.kapnutelpas ? iz.kapnutelpas + ' kāpņu telpas' : '', iz.stundas ? iz.stundas + ' h' : ''].filter(Boolean).join(', '), app: 'logi', datums: v.datums, adrese: v.adrese, daudz: +iz.nomazgati || +v.qty || 0, kas: [v.izpilditajs, iz.kas].filter(Boolean).join(' · '), piez: [iz.kapnutelpas ? iz.kapnutelpas + ' kāpņu telpas' : '', iz.stundas ? iz.stundas + ' h' : '', iz.bojajumi ? 'bojājumi: ' + iz.bojajumi : ''].filter(Boolean).join(', '), foto: [v.foto_pirms, v.foto].filter(Boolean).join(',') }); }
  // Dārzniecība — cilvēkstundas
  for (const v of await all(db, "SELECT id, datums, adrese, anorm, izpilditajs, foto, foto_pirms, izpilde FROM darz_visit WHERE statuss = 'done' AND datums >= ? AND datums <= ?", d0, d1))
    if (inC(v.anorm, v.adrese) && !held('darz', v)) { const iz = J(v.izpilde); rows.push({ vid: v.id, app: 'darz', datums: v.datums, adrese: v.adrese, daudz: r2((+iz.cilveki || 1) * (+iz.stundas || 0)), kas: v.izpilditajs, piez: [(iz.darbi || []).join(', '), (iz.materiali || []).map(m => m.n + ' ' + m.d + ' ' + m.mv).join(', ')].filter(Boolean).join(' · '), foto: [v.foto_pirms, v.foto].filter(Boolean).join(',') }); }
  // Stāvvietas — m²
  for (const v of await all(db, "SELECT v.id, v.datums, v.adrese, v.anorm, v.izpilditajs, v.foto, v.foto_pirms, v.izpilde, s.qty FROM stav_visit v LEFT JOIN stav_obj s ON s.anorm = v.anorm WHERE v.statuss = 'done' AND v.datums >= ? AND v.datums <= ?", d0, d1))
    if (inC(v.anorm, v.adrese) && !held('stav', v)) { const iz = J(v.izpilde); rows.push({ vid: v.id, app: 'stav', datums: v.datums, adrese: v.adrese, daudz: +v.qty || 0, kas: v.izpilditajs, piez: [(iz.limeni || []).length ? 'līmeņi ' + iz.limeni.join(', ') : '', iz.notekas && iz.notekas !== 'Kārtībā' ? 'notekas: ' + iz.notekas : ''].filter(Boolean).join(', '), foto: [v.foto_pirms, v.foto].filter(Boolean).join(',') }); }
  // Sniegs — stundas
  for (const v of await all(db, "SELECT id, datums, adrese, anorm, izpilditajs, brigade, sakums, laiks, foto, izpilde FROM sniegs_visit WHERE statuss = 'done' AND datums >= ? AND datums <= ?", d0, d1))
    if (inC(v.anorm, v.adrese) && !held('sniegs', v)) { const iz = J(v.izpilde); rows.push({ vid: v.id, app: 'sniegs', datums: v.datums, adrese: v.adrese, daudz: r2(mins(v.sakums, v.laiks) / 60), kas: v.brigade || v.izpilditajs, piez: [iz.tehnika, iz.kaisits && iz.kaisits !== 'Nav' ? iz.kaisits + ' ' + (iz.kg || 0) + ' kg' : '', iz.kravas ? iz.kravas + ' kravas' : ''].filter(Boolean).join(', '), foto: v.foto }); }
  // Izvešana — izvestie m³ (pēc izpildes datuma)
  for (const t of await all(db, "SELECT adrese, m3, sia, izpildits, izv_kom, maisi, foto_pec, koef FROM izv_task WHERE statuss = 'Izpildīts'")) {
    const d = dmyIso(t.izpildits); if (!d || d < d0 || d > d1) continue;
    if (inC(norm(t.adrese), t.adrese)) rows.push({ pub: t.maisi || '', app: 'izv', datums: d, adrese: t.adrese, daudz: r2(num(t.m3)), kas: t.sia, piez: [t.maisi, t.izv_kom].filter(Boolean).join(' · '), foto: fid(t.foto_pec), koef: t.koef || '' });
  }
  // Kaisāmmateriāls — piegādātie maisi
  for (const t of await all(db, "SELECT adrese, materials, piegadati, kurjers, piegadats, kurj_kom, foto_pec FROM kais_task WHERE statuss = 'Piegādāts'")) {
    const d = dmyIso(t.piegadats); if (!d || d < d0 || d > d1) continue;
    if (inC(norm(t.adrese), t.adrese)) rows.push({ pub: t.materials || '', app: 'kais', datums: d, adrese: t.adrese, daudz: num(t.piegadati), kas: t.kurjers, piez: [t.materials, t.kurj_kom].filter(Boolean).join(' · '), foto: fid(t.foto_pec) });
  }
  rows.forEach(r => { if (r.pub == null) r.pub = r.piez || ''; });   // darz/stav/sniegs piezīme ir tikai strukturēti dati
  rows.sort((a, b) => a.datums.localeCompare(b.datums) || a.adrese.localeCompare(b.adrese));
  rows.forEach(r => { r.cena = priceAt(PH, cen, r.app, r.datums); r.summa = r.cena ? r2(r.daudz * r.cena) : 0; });
  // Fiksētā līgumcena: rindas, kas spēkā šajā mēnesī (pilns mēnesis) — pēc darbiem, katra sava rinda kopsavilkumā
  if (c) for (const x of await all(db, "SELECT * FROM client_sub WHERE client = ? AND summa > 0 AND (no = '' OR no <= ?) AND (lidz = '' OR lidz >= ?) ORDER BY ord, no", c.id, dEnd, d0))
    rows.push({ app: 'ligums', sid: x.id, datums: x.no > d0 ? x.no : d0, adrese: x.adrese || 'Visi objekti', daudz: 1, cena: r2(x.summa), summa: r2(x.summa), kas: '', piez: x.apraksts, pub: x.apraksts, foto: '' });
  const sum = {}; rows.forEach(r => { const k = r.app === 'ligums' ? 'ligums:' + r.sid : r.app + '|' + r.cena, u = ALL_UNITS[r.app];   // cena mainījusies mēneša vidū — divas rindas
    const s = sum[k] = sum[k] || { app: r.app, name: r.app === 'ligums' ? LIG.name + (r.pub ? ': ' + r.pub : '') + (r.adrese !== 'Visi objekti' ? ' · ' + r.adrese : '') : u.name, unit: u.unit, reizes: 0, daudz: 0, cena: r.cena, summa: 0 };
    s.reizes++; s.daudz = r2(s.daudz + r.daudz); s.summa = r2(s.summa + r.summa); });
  const total = r2(Object.values(sum).reduce((a, s) => a + s.summa, 0));
  { const CK = {}; (await all(db, 'SELECT app, visit, punkti FROM chk WHERE laiks >= ?', d0).catch(() => [])).forEach(x => { try { CK[x.app + ':' + x.visit] = JSON.parse(x.punkti); } catch (e) {} });   // G1 kontrolsaraksts aktā
    rows.forEach(r => { const L = r.vid && CK[r.app + ':' + r.vid]; if (L && L.length) r.piez = [r.piez, '✓ kontrolsaraksts ' + L.filter(p => p.ok).length + '/' + L.length].filter(Boolean).join(' · '); delete r.vid; }); }
  return { aizturets, client: c ? Object.assign({}, c, { cenas: cen }) : null, ym, rows, sum: Object.values(sum), total, pvn: r2(total * 0.21), arPvn: r2(total * 1.21) };
}

/* ---------- Līguma PDF (R2 FOTO, atslēga ct-…): augšupielāde base64, kā Mājas lietas dokumentiem ---------- */
const CT_TYPES = { 'application/pdf': 1, 'image/jpeg': 1, 'image/png': 1 };
export async function ctUpload(env, clientId, name, data, who) {
  const c = await env.DB.prepare('SELECT name, lig_pdf_nos FROM clients WHERE id = ?').bind(clientId).first(); if (!c) throw new Error('Vispirms saglabājiet klientu');
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(String(data || '')); if (!m) throw new Error('Nederīgs fails');
  const ct = m[1].toLowerCase(); if (!CT_TYPES[ct]) throw new Error('Var pievienot PDF vai bildi');
  if (m[2].length * 0.75 > 10e6 + 4) throw new Error('Fails par lielu (līdz 10 MB)');
  if (!env.FOTO) throw new Error('Failu glabātuve nav pieslēgta');
  const bs = atob(m[2]), bin = new Uint8Array(bs.length); for (let i = 0; i < bs.length; i++) bin[i] = bs.charCodeAt(i);
  const key = 'ct-' + crypto.randomUUID().replace(/-/g, ''), nos = String(name || 'ligums.pdf').slice(0, 150);
  await env.FOTO.put(key, bin, { httpMetadata: { contentType: ct }, customMetadata: { app: 'klienti', client: clientId, name: nos } });   // vecais fails R2 paliek
  await env.DB.prepare('UPDATE clients SET lig_pdf = ?, lig_pdf_nos = ? WHERE id = ?').bind(key, nos, clientId).run();
  if (who) await audit(env.DB, who, 'Klienti', c.name, ['Līguma fails', c.lig_pdf_nos || '', nos]);
  return { key, nos };
}
export async function ctGet(env, clientId, cors) {
  const c = await env.DB.prepare('SELECT lig_pdf, lig_pdf_nos FROM clients WHERE id = ?').bind(clientId).first();
  const o = c && c.lig_pdf && env.FOTO && await env.FOTO.get(c.lig_pdf); if (!o) throw new Error('Līguma fails nav atrasts');
  return new Response(o.body, { headers: Object.assign({ 'Content-Type': (o.httpMetadata && o.httpMetadata.contentType) || 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(c.lig_pdf_nos || 'ligums.pdf') }, cors || {}) });
}

/* ---------- Rēķini: mūsu rekvizīti un numerācija (kv) ---------- */
const FIRMA = ['nosaukums', 'regnr', 'pvnnr', 'adrese', 'banka', 'iban', 'swift', 'epasts', 'talrunis', 'apmaksa_dienas', 'prefikss'];
export async function firma(db) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = 'firma'").first(); const o = J(r && r.v);
  const D = { nosaukums: 'SIA SELECTUM HOME', apmaksa_dienas: '14', prefikss: 'SH' }; Object.keys(o).forEach(k => { if (o[k]) D[k] = o[k]; }); return D;
}
export async function saveFirma(db, b, who) {
  const o = {}; FIRMA.forEach(k => o[k] = String((b || {})[k] || '').trim().slice(0, 200));
  if (who) { const r = await db.prepare("SELECT v FROM kv WHERE k = 'firma'").first(); await audit(db, who, 'Rekvizīti', 'Mūsu rekvizīti', diff(J(r && r.v), o, FIRMA)); }
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('firma', ?)").bind(JSON.stringify(o)).run(); return firma(db);
}
/** Rēķina numurs klientam un mēnesim: viens un tas pats, ja izrakstīts atkārtoti; jauns — nākamais gada secībā (SH-2026-001) */
export async function invoiceNo(db, clientId, ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis');
  const key = 'inv:' + (clientId || 'visi') + ':' + ym, have = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  if (have) return JSON.parse(have.v);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }).format(new Date()), y = today.slice(0, 4), sk = 'inv:seq:' + y;   // izrakstīšanas gads (Rīgas laiks)
  const F = await firma(db);
  const r = await db.prepare("INSERT INTO kv (k, v) VALUES (?, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1 RETURNING v").bind(sk).first();   // atomiski — divi vienlaicīgi rēķini nesaņem vienu numuru
  const n = +((r && r.v) || 1);
  const out = { nr: (F.prefikss || 'SH') + '-' + y + '-' + String(n).padStart(3, '0'), datums: today };
  await db.prepare('INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)').bind(key, JSON.stringify(out)).run();
  const fin = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();   // ja paralēli jau izrakstīts — tas pats numurs
  return fin ? JSON.parse(fin.v) : out;
}

/* ---------- Rēķinu reģistrs (D1): izrakstīšana ar kopiju, statuss, apmaksa, kavētie ---------- */
const nowRiga = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }).format(new Date());
const addD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const INV_ST = ['izrakstīts', 'daļēji', 'apmaksāts', 'anulēts'];
/** Izraksta (vai atdod jau izrakstīto) rēķinu: numurs + nemainīga kopija */
export async function invoiceIssue(db, clientId, ym, who) {
  if (!clientId) throw new Error('Rēķinu izraksta konkrētam klientam');
  const ex = await db.prepare('SELECT * FROM invoice WHERE client = ? AND ym = ?').bind(clientId, ym).first();
  if (ex) return invRow(ex);
  const R = await report(db, clientId, ym), N = await invoiceNo(db, clientId, ym), F = await firma(db);
  const termins = addD(N.datums, Math.max(0, +F.apmaksa_dienas || 14));
  const dati = JSON.stringify({ client: R.client, sum: R.sum, rows: R.rows.map(r => ({ app: r.app, datums: r.datums, adrese: r.adrese, daudz: r.daudz, cena: r.cena, summa: r.summa, piez: r.pub || '' })) });
  await db.prepare('INSERT OR IGNORE INTO invoice (nr, client, klients, ym, datums, termins, summa, pvn, ar_pvn, dati, izveidots, kas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(N.nr, clientId, (R.client && R.client.name) || '', ym, N.datums, termins, R.total, R.pvn, R.arPvn, dati, nowRiga(), String(who || '')).run();
  return invRow(await db.prepare('SELECT * FROM invoice WHERE client = ? AND ym = ?').bind(clientId, ym).first());
}
function invRow(r) {
  if (!r) return null; const t = nowRiga(), o = Object.assign({}, r); try { o.dati = JSON.parse(r.dati || '{}'); } catch (e) { o.dati = {}; }
  o.kave = (r.statuss === 'izrakstīts' || r.statuss === 'daļēji') && r.termins && r.termins < t ? Math.round((Date.parse(t) - Date.parse(r.termins)) / 864e5) : 0;
  o.atlikums = r.statuss === 'apmaksāts' || r.statuss === 'anulēts' ? 0 : Math.round((r.ar_pvn - (r.apm_summa || 0)) * 100) / 100;
  return o;
}
export async function invoices(db, f) {
  const L = ((await db.prepare('SELECT * FROM invoice ORDER BY datums DESC, nr DESC LIMIT 500').all()).results || []).map(invRow).map(o => { o.regnr = ((o.dati || {}).client || {}).regnr || ''; delete o.dati; return o; });
  const R = f && f.st ? L.filter(o => f.st === 'kave' ? o.kave > 0 : o.statuss === f.st) : L;
  const sum = (a) => Math.round(a.reduce((s, o) => s + o.atlikums, 0) * 100) / 100;
  return { list: R, kopa: { neapmaksats: sum(L.filter(o => o.atlikums > 0)), kave: sum(L.filter(o => o.kave > 0)), kaveN: L.filter(o => o.kave > 0).length } };
}
export async function invoiceSet(db, b, who) {
  const r = await db.prepare('SELECT * FROM invoice WHERE nr = ?').bind(String(b.nr || '')).first(); if (!r) throw new Error('Rēķins nav atrasts');
  const after = async () => { if (!who) return; const n = await db.prepare('SELECT * FROM invoice WHERE nr = ?').bind(r.nr).first(); await audit(db, who, 'Rēķini', r.nr + ' · ' + r.klients, diff(r, n, ['statuss', 'apmaksats', 'apm_summa', 'piezime'])); };
  const st = INV_ST.indexOf(b.statuss) !== -1 ? b.statuss : r.statuss, d = /^\d{4}-\d{2}-\d{2}$/.test(b.apmaksats || '') ? b.apmaksats : (st === 'apmaksāts' && !r.apmaksats ? nowRiga() : r.apmaksats);
  const s = st === 'apmaksāts' ? r.ar_pvn : st === 'daļēji' ? Math.max(0, Math.min(r.ar_pvn, +b.apm_summa || r.apm_summa || 0)) : st === 'anulēts' ? 0 : r.apm_summa;
  await db.prepare('UPDATE invoice SET statuss = ?, apmaksats = ?, apm_summa = ?, piezime = ? WHERE nr = ?').bind(st, d || '', s, String(b.piezime != null ? b.piezime : r.piezime).slice(0, 300), r.nr).run();
  await after();
  return invRow(await db.prepare('SELECT * FROM invoice WHERE nr = ?').bind(r.nr).first());
}

/* ---------- Eksports grāmatvedības programmai (Horizon u.c.): formātu iestata grāmatvedība pati (kv inv:exp) ----------
 * cfg = { cols: [{ h: virsraksts, f: lauks | 'const', c: konstante }], fmt: 'xlsx'|'csv', sep, dec, date, level: 'rinda'|'rekins',
 *         lapa, anul, kodi: { app: kods }, konti: { app: konts }, kk: { clientId: partnera kods } }. Failu veido pārlūks. */
export const EXP_FIELDS = ['nr', 'datums', 'termins', 'periods', 'periods_no', 'periods_lidz', 'pamatojums', 'valuta', 'pvn_likme', 'summa', 'pvn', 'ar_pvn', 'statuss',
  'klients', 'klienta_kods', 'regnr', 'adrese', 'epasts', 'liguma_nr', 'rinda_nr', 'pak_kods', 'pak_nos', 'konts', 'daudz', 'mervien', 'cena', 'reizes', 'r_summa', 'r_pvn', 'r_ar_pvn',
  'musu_nos', 'musu_regnr', 'musu_pvnnr', 'musu_iban', 'const', ''];
const sTxt = (v, n) => String(v == null ? '' : v).slice(0, n || 120);
const sMap = (o, n) => { const r = {}; Object.keys(o && typeof o === 'object' ? o : {}).slice(0, 500).forEach(k => { const v = sTxt(o[k], n || 60).trim(); if (v) r[sTxt(k, 60)] = v; }); return r; };
export async function expCfg(db) { const r = await db.prepare("SELECT v FROM kv WHERE k = 'inv:exp'").first(); return J(r && r.v); }
export async function expCfgSave(db, b, who) {
  b = b || {};
  const cols = (Array.isArray(b.cols) ? b.cols : []).slice(0, 80).map(c => ({ h: sTxt(c && c.h, 80), f: EXP_FIELDS.indexOf(c && c.f) !== -1 ? c.f : '', c: sTxt(c && c.c, 120) }));
  const o = { cols, fmt: b.fmt === 'csv' ? 'csv' : 'xlsx', sep: [';', ',', 'tab'].indexOf(b.sep) !== -1 ? b.sep : ';', dec: b.dec === '.' ? '.' : ',',
    date: ['dd.mm.yyyy', 'yyyy-mm-dd', 'dd/mm/yyyy', 'excel'].indexOf(b.date) !== -1 ? b.date : 'dd.mm.yyyy', level: b.level === 'rekins' ? 'rekins' : 'rinda',
    head: b.head === false ? false : true, lapa: sTxt(b.lapa, 31), anul: !!b.anul, kodi: sMap(b.kodi), konti: sMap(b.konti), kk: sMap(b.kk) };
  if (who) await audit(db, who, 'Rēķini', 'Eksporta formāts grāmatvedībai', [['kolonnas', '', String(cols.length) + ' · ' + o.fmt]]);
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('inv:exp', ?)").bind(JSON.stringify(o)).run(); return o;
}
/** Rēķini eksportam: periods no–līdz (izrakstīšanas datums) vai mēnesis (par kuru), ar rindām un klienta rekvizītiem */
export async function expData(db, f) {
  f = f || {}; const ym = /^\d{4}-\d{2}$/.test(f.ym || '') ? f.ym : '', no = isoD(f.no), lidz = isoD(f.lidz);
  if (!ym && !(no && lidz)) throw new Error('Norādiet mēnesi vai periodu');
  const L = ym ? await all(db, 'SELECT * FROM invoice WHERE ym = ? ORDER BY nr', ym) : await all(db, 'SELECT * FROM invoice WHERE datums >= ? AND datums <= ? ORDER BY nr', no, lidz);
  const C = {}; for (const c of await all(db, 'SELECT id, name, regnr, adrese, epasts, liguma_nr FROM clients')) C[c.id] = c;
  const list = L.map(r => { const o = invRow(r), d = o.dati || {}, cl = Object.assign({}, d.client || {}, C[r.client] || {});
    return { nr: o.nr, client: o.client, klients: o.klients, ym: o.ym, datums: o.datums, termins: o.termins, summa: o.summa, pvn: o.pvn, ar_pvn: o.ar_pvn, statuss: o.statuss,
      cl: { name: cl.name || o.klients, regnr: cl.regnr || '', adrese: cl.adrese || '', epasts: cl.epasts || '', liguma_nr: cl.liguma_nr || '' },
      sum: (d.sum || []).filter(x => x.summa).map(x => ({ app: x.app, name: x.name, unit: x.unit, reizes: x.reizes, daudz: x.daudz, cena: x.cena, summa: x.summa })) }; });
  return { list, cfg: await expCfg(db), firma: await firma(db) };
}
