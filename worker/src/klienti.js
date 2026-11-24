/* SH | Klienti un izpildes akti: klienti ar cenām par vienību katrai lietotnei, objektu piesaiste, mēneša atskaite no visām lietotnēm
 * (daudzums × cena), CSV rēķinam un izpildes akts ar bildēm. Tikai portāla administratoram. © VAITKEVIX, SIA */
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const J = (s) => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
const mins = (a, b) => { if (!/^\d\d:\d\d$/.test(a || '') || !/^\d\d:\d\d$/.test(b || '')) return 0; let m = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3)); if (m < 0) m += 1440; return m; };
const r2 = (n) => Math.round(n * 100) / 100;
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
const dmyIso = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; };
const num = (v) => parseFloat(String(v == null ? '' : v).replace(',', '.')) || 0;
async function all(db, sql, ...a) { try { return (await db.prepare(sql).bind(...a).all()).results || []; } catch (e) { return []; } }

export async function clientsData(db) {
  const clients = (await all(db, 'SELECT * FROM clients ORDER BY ord, name')).map(c => Object.assign({}, c, { cenas: J(c.cenas), aktivs: !!c.aktivs }));
  const links = await all(db, 'SELECT o.adrese, c.client FROM client_obj c JOIN objects o ON o.anorm = c.anorm');
  clients.forEach(c => c.objekti = links.filter(l => l.client === c.id).map(l => l.adrese));
  return { clients, units: UNITS };
}
const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export async function saveClient(db, c) {
  const id = c.id || uid(), name = String(c.name || '').trim().slice(0, 120); if (!name) throw new Error('Ierakstiet klienta nosaukumu');
  const cen = {}; Object.keys(UNITS).forEach(k => { const v = +String((c.cenas || {})[k] || '').replace(',', '.'); if (v > 0) cen[k] = r2(v); });
  const st = [db.prepare('INSERT INTO clients (id, name, regnr, adrese, epasts, kontakts, liguma_nr, cenas, aktivs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, regnr = excluded.regnr, adrese = excluded.adrese, epasts = excluded.epasts, kontakts = excluded.kontakts, liguma_nr = excluded.liguma_nr, cenas = excluded.cenas, aktivs = excluded.aktivs')
    .bind(id, name, String(c.regnr || '').slice(0, 30), String(c.adrese || '').slice(0, 200), String(c.epasts || '').slice(0, 120), String(c.kontakts || '').slice(0, 120), String(c.liguma_nr || '').slice(0, 60), JSON.stringify(cen), c.aktivs === false ? 0 : 1)];
  if (Array.isArray(c.objekti)) {
    st.push(db.prepare('DELETE FROM client_obj WHERE client = ?').bind(id));
    for (const a of c.objekti.slice(0, 2000)) st.push(db.prepare('INSERT OR REPLACE INTO client_obj (anorm, client) VALUES (?, ?)').bind(norm(a), id));   // objekts — vienam klientam
  }
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  return id;
}
export async function delClient(db, id) { await db.batch([db.prepare('DELETE FROM client_obj WHERE client = ?').bind(id), db.prepare('DELETE FROM clients WHERE id = ?').bind(id)]); }

/* Mēneša izpilde klientam (vai visiem): rindas pa darbiem + kopsavilkums pa lietotnēm */
export async function report(db, clientId, ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis');
  const c = clientId ? await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first() : null;
  if (clientId && !c) throw new Error('Klients nav atrasts');
  const cen = c ? J(c.cenas) : {};
  const anorms = c ? new Set((await all(db, 'SELECT anorm FROM client_obj WHERE client = ?', clientId)).map(r => r.anorm)) : null;
  const inC = (a) => !anorms || anorms.has(a);
  const rows = [], d0 = ym + '-01', d1 = ym + '-31';
  // Aizvietošana — izpildītie darbi
  for (const j of await all(db, "SELECT datums, adrese, anorm, tips, brigade, foto, komentars FROM jobs WHERE statuss = 'izpildīts' AND datums >= ? AND datums <= ?", d0, d1))
    if (inC(j.anorm || norm(j.adrese))) rows.push({ app: 'aizv', datums: j.datums, adrese: j.adrese, daudz: 1, kas: j.brigade, piez: j.tips + (j.komentars ? ' — ' + j.komentars : ''), foto: j.foto });
  // Zāles pļaušana — m²
  for (const v of await all(db, "SELECT v.datums, v.adrese, v.anorm, v.izpilditajs, v.foto, v.piezime, p.m2 FROM pl_visit v LEFT JOIN pl_obj p ON p.anorm = v.anorm WHERE v.statuss = 'done' AND v.datums >= ? AND v.datums <= ?", d0, d1))
    if (inC(v.anorm)) rows.push({ app: 'pl', datums: v.datums, adrese: v.adrese, daudz: +v.m2 || 0, kas: v.izpilditajs, piez: v.piezime, foto: v.foto });
  // Logi — nomazgātie logi
  for (const v of await all(db, "SELECT v.datums, v.adrese, v.anorm, v.izpilditajs, v.foto, v.foto_pirms, v.piezime, v.izpilde, s.qty FROM logi_visit v LEFT JOIN logi_obj s ON s.anorm = v.anorm WHERE v.statuss = 'done' AND v.datums >= ? AND v.datums <= ?", d0, d1))
    if (inC(v.anorm)) { const iz = J(v.izpilde); rows.push({ app: 'logi', datums: v.datums, adrese: v.adrese, daudz: +iz.nomazgati || +v.qty || 0, kas: [v.izpilditajs, iz.kas].filter(Boolean).join(' · '), piez: [iz.kapnutelpas ? iz.kapnutelpas + ' kāpņu telpas' : '', iz.stundas ? iz.stundas + ' h' : '', iz.bojajumi ? 'bojājumi: ' + iz.bojajumi : ''].filter(Boolean).join(', '), foto: [v.foto_pirms, v.foto].filter(Boolean).join(',') }); }
  // Dārzniecība — cilvēkstundas
  for (const v of await all(db, "SELECT datums, adrese, anorm, izpilditajs, foto, foto_pirms, izpilde FROM darz_visit WHERE statuss = 'done' AND datums >= ? AND datums <= ?", d0, d1))
    if (inC(v.anorm)) { const iz = J(v.izpilde); rows.push({ app: 'darz', datums: v.datums, adrese: v.adrese, daudz: r2((+iz.cilveki || 1) * (+iz.stundas || 0)), kas: v.izpilditajs, piez: [(iz.darbi || []).join(', '), (iz.materiali || []).map(m => m.n + ' ' + m.d + ' ' + m.mv).join(', ')].filter(Boolean).join(' · '), foto: [v.foto_pirms, v.foto].filter(Boolean).join(',') }); }
  // Stāvvietas — m²
  for (const v of await all(db, "SELECT v.datums, v.adrese, v.anorm, v.izpilditajs, v.foto, v.foto_pirms, v.izpilde, s.qty FROM stav_visit v LEFT JOIN stav_obj s ON s.anorm = v.anorm WHERE v.statuss = 'done' AND v.datums >= ? AND v.datums <= ?", d0, d1))
    if (inC(v.anorm)) { const iz = J(v.izpilde); rows.push({ app: 'stav', datums: v.datums, adrese: v.adrese, daudz: +v.qty || 0, kas: v.izpilditajs, piez: [(iz.limeni || []).length ? 'līmeņi ' + iz.limeni.join(', ') : '', iz.notekas && iz.notekas !== 'Kārtībā' ? 'notekas: ' + iz.notekas : ''].filter(Boolean).join(', '), foto: [v.foto_pirms, v.foto].filter(Boolean).join(',') }); }
  // Sniegs — stundas
  for (const v of await all(db, "SELECT datums, adrese, anorm, izpilditajs, brigade, sakums, laiks, foto, izpilde FROM sniegs_visit WHERE statuss = 'done' AND datums >= ? AND datums <= ?", d0, d1))
    if (inC(v.anorm)) { const iz = J(v.izpilde); rows.push({ app: 'sniegs', datums: v.datums, adrese: v.adrese, daudz: r2(mins(v.sakums, v.laiks) / 60), kas: v.brigade || v.izpilditajs, piez: [iz.tehnika, iz.kaisits && iz.kaisits !== 'Nav' ? iz.kaisits + ' ' + (iz.kg || 0) + ' kg' : '', iz.kravas ? iz.kravas + ' kravas' : ''].filter(Boolean).join(', '), foto: v.foto }); }
  // Izvešana — izvestie m³ (pēc izpildes datuma)
  for (const t of await all(db, "SELECT adrese, m3, sia, izpildits, izv_kom, maisi, foto_pec FROM izv_task WHERE statuss = 'Izpildīts'")) {
    const d = dmyIso(t.izpildits); if (!d || d < d0 || d > d1) continue;
    if (inC(norm(t.adrese))) rows.push({ app: 'izv', datums: d, adrese: t.adrese, daudz: r2(num(t.m3)), kas: t.sia, piez: [t.maisi, t.izv_kom].filter(Boolean).join(' · '), foto: '' });
  }
  // Kaisāmmateriāls — piegādātie maisi
  for (const t of await all(db, "SELECT adrese, materials, piegadati, kurjers, piegadats, kurj_kom FROM kais_task WHERE statuss = 'Piegādāts'")) {
    const d = dmyIso(t.piegadats); if (!d || d < d0 || d > d1) continue;
    if (inC(norm(t.adrese))) rows.push({ app: 'kais', datums: d, adrese: t.adrese, daudz: num(t.piegadati), kas: t.kurjers, piez: [t.materials, t.kurj_kom].filter(Boolean).join(' · '), foto: '' });
  }
  rows.sort((a, b) => a.datums.localeCompare(b.datums) || a.adrese.localeCompare(b.adrese));
  rows.forEach(r => { r.cena = cen[r.app] || 0; r.summa = r.cena ? r2(r.daudz * r.cena) : 0; });
  const sum = {}; rows.forEach(r => { const s = sum[r.app] = sum[r.app] || { app: r.app, name: UNITS[r.app].name, unit: UNITS[r.app].unit, reizes: 0, daudz: 0, cena: r.cena, summa: 0 }; s.reizes++; s.daudz = r2(s.daudz + r.daudz); s.summa = r2(s.summa + r.summa); });
  const total = r2(Object.values(sum).reduce((a, s) => a + s.summa, 0));
  return { client: c ? Object.assign({}, c, { cenas: cen }) : null, ym, rows, sum: Object.values(sum), total, pvn: r2(total * 0.21), arPvn: r2(total * 1.21) };
}

/* ---------- Rēķini: mūsu rekvizīti un numerācija (kv) ---------- */
const FIRMA = ['nosaukums', 'regnr', 'pvnnr', 'adrese', 'banka', 'iban', 'swift', 'epasts', 'talrunis', 'apmaksa_dienas', 'prefikss'];
export async function firma(db) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = 'firma'").first(); const o = J(r && r.v);
  const D = { nosaukums: 'SIA SELECTUM HOME', apmaksa_dienas: '14', prefikss: 'SH' }; Object.keys(o).forEach(k => { if (o[k]) D[k] = o[k]; }); return D;
}
export async function saveFirma(db, b) {
  const o = {}; FIRMA.forEach(k => o[k] = String((b || {})[k] || '').trim().slice(0, 200));
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
