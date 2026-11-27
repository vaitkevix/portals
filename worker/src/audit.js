/* SH | Audita žurnāls (D8): kas, kad, kurā modulī, kuram objektam, kurš lauks — bija → kļuva. Tikai pievieno.
 * Noslēpumus (PIN, paroles) neraksta — tikai «mainīts». Kļūda žurnālā nekad neaptur pašu darbību. © VAITKEVIX, SIA */
const T = (v) => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const nowRiga = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(',', '');

/* Lauku nosaukumi cilvēkam saprotami */
const LAB = { name: 'Nosaukums / vārds', regnr: 'Reģ. nr.', adrese: 'Adrese', epasts: 'E-pasts', email: 'E-pasts', kontakts: 'Kontaktpersona', liguma_nr: 'Līguma nr.', aktivs: 'Aktīvs', active: 'Aktīvs',
  phone: 'Tālrunis', color: 'Krāsa', pin: 'PIN', objekti: 'Objektu skaits', nosaukums: 'Nosaukums', pvnnr: 'PVN nr.', banka: 'Banka', iban: 'IBAN', swift: 'SWIFT', talrunis: 'Tālrunis',
  apmaksa_dienas: 'Apmaksas termiņš', prefikss: 'Rēķina prefikss', statuss: 'Statuss', apmaksats: 'Apmaksāts', apm_summa: 'Samaksāts €', piezime: 'Piezīme',
  lig_no: 'Līgums noslēgts', lig_lidz: 'Līgums beidzas', lig_auto: 'Auto pagarināšana', lig_uzt: 'Uzteikuma termiņš (d.)' };
/** Izmaiņas starp a un b laukos F: [[lauks, bija, kļuva]…]; S = lauki, kuru vērtību neraksta (tikai «mainīts») */
export function diff(a, b, F, S) {
  const out = []; a = a || {}; b = b || {};
  for (const f of F) { const x = T(a[f]), y = T(b[f]); if (x === y) continue; const l = LAB[f] || f; out.push(S && S.indexOf(f) !== -1 ? [l, x ? '***' : '', 'mainīts'] : [l, x, y]); }
  return out;
}
/** Ieraksta izmaiņas; ch = [[lauks, bija, kļuva]…] vai viena rinda [lauks, bija, kļuva] */
export async function audit(db, kas, modulis, objekts, ch) {
  try {
    if (!ch || !ch.length) return; if (!Array.isArray(ch[0])) ch = [ch];
    const t = nowRiga(), st = ch.slice(0, 200).map(([l, b, k]) => db.prepare('INSERT INTO audit (laiks, kas, modulis, objekts, lauks, bija, kluva) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(t, T(kas).slice(0, 80), T(modulis).slice(0, 40), T(objekts).slice(0, 160), T(l).slice(0, 80), T(b).slice(0, 500), T(k).slice(0, 500)));
    for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  } catch (e) { /* žurnāls nedrīkst apturēt darbību */ }
}
/** Admina skats: filtrs pēc moduļa / personas / teksta */
export async function auditList(db, f) {
  f = f || {}; const w = [], a = [];
  if (f.modulis) { w.push('modulis = ?'); a.push(String(f.modulis)); }
  if (f.kas) { w.push('kas = ?'); a.push(String(f.kas)); }
  if (f.q) { w.push('(objekts LIKE ? OR lauks LIKE ? OR bija LIKE ? OR kluva LIKE ?)'); const q = '%' + String(f.q).slice(0, 60) + '%'; a.push(q, q, q, q); }
  const q = (sql, ...x) => db.prepare(sql).bind(...x).all().then(r => r.results || []).catch(() => []);
  const list = await q('SELECT * FROM audit' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY id DESC LIMIT 400', ...a);
  const moduli = (await q('SELECT DISTINCT modulis FROM audit ORDER BY modulis')).map(r => r.modulis);
  const kas = (await q('SELECT DISTINCT kas FROM audit ORDER BY kas')).map(r => r.kas);
  return { list, moduli, kas };
}
