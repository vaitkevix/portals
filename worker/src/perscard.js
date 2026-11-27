/* SH | Personāls: darbinieka kartīte (D7) — dokumenti R2 «pd-…» ar derīgumu, kontrolsaraksts pieņemot/atlaižot;
 * GDPR (D10) — personas datu eksports (JSON) un anonimizēšana (personas kods, IBAN, adrese → «***», rindas paliek). © VAITKEVIX, SIA */
import { audit } from './audit.js';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const vk = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const isoD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
const nowS = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(',', '');
export const DOC_TIPI = ['Darba līgums', 'Pase / ID karte', 'Uzturēšanās atļauja', 'Veselības pārbaude', 'Apliecība / sertifikāts', 'Instruktāžas žurnāls', 'Cits'];
export const CHECK = {
  pien: [['atslegas', 'Atslēgas izsniegtas'], ['apgerbs', 'Darba apģērbs izsniegts'], ['instr', 'Darba aizsardzības instruktāža'], ['parbaude', 'Pārbaudes laika beigas']],
  atl: [['atslegas', 'Atslēgas atdotas'], ['apgerbs', 'Darba apģērbs atdots'], ['norekins', 'Gala norēķins'], ['dl', 'Izslēgts no Darba laika']],
};
const DOC_CT = { 'application/pdf': 1, 'image/jpeg': 1, 'image/png': 1, 'image/heic': 1, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 1, 'application/msword': 1 };
const canEdit = (u) => u.role === 'admin' && !u.viewer;
const isAdm = (u) => u.role === 'admin' && !u.viewer && u.label === 'Administrators';   // GDPR — tikai Personāla administrators

/** Kartītes dati (pievienojas `employee` atbildei) */
export async function card(db, vards) {
  const k = vk(vards);
  const docs = await all(db, 'SELECT id, tips, nosaukums, derigs, izmers, pievienoja, laiks FROM pers_doc WHERE vkey = ? AND dzests = 0 ORDER BY laiks DESC', k).catch(() => []);
  const ch = await all(db, 'SELECT posms, punkts, izdarits, datums, kas, laiks FROM pers_check WHERE vkey = ?', k).catch(() => []);
  const check = {}; Object.keys(CHECK).forEach(p => check[p] = CHECK[p].map(([id, n]) => { const r = ch.find(x => x.posms === p && x.punkts === id) || {}; return { id, n, izdarits: !!r.izdarits, datums: r.datums || '', kas: r.kas || '', laiks: r.laiks || '' }; }));
  return { docs, check, docTipi: DOC_TIPI };
}
export async function checkSet(db, user, b) {
  if (!canEdit(user)) throw new Error('Mainīt var tikai administrators');
  const p = CHECK[b.posms] ? b.posms : '', it = p && CHECK[p].find(x => x[0] === b.punkts); if (!it) throw new Error('Nezināms punkts');
  const v = str(b.vards, 120); if (!v) throw new Error('Nav darbinieka');
  const old = await db.prepare('SELECT izdarits, datums FROM pers_check WHERE vkey = ? AND posms = ? AND punkts = ?').bind(vk(v), p, it[0]).first();
  const d = isoD(b.datums), on = b.izdarits ? 1 : 0;
  await db.prepare('INSERT OR REPLACE INTO pers_check (vkey, posms, punkts, vards, izdarits, datums, kas, laiks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(vk(v), p, it[0], v, on, d, user.name, nowS()).run();
  await audit(db, user.name, 'Personāls', v, [it[1], old ? (old.izdarits ? 'jā' : 'nē') + (old.datums ? ' ' + old.datums : '') : '', (on ? 'jā' : 'nē') + (d ? ' ' + d : '')]);
  return card(db, v);
}
export async function docUpload(env, user, b) {
  if (!canEdit(user)) throw new Error('Pievienot var tikai administrators');
  const v = str(b.vards, 120); if (!v) throw new Error('Nav darbinieka');
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(String(b.data || '')); if (!m) throw new Error('Nederīgs fails');
  const ct = m[1].toLowerCase(); if (!DOC_CT[ct]) throw new Error('Var pievienot PDF, bildes vai Word failus');
  if (m[2].length * 0.75 > 10e6 + 4) throw new Error('Fails par lielu (līdz 10 MB)');
  if (!env.FOTO) throw new Error('Failu glabātuve nav pieslēgta');
  const s = atob(m[2]), bin = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i);
  const id = 'pd-' + crypto.randomUUID().replace(/-/g, ''), tips = DOC_TIPI.indexOf(b.tips) !== -1 ? b.tips : 'Cits', nos = str(b.name, 150) || 'Dokuments';
  await env.FOTO.put(id, bin, { httpMetadata: { contentType: ct }, customMetadata: { app: 'pers', name: nos } });
  await env.DB.prepare('INSERT INTO pers_doc (id, vkey, vards, tips, nosaukums, derigs, r2, ct, izmers, pievienoja, laiks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, vk(v), v, tips, nos, isoD(b.derigs), id, ct, bin.length, user.name, nowS()).run();
  await audit(env.DB, user.name, 'Personāls', v, ['Dokuments', '', tips + ' · ' + nos + (isoD(b.derigs) ? ' · derīgs līdz ' + b.derigs : '')]);
  return card(env.DB, v);
}
export async function docSet(db, user, b) {   // derīguma maiņa vai noņemšana (paslēpj; fails R2 paliek)
  if (!canEdit(user)) throw new Error('Mainīt var tikai administrators');
  const d = await db.prepare('SELECT * FROM pers_doc WHERE id = ?').bind(str(b.id, 60)).first(); if (!d) throw new Error('Dokuments nav atrasts');
  if (b.del) { await db.prepare('UPDATE pers_doc SET dzests = 1 WHERE id = ?').bind(d.id).run(); await audit(db, user.name, 'Personāls', d.vards, ['Dokuments noņemts', d.tips + ' · ' + d.nosaukums, '']); }
  else { const n = isoD(b.derigs); await db.prepare('UPDATE pers_doc SET derigs = ? WHERE id = ?').bind(n, d.id).run(); await audit(db, user.name, 'Personāls', d.vards, ['Derīgs līdz · ' + d.nosaukums, d.derigs, n]); }
  return card(db, d.vards);
}
export async function docGet(env, user, id) {
  if (user.role !== 'admin') throw new Error('Dokumentus atvērt var administrators');
  const d = await env.DB.prepare('SELECT * FROM pers_doc WHERE id = ? AND dzests = 0').bind(str(id, 60)).first(); if (!d || !env.FOTO) throw new Error('Dokuments nav atrasts');
  const o = await env.FOTO.get(d.r2); if (!o) throw new Error('Dokuments nav atrasts');
  const u8 = new Uint8Array(await o.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { name: d.nosaukums, data: 'data:' + (d.ct || 'application/octet-stream') + ';base64,' + btoa(s) };
}

/* ---------- GDPR (D10) ---------- */
async function rowsFor(db, vards, pk) {
  const k = vk(vards), p = String(pk || '').replace(/\D/g, '');
  const hire = (await all(db, 'SELECT * FROM pers_hire')).filter(r => vk(r.vards) === k || (p.length >= 6 && String(r.pk).replace(/\D/g, '') === p));
  const names = new Set([k].concat(hire.map(r => vk(r.vards))));
  const by = (L, f) => L.filter(r => names.has(vk(r[f])));
  const vac = by(await all(db, 'SELECT * FROM pers_vac'), 'darbinieks'), chg = by(await all(db, 'SELECT * FROM pers_chg'), 'darbinieks'), bonus = by(await all(db, 'SELECT * FROM pers_bonus'), 'darbinieks');
  const tel = new Set(hire.concat(chg).map(r => String(r.tel || '').replace(/\D/g, '').slice(-8)).filter(x => x.length === 8));
  const dl = (await all(db, 'SELECT * FROM dl_worker').catch(() => [])).filter(w => names.has(vk(w.vards)) || tel.has(String(w.phone || '').replace(/\D/g, '').slice(-8)));
  const docs = (await all(db, 'SELECT id, vards, tips, nosaukums, derigs, pievienoja, laiks, dzests FROM pers_doc').catch(() => [])).filter(r => names.has(r.vkey || vk(r.vards)));
  const check = (await all(db, 'SELECT * FROM pers_check').catch(() => [])).filter(r => names.has(r.vkey));
  return { hire, vac, chg, bonus, dl, docs, check };
}
export async function gdprExport(db, user, b) {
  if (!isAdm(user)) throw new Error('Tikai Personāla administratoram');
  const v = str(b.vards, 120); if (!v) throw new Error('Nav darbinieka');
  const R = await rowsFor(db, v, b.pk), n = Object.values(R).reduce((s, L) => s + L.length, 0);
  await audit(db, user.name, 'Personāls', v, ['GDPR eksports', '', n + ' ieraksti']);
  return { export: { darbinieks: v, sagatavots: nowS(), sagatavoja: user.name, sistēma: 'SELECTUM HOME · SH Personāls', pieņemšana: R.hire, atvaļinājumi: R.vac, grozījumi: R.chg, piemaksas: R.bonus, darba_laiks: R.dl, dokumenti: R.docs, kontrolsaraksts: R.check }, n };
}
export async function gdprAnon(db, user, b) {
  if (!isAdm(user)) throw new Error('Tikai Personāla administratoram');
  const v = str(b.vards, 120); if (!v) throw new Error('Nav darbinieka');
  if (String(b.apstiprinu || '').trim().toLowerCase() !== vk(v)) throw new Error('Apstiprinājumam ierakstiet darbinieka vārdu');
  const R = await rowsFor(db, v), st = [], X = '***';
  R.hire.forEach(r => st.push(db.prepare('UPDATE pers_hire SET pk = ?, iban = ?, adrese = ? WHERE id = ?').bind(r.pk ? X : '', r.iban ? X : '', r.adrese ? X : '', r.id)));
  R.chg.forEach(r => st.push(db.prepare('UPDATE pers_chg SET iban = ?, adrese = ? WHERE id = ?').bind(r.iban ? X : '', r.adrese ? X : '', r.id)));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  await db.prepare("DELETE FROM kv WHERE k LIKE 'pers:%:records:%' OR k LIKE 'perst:%'").run().catch(() => {});   // vecie keši ar datiem
  await audit(db, user.name, 'Personāls', v, ['GDPR anonimizēts (personas kods, IBAN, adrese)', '', R.hire.length + R.chg.length + ' ieraksti']);
  return { n: R.hire.length + R.chg.length };
}

/** Panelim: termiņi ≤ 30 dienās — dokumentu derīgums un pārbaudes laika beigas */
export async function persTerms(db, t) {
  const add = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }, to = add(t, 30), from = add(t, -30);
  const out = [];
  (await all(db, "SELECT vards, tips, nosaukums, derigs FROM pers_doc WHERE dzests = 0 AND derigs != '' AND derigs <= ? AND derigs >= ?", to, from).catch(() => [])).forEach(r => out.push({ vards: r.vards, n: r.tips + ' derīgs līdz', datums: r.derigs }));
  (await all(db, "SELECT vards, datums FROM pers_check WHERE posms = 'pien' AND punkts = 'parbaude' AND izdarits = 0 AND datums != '' AND datums <= ? AND datums >= ?", to, from).catch(() => [])).forEach(r => out.push({ vards: r.vards, n: 'Pārbaudes laika beigas', datums: r.datums }));
  return out.sort((a, b) => a.datums.localeCompare(b.datums)).map(x => Object.assign(x, { dienas: Math.round((Date.parse(x.datums) - Date.parse(t)) / 864e5) }));
}
