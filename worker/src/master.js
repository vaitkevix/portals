/* SH | Pamatdati — viens saraksts visām lietotnēm: objekti, cilvēki, uzņēmumi, saraksti. © VAITKEVIX, SIA
 * Galvenais ir portāls (D1). Vecās lietotņu lapas (Adreses, Cilveki, SIA, Pasutitaji, Kurjeri, Materiali, Objekti, DarbuVeidi)
 * tiek atjaunotas automātiski, lai lietotnes strādā kā līdz šim. */
import { cleanAddr } from './util.js';
import { people, peopleStmts, usersStmts, cleanPerms } from './portal.js';

export const LIST_KINDS = { materiali: 'Materiāli', bankas: 'Bankas', atv_veidi: 'Atvaļinājuma veidi', amati: 'Amati', tel_kodi: 'Tālruņa kodi' };
export const KINDS = { izvedejs: 'Izvedējs', kurjers: 'Kurjers', plausejs: 'Pļāvējs', logu_mazg: 'Logu mazgātājs', traktorists: 'Traktorists', darznieks: 'Dārznieks', stav_mazg: 'Stāvvietu mazgātājs', darba_devejs: 'Darba devējs' };
export const normA = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
export const normN = (s) => normA(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const anorm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');   // kā Aizvietošanā
const stripPfx = (s) => normN(s).replace(/^(kk|ir|ee) /, '').replace(/^(j|vni) ?\| ?/, '');
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const kvSet = (db, k, v) => db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, String(v));

export async function master(db) {
  const [objects, types, companies, lists, ppl, review] = await Promise.all([
    all(db, 'SELECT adrese, vaditajs, grupa, piekluve FROM objects ORDER BY ord, adrese'),
    all(db, 'SELECT name, grp FROM types ORDER BY ord, name'),
    all(db, 'SELECT name, kinds, pass, phone, active FROM companies ORDER BY ord, name'),
    all(db, 'SELECT kind, value FROM lists ORDER BY kind, ord, value'),
    people(db), kvGet(db, 'masterReview')]);
  const L = {}; Object.keys(LIST_KINDS).forEach(k => L[k] = []); lists.forEach(r => (L[r.kind] = L[r.kind] || []).push(r.value));
  return { objects, types: types.map(t => ({ name: t.name, group: t.grp })), companies: companies.map(c => ({ name: c.name, kinds: c.kinds ? c.kinds.split(',') : [], pass: c.pass, phone: c.phone, active: !!c.active })),
    lists: L, people: ppl, review: review ? JSON.parse(review) : [], mode: (await kvGet(db, 'masterMode')) === '1',
    groups: await groupsOf(db, objects).catch(() => []) };
}

/* ---------- Saglabāšana ---------- */
/* Vadītāja vārds objektā = vārds, kā saglabāts Pilnvarās («Rostislavs» → «Rostislavs F.»).
   Salīdzina: precīzi, bez garumzīmēm/burtu lieluma, «Vārds Uzvārds» = «Vārds U.», tikai vārds. Ja vairāki — priekšroka tiem, kam ir Aizvietošanas loma. */
const pKey = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
const pShort = (x) => { const w = pKey(x).split(' '); return w.length > 1 ? w[0] + ' ' + w[w.length - 1][0] : w[0]; };
export function personCanonFrom(list) {
  const ppl = (list || []).filter(p => p && p.name && p.active !== false && p.active !== 0).map(p => { let pr = p.perms || {}; if (typeof pr === 'string') { try { pr = JSON.parse(pr); } catch (e) { pr = {}; } } return { name: p.name, aizv: !!pr.aizv }; });
  return (raw) => {
    const v = String(raw || '').trim(); if (!v) return '';
    const pick = (f) => { const m = ppl.filter(f); if (!m.length) return null; if (m.length === 1) return m[0].name; const a = m.filter(x => x.aizv); return a.length === 1 ? a[0].name : null; };
    return pick(p => p.name === v) || pick(p => pKey(p.name) === pKey(v)) || (pKey(v).includes(' ') ? pick(p => pShort(p.name) === pShort(v)) : null) || pick(p => pKey(p.name).split(' ')[0] === pKey(v)) || v;
  };
}
export async function personCanon(db) { try { return personCanonFrom((await db.prepare('SELECT name, active, perms FROM people').all()).results || []); } catch (e) { return (x) => x; } }
export function objectsStmts(db, list, canon) {
  canon = canon || ((x) => x);
  const st = [db.prepare('DELETE FROM objects')];
  const seen = new Set();
  list.forEach((o, i) => { const a = cleanAddr(o.adrese); const k = anorm(a); if (!a || seen.has(k)) return; seen.add(k);
    st.push(db.prepare('INSERT INTO objects (anorm, adrese, vaditajs, grupa, piekluve, ord) VALUES (?, ?, ?, ?, ?, ?)').bind(k, a, canon(o.vaditajs || ''), o.grupa || 'SH objekti', o.piekluve || '', i)); });
  return st;
}
export function companiesStmts(db, list) {
  const st = [db.prepare('DELETE FROM companies')];
  const seen = new Set();
  list.forEach((c, i) => { const n = String(c.name || '').replace(/\s+/g, ' ').trim(); if (!n || seen.has(normN(n))) return; seen.add(normN(n));
    const kinds = (c.kinds || []).filter(k => KINDS[k]);
    st.push(db.prepare('INSERT INTO companies (name, kinds, pass, phone, ord, active) VALUES (?, ?, ?, ?, ?, ?)').bind(n, kinds.join(','), String(c.pass || '').trim().toUpperCase(), c.phone || '', i, c.active === false ? 0 : 1)); });
  return st;
}
export function listsStmts(db, L) {
  const st = [db.prepare('DELETE FROM lists')];
  Object.keys(LIST_KINDS).forEach(k => { const seen = new Set(); (L[k] || []).forEach((v, i) => { v = String(v || '').trim(); if (!v || seen.has(normA(v))) return; seen.add(normA(v));
    st.push(db.prepare('INSERT INTO lists (kind, value, ord) VALUES (?, ?, ?)').bind(k, v, i)); }); });
  return st;
}
export function typesStmts(db, list) {
  const st = [db.prepare('DELETE FROM types')];
  list.forEach((t, i) => { if (t && t.name) st.push(db.prepare('INSERT OR REPLACE INTO types (name, grp, ord) VALUES (?, ?, ?)').bind(String(t.name).trim(), t.group || 'Papilddarbs', i)); });
  return st;
}

/* ---------- Pirmais imports no visām lietotnēm (dublikātus apvieno tikai, ja pilnīgi vienādi) ---------- */
const rowsOf = (raw) => { if (!raw || raw.length < 2) return { head: (raw && raw[0]) || [], rows: [] }; const head = raw[0].map(h => String(h).trim()), m = head.findIndex(h => h.toLowerCase() === 'portālā');
  return { head, rows: raw.slice(1).filter(r => String(r[0] || '').trim() && (m < 0 || String(r[m] || '').trim().toLowerCase() !== 'nē')) }; };
const colOf = (head, re) => head.findIndex(h => re.test(h));

export async function importAll(db, src) {
  const review = [];
  const M = await master(db);
  // --- Objekti ---
  const objs = M.objects.map(o => Object.assign({}, o)), oIdx = {};
  objs.forEach(o => oIdx[normA(o.adrese)] = o);
  const addObj = (a, piekluve, from) => {
    a = String(a || '').replace(/\s+/g, ' ').trim(); if (!a) return;
    const k = normA(a);
    if (oIdx[k]) { if (piekluve && !oIdx[k].piekluve) oIdx[k].piekluve = piekluve; return; }
    const sim = objs.find(o => stripPfx(o.adrese) === stripPfx(a));
    if (sim) review.push(['Objekts', a + '  ↔  ' + sim.adrese, 'Atstāti abi', 'Vai tā ir viena adrese? Ja jā — izdzēsiet lieko portālā']);
    const o = { adrese: a, vaditajs: '', grupa: 'SH objekti', piekluve: piekluve || '' }; objs.push(o); oIdx[k] = o;
    if (from) o._from = from;
  };
  const izv = src.izv || {}, kais = src.kais || {}, pers = src.pers || {};
  { const { head, rows } = rowsOf(izv.Adreses); const pc = colOf(head, /^piekļuve/i); rows.forEach(r => addObj(r[0], pc > 0 ? String(r[pc] || '').trim() : '', 'izv')); }
  { const { rows } = rowsOf(kais.Adreses); rows.forEach(r => addObj(r[0], '', 'kais')); }
  (pers.objekti || []).forEach(a => addObj(a, '', 'pers'));

  // --- Cilvēki ---
  const ppl = M.people.map(p => Object.assign({}, p, { perms: Object.assign({}, p.perms) })), pIdx = {};
  ppl.forEach(p => pIdx[normN(p.name)] = p);
  const pins = new Set(ppl.map(p => String(p.pin)));
  const newPin = () => { let x; do { x = String(100000 + Math.floor(Math.random() * 900000)); } while (pins.has(x)); pins.add(x); return x; };
  const addReq = (name, app, pass, phone) => {
    name = String(name || '').replace(/\s+/g, ' ').trim(); if (!name) return;
    let p = pIdx[normN(name)];
    if (!p) {
      const first = normN(name).split(' ')[0];
      const sim = ppl.find(x => normN(x.name).split(' ')[0] === first);
      if (sim) review.push(['Cilvēks', name + '  ↔  ' + sim.name, 'Atstāti abi', 'Vai tas ir viens cilvēks? Ja jā — izdzēsiet lieko un piešķiriet tiesības otram']);
      pass = String(pass || '').trim();
      const pin = pass && !pins.has(pass) ? (pins.add(pass), pass) : newPin();
      p = { name, pin, color: '', phone: '', email: '', active: true, perms: {} }; ppl.push(p); pIdx[normN(name)] = p;
    } else if (pass && String(pass).trim() !== String(p.pin)) {
      review.push(['Cilvēks', name, 'Parole no ' + (app === 'izv' ? 'Izvešanas' : 'Kaisāmmateriāla') + ' nomainīta uz vienoto PIN', 'Pasakiet viņam jauno PIN (redzams Pilnvarās)']);
    }
    if (!p.perms[app]) p.perms[app] = 'pieteicejs';
    if (phone && !p.phone) p.phone = String(phone).trim();
  };
  { const { head, rows } = rowsOf(izv.Cilveki); const pc = colOf(head, /^parole/i); rows.forEach(r => addReq(r[0], 'izv', pc > 0 ? r[pc] : '', '')); }
  { const { head, rows } = rowsOf(kais.Pasutitaji); const pc = colOf(head, /^parole/i), tc = colOf(head, /^tālrunis|^talrunis|^telefons/i); rows.forEach(r => addReq(r[0], 'kais', pc > 0 ? r[pc] : '', tc > 0 ? r[tc] : '')); }

  // --- Uzņēmumi ---
  const comps = M.companies.map(c => Object.assign({}, c, { kinds: c.kinds.slice() })), cIdx = {};
  comps.forEach(c => cIdx[normN(c.name)] = c);
  const addComp = (name, kind, pass) => {
    name = String(name || '').replace(/\s+/g, ' ').trim(); if (!name) return;
    let c = cIdx[normN(name)]; pass = String(pass || '').trim().toUpperCase();
    if (!c) { c = { name, kinds: [], pass: '', phone: '', active: true }; comps.push(c); cIdx[normN(name)] = c; }
    if (c.kinds.indexOf(kind) === -1) c.kinds.push(kind);
    if (pass) { if (!c.pass) c.pass = pass; else if (c.pass !== pass) review.push(['Uzņēmums', name, 'Bija divas paroles — paturēta Izvešanas parole', 'Kurjeram jāpasaka vienotā parole (redzama Uzņēmumos)']); }
  };
  { const { head, rows } = rowsOf(izv.SIA); const pc = colOf(head, /^parole/i); rows.forEach(r => addComp(r[0], 'izvedejs', pc > 0 ? r[pc] : '')); }
  { const { head, rows } = rowsOf(kais.Kurjeri); const pc = colOf(head, /^parole/i); rows.forEach(r => addComp(r[0], 'kurjers', pc > 0 ? r[pc] : '')); }
  (pers.sia || []).forEach(n => addComp(n, 'darba_devejs', ''));

  // --- Saraksti ---
  const L = M.lists;
  const addL = (k, arr) => (arr || []).forEach(v => { v = String(v || '').trim(); if (v && !L[k].some(x => normA(x) === normA(v))) L[k].push(v); });
  { const { rows } = rowsOf(kais.Materiali); addL('materiali', rows.map(r => r[0])); }
  addL('bankas', pers.bankas); addL('atv_veidi', pers.veidi); addL('amati', pers.amati); addL('tel_kodi', pers.kodi);

  objs.forEach(o => delete o._from);
  await db.batch([...objectsStmts(db, objs, personCanonFrom(ppl)), ...peopleStmts(db, ppl), ...usersStmts(db, ppl), ...companiesStmts(db, comps), ...listsStmts(db, L),
    kvSet(db, 'masterReview', JSON.stringify(review)), kvSet(db, 'masterMode', '1'), kvSet(db, 'masterDirty', '1'), kvSet(db, 'peopleDirty', '1')]);
  return { objects: objs.length, people: ppl.length, companies: comps.length, review: review.length };
}

/** Ko ierakstīt katras lietotnes vecajās lapās */
export function legacyPayload(M) {
  const has = (c, k) => c.active && c.kinds.indexOf(k) !== -1;
  return {
    aizv: { objects: M.objects.map(o => [o.adrese, o.vaditajs, o.grupa, o.piekluve]), types: M.types.map(t => [t.name, t.group]),
      companies: M.companies.map(c => [c.name, c.kinds.map(k => KINDS[k]).join(', '), c.pass, c.phone, c.active ? 'Jā' : 'Nē']),
      lists: Object.keys(LIST_KINDS).flatMap(k => (M.lists[k] || []).map(v => [LIST_KINDS[k], v])), review: M.review },
    izv: { Adreses: { cols: ['Adrese', 'Piekļuve'], rows: M.objects.map(o => [o.adrese, o.piekluve]) },
      Cilveki: { cols: ['Vārds', 'Parole'], rows: M.people.filter(p => p.active && p.perms.izv).map(p => [p.name, p.pin]) },
      SIA: { cols: ['SIA', 'Parole'], rows: M.companies.filter(c => has(c, 'izvedejs')).map(c => [c.name, c.pass]) } },
    kais: { Adreses: { cols: ['Adrese'], rows: M.objects.map(o => [o.adrese]) },
      Pasutitaji: { cols: ['Pasūtītājs', 'Tālrunis', 'Parole'], rows: M.people.filter(p => p.active && p.perms.kais).map(p => [p.name, p.phone, p.pin]) },
      Kurjeri: { cols: ['Kurjera uzņēmums', 'Parole'], rows: M.companies.filter(c => has(c, 'kurjers')).map(c => [c.name, c.pass]) },
      Materiali: { cols: ['Materiāls'], rows: (M.lists.materiali || []).map(v => [v]) } }
  };
}
/** Personālam un citām lietotnēm: publiskie saraksti (bez parolēm) */
export function publicLists(M) {
  return { sia: M.companies.filter(c => c.active && c.kinds.indexOf('darba_devejs') !== -1).map(c => c.name), bankas: M.lists.bankas, veidi: M.lists.atv_veidi,
    amati: M.lists.amati, kodi: M.lists.tel_kodi, materiali: M.lists.materiali, types: M.types,
    objekti: (M.groups || []).map(g => 'Grupa: ' + g.name).concat(M.objects.map(o => o.adrese)), grupas: (M.groups || []).map(g => ({ name: g.name, adreses: g.adreses })) };
}
export { kvGet, kvSet, cleanPerms };


/* ---------- «Pārbaudīt»: dublikātu apvienošana (paturētais saņem visu; atsauces pārceltas, nekas netiek zaudēts) ---------- */
const PAIR = '  ↔  ';
export async function resolveReview(db, i, keep) {
  const R = JSON.parse((await kvGet(db, 'masterReview')) || '[]');
  const it = R[i]; if (!it) return { ok: false, error: 'Ieraksts vairs nav — atjaunojiet' };
  let people = false;
  if (keep === 0 || keep === 1) {
    const pair = String(it[1] || '').split(PAIR); if (pair.length !== 2) return { ok: false, error: 'Šim ierakstam nav pāra' };
    const K = pair[keep].trim(), D = pair[1 - keep].trim();
    if (it[0] === 'Objekts') {
      const ko = await db.prepare('SELECT * FROM objects WHERE anorm = ?').bind(anorm(K)).first();
      const dobj = await db.prepare('SELECT * FROM objects WHERE anorm = ?').bind(anorm(D)).first();
      if (!ko) return { ok: false, error: 'Objekts «' + K + '» vairs nav sarakstā' };
      const st = [];
      if (dobj) st.push(db.prepare('UPDATE objects SET vaditajs = ?, grupa = ?, piekluve = ? WHERE anorm = ?')
        .bind(ko.vaditajs || dobj.vaditajs, ko.grupa || dobj.grupa, ko.piekluve || dobj.piekluve, ko.anorm),
        db.prepare('DELETE FROM objects WHERE anorm = ?').bind(dobj.anorm));
      st.push(db.prepare('UPDATE jobs SET adrese = ?, anorm = ? WHERE anorm = ?').bind(ko.adrese, ko.anorm, anorm(D)),
        db.prepare('UPDATE problems SET adrese = ?, anorm = ? WHERE anorm = ?').bind(ko.adrese, ko.anorm, anorm(D)),
        db.prepare('UPDATE standing SET adrese = ? WHERE adrese = ?').bind(ko.adrese, D));
      await db.batch(st);
    } else if (it[0] === 'Cilvēks') {
      const all = await db.prepare('SELECT * FROM people').all().then(r => r.results || []);
      const kp = all.find(p => normN(p.name) === normN(K)), dp = all.find(p => normN(p.name) === normN(D));
      if (!kp) return { ok: false, error: 'Cilvēks «' + K + '» vairs nav sarakstā' };
      const st = [];
      if (dp) {
        const kpm = JSON.parse(kp.perms || '{}'), dpm = JSON.parse(dp.perms || '{}');
        Object.keys(dpm).forEach(a => { if (dpm[a] && !kpm[a]) kpm[a] = dpm[a]; });
        st.push(db.prepare('UPDATE people SET perms = ?, phone = ?, email = ?, color = ? WHERE name = ?')
          .bind(JSON.stringify(cleanPerms(kpm)), kp.phone || dp.phone || '', kp.email || dp.email || '', kp.color || dp.color || '', kp.name),
          db.prepare('DELETE FROM people WHERE name = ?').bind(dp.name));
        ['jobs', 'standing', 'objects', 'problems'].forEach(t => st.push(db.prepare('UPDATE ' + t + ' SET vaditajs = ? WHERE vaditajs = ?').bind(kp.name, dp.name)));
        st.push(db.prepare('UPDATE tokens SET name = ? WHERE name = ?').bind(kp.name, dp.name));
      }
      await db.batch(st); people = true;
    } else return { ok: false, error: 'Šo ierakstu apvienot nevar — spiediet «Izdarīts»' };
  }
  R.splice(i, 1);
  await db.batch([kvSet(db, 'masterReview', JSON.stringify(R))]);
  return { ok: true, people };
}
export async function clearInfoReview(db) {
  const R = JSON.parse((await kvGet(db, 'masterReview')) || '[]');
  const left = R.filter(r => String(r[1] || '').indexOf(PAIR) >= 0);
  await db.batch([kvSet(db, 'masterReview', JSON.stringify(left))]);
  return R.length - left.length;
}

/* Adrešu pāri, kur tieši vienai pusei ir filtra prefikss «J |» vai «VNĪ |» → paturēt prefiksēto, otru apvienot ar to */
const PFX = /^\s*(j|vn[iī])\s*\|/i;
export const pfxSide = (r) => { if (!r || r[0] !== 'Objekts') return -1; const p = String(r[1] || '').split(PAIR); if (p.length !== 2) return -1;
  const a = PFX.test(p[0]), b = PFX.test(p[1]); return a && !b ? 0 : b && !a ? 1 : -1; };
export async function autoMergePrefixed(db) {
  let merged = 0; const failed = new Set();
  for (let g = 0; g < 30; g++) {   // D1 vaicājumu limits vienā pieprasījumā — pa 30 pāriem; pogu var spiest vēlreiz
    const R = JSON.parse((await kvGet(db, 'masterReview')) || '[]');
    const i = R.findIndex(r => pfxSide(r) >= 0 && !failed.has(r[1])); if (i < 0) break;
    const r = await resolveReview(db, i, pfxSide(R[i]));
    if (r.ok) merged++; else failed.add(R[i][1]);
  }
  const left = JSON.parse((await kvGet(db, 'masterReview')) || '[]').filter(r => pfxSide(r) >= 0 && !failed.has(r[1])).length;
  return { merged, failed: failed.size, remaining: left };
}

/* ---------- Objektu grupas: «rule» = adreses sākums (piem. «J |»), «members» = ar roku pievienotās adreses (anorm) ---------- */
const pfxN = (s) => normN(s).replace(/\s*\|\s*/g, '|');
export async function groupsOf(db, objs) {
  const G = (await db.prepare('SELECT * FROM groups ORDER BY ord, name').all()).results || [];
  objs = objs || ((await db.prepare('SELECT adrese FROM objects ORDER BY ord').all()).results || []);
  return G.map(g => { let mem = []; try { mem = JSON.parse(g.members || '[]'); } catch (e) {}
    const set = new Set(mem), r = pfxN(g.rule);
    const adreses = objs.filter(o => (r && pfxN(o.adrese).startsWith(r)) || set.has(anorm(o.adrese))).map(o => o.adrese);
    return { id: g.id, name: g.name, rule: g.rule, members: mem, adreses }; });
}
export function groupsStmts(db, list) {
  const st = [db.prepare('DELETE FROM groups')], seen = new Set();
  list.forEach((g, i) => { const name = String(g.name || '').replace(/\s+/g, ' ').trim(); if (!name || seen.has(name.toLowerCase())) return; seen.add(name.toLowerCase());
    const id = String(g.id || '').trim() || ('g' + Date.now().toString(36) + i);
    const mem = [...new Set((g.adreses || g.members || []).map(a => anorm(a)).filter(Boolean))];
    st.push(db.prepare('INSERT INTO groups (id, name, rule, members, ord) VALUES (?, ?, ?, ?, ?)').bind(id, name, String(g.rule || '').trim(), JSON.stringify(mem), i)); });
  return st;
}
