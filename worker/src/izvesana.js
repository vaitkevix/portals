// SH | Izvešana — bez Apps Script: pieteikumi D1 (izv_task), bildes R2, AI Worker, atskaite HTML (drukā → PDF). © VAITKEVIX, SIA
// Ieslēdz kv «izv:native» = '1' (pēc imports()). Funkciju nosaukumi un atbildes — tādi paši kā vecajam GAS (lietotne nemainās).
import * as G from './sheets.js';
import * as F from './foto.js';
import * as AI from './ai.js';

const TAB = 'Izvešana · Pieteikumi';
const DUE_DAYS = 7, MAX_PHOTOS = 5, BAG_M3 = 0.15, COEF_HEAVY = 0.10, COEF_MIXED = 0.05, AI_DAILY = 400;
const ST_PENDING = 'Neizpildīts', ST_DONE = 'Izpildīts', ST_CANCELLED = 'Atcelts';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
export const isNative = async (env) => (await kvGet(env.DB, 'izv:native')) === '1';

/* ---------- laiks (Rīga) ---------- */
const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d || new Date()).map(x => [x.type, x.value]));
const stamp = () => { const p = parts(); return p.day + '.' + p.month + '.' + p.year + ' ' + p.hour + ':' + p.minute; };
const pd = (s) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(s || '').trim()); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0))) : null; };
const dmy = (d) => ('0' + d.getUTCDate()).slice(-2) + '.' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '.' + d.getUTCFullYear();
function dueDate(value, created) {
  const c = pd(created) || pd(stamp()), base = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
  const max = new Date(base.getTime() + DUE_DAYS * 864e5);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  let d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : max;
  if (d < base) d = base; if (d > max) d = max;
  return dmy(d);
}
const isYes = (v) => /^(jā|ja|yes|true|1|x)$/i.test(String(v == null ? '' : v).trim());
const num = (v) => typeof v === 'number' ? v : (parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')) || 0);
const fmt = (n) => { const r = Math.round(n * 100) / 100; return r ? String(r).replace('.', ',') : '–'; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fail = (message, code) => ({ status: 'error', message, code: code || '' });

/* ---------- dati ---------- */
const out = (t) => ({ rowIndex: t.row, id: t.id, date: t.datums, address: t.adrese, requester: t.pasutitajs, bagsEst: t.maisi, comment: t.komentars, photoBefore: t.foto_pirms,
  status: t.statuss || ST_PENDING, sia: t.sia, photoAfter: t.foto_pec, photoCarrierBefore: t.foto_izv_pirms || '', m3Hauled: t.m3, carrierComment: t.izv_kom, urgent: !!t.steidzami, deadline: t.termins, problem: t.problema,
  history: t.vesture, doneAt: t.izpildits, bagsHauled: t.maisi_izv, coefNote: t.koef });
export async function getTasks(db) { return (await all(db, 'SELECT * FROM izv_task ORDER BY row')).map(out); }
export async function getInitialData(env) {
  const db = env.DB;
  const [objs, ppl, comp] = await Promise.all([all(db, 'SELECT adrese FROM objects ORDER BY ord, adrese'), all(db, 'SELECT name, perms, active FROM people ORDER BY ord, name'), all(db, 'SELECT name, kinds, active FROM companies ORDER BY ord, name')]);
  return { addresses: objs.map(o => o.adrese), people: ppl.filter(p => { let x = {}; try { x = JSON.parse(p.perms || '{}'); } catch (e) {} return p.active && x.izv; }).map(p => p.name),
    siaList: comp.filter(c => c.active && String(c.kinds).split(',').indexOf('izvedejs') !== -1).map(c => c.name), ai: !!env.ANTHROPIC_API_KEY };
}
/** Portāla kopskatam (portal.js lasa kv «izv:getBoot») */
async function cache(env) {
  const tasks = await getTasks(env.DB), lists = await getInitialData(env);
  await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('izv:getBoot', ?), ('izv:getTasks', ?), ('izvt:getBoot', ?), ('izvt:getTasks', ?)")
    .bind(JSON.stringify({ ok: true, result: { lists, tasks } }), JSON.stringify({ ok: true, result: tasks }), String(Date.now()), String(Date.now())).run();
  return tasks;
}
const withTasks = async (env, res) => { if (res && res.status === 'success') res.tasks = await cache(env); return res; };
const byId = (db, id) => db.prepare('SELECT * FROM izv_task WHERE id = ?').bind(String(id || '').trim()).first();
const log = (t, text) => (t.vesture ? t.vesture + '\n' : '') + stamp() + ' · ' + text;

/* ---------- izvedēja parole: «SIA\nPAROLE» (Uzņēmumi, veids izvedējs) ---------- */
async function sias(db) { return (await all(db, 'SELECT name, kinds, pass FROM companies WHERE active = 1')).filter(c => String(c.kinds).split(',').indexOf('izvedejs') !== -1); }
/** Portāla sesija aizstāj SIA paroli: izvedēja uzņēmums vai Izvešanas/portāla administrators */
export function portalCarrier(me) {
  if (!me) return null; const p = me.perms || {};
  if (me.company) return p.izv === 'izvedejs' ? { sia: me.name } : null;
  return p.izv === 'admin' || p.portal === 'admin' ? { sia: '', admin: me.name } : null;
}
export async function login(db, pin, me) {
  const pc = portalCarrier(me); if (pc) return pc;
  const s = String(pin == null ? '' : pin), i = s.indexOf('\n');
  const user = (i >= 0 ? s.slice(0, i) : '').replace(/\s+/g, ' ').trim(), pass = (i >= 0 ? s.slice(i + 1) : s).trim().toUpperCase();
  if (!pass || !user) return null;
  const r = (await sias(db)).find(x => x.name.toLowerCase() === user.toLowerCase());
  return r && r.pass && pass === String(r.pass).toUpperCase() ? { sia: r.name } : null;
}
export async function carrierByPassword(db, pw) {
  const p = String(pw || '').trim().toUpperCase(); if (!p) return '';
  const m = (await sias(db)).filter(x => x.pass && String(x.pass).toUpperCase() === p);
  return m.length === 1 ? m[0].name : '';
}
const slow = () => new Promise(r => setTimeout(r, 800));

/* ---------- bildes → R2 ---------- */
async function savePhotos(env, list, id, suffix) {
  const arr = (Array.isArray(list) ? list : [list]).filter(Boolean).slice(0, MAX_PHOTOS), urls = [];
  for (const p of arr) { if (/^https?:/.test(p)) { urls.push(p); continue; } const k = await F.put(env, p, { app: 'izv', id, suffix }); if (k) urls.push(F.url(k)); }
  return urls.join('\n');
}

/* ---------- pieteikumi ---------- */
export async function saveTask(env, d) {
  const db = env.DB; d = d || {};
  if (!String(d.address || '').trim()) return fail('Nav norādīta adrese');
  const ph = d.photos || d.photo;
  if (!ph || (Array.isArray(ph) && !ph.length)) return fail('Pievienojiet bildi pirms izvešanas');
  const id = /^TASK-\d{10,}$/.test(String(d.id || '')) ? String(d.id) : 'TASK-' + Date.now();
  if (await byId(db, id)) return withTasks(env, { status: 'success', id });
  const photo = await savePhotos(env, ph, id, 'Pirms'), now = stamp();
  const mx = await db.prepare('SELECT MAX(row) m FROM izv_task').first();
  await db.prepare('INSERT INTO izv_task (id, row, datums, adrese, pasutitajs, maisi, komentars, foto_pirms, statuss, steidzami, termins, vesture) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, ((mx && mx.m) || 1) + 1, now, String(d.address || '').trim(), String(d.requester || ''), String(d.bagsEst || ''), String(d.comment || ''), photo, ST_PENDING,
      d.urgent ? 1 : 0, dueDate(d.deadline, now), now + ' · Izveidots' + (d.requester ? ' (' + d.requester + ')' : '')).run();
  return withTasks(env, { status: 'success', id });
}
export async function updateTask(env, d) {
  const db = env.DB; d = d || {};
  if (!String(d.address || '').trim()) return fail('Nav norādīta adrese');
  const t = await byId(db, d.id); if (!t) return fail('Pieteikums nav atrasts — iespējams, tas ir izdzēsts');
  if ((t.statuss || ST_PENDING) !== ST_PENDING) return fail('Labot var tikai neizpildītu pieteikumu (statuss: ' + t.statuss + ')');
  const old = [t.adrese, t.pasutitajs, t.maisi, t.komentars], neu = [d.address || '', d.requester || '', d.bagsEst || '', d.comment || ''];
  const changed = ['adrese', 'pasūtītājs', 'daudzums', 'komentārs'].filter((n, i) => String(old[i] || '').trim() !== String(neu[i]).trim());
  if (!!t.steidzami !== !!d.urgent) changed.push(d.urgent ? 'steidzams' : 'nav steidzams');
  const v = changed.length ? log(t, 'Labots: ' + changed.join(', ') + (d.requester ? ' (' + d.requester + ')' : '')) : t.vesture;
  await db.prepare('UPDATE izv_task SET adrese = ?, pasutitajs = ?, maisi = ?, komentars = ?, steidzami = ?, vesture = ?, termins = ? WHERE id = ?')
    .bind(String(neu[0]), String(neu[1]), String(neu[2]), String(neu[3]), d.urgent ? 1 : 0, v, d.deadline ? dueDate(d.deadline, t.datums) : t.termins, t.id).run();
  return withTasks(env, { status: 'success' });
}
export async function setTaskCancelled(env, id, cancel) {
  const db = env.DB, t = await byId(db, id); if (!t) return fail('Pieteikums nav atrasts — iespējams, tas ir izdzēsts');
  const st = t.statuss || ST_PENDING;
  if (st === ST_DONE) return fail('Pieteikums jau ir izpildīts');
  if ((cancel && st === ST_CANCELLED) || (!cancel && st !== ST_CANCELLED)) return withTasks(env, { status: 'success' });
  await db.prepare('UPDATE izv_task SET statuss = ?, vesture = ? WHERE id = ?').bind(cancel ? ST_CANCELLED : ST_PENDING, log(t, cancel ? 'Atcelts' : 'Atjaunots'), t.id).run();
  return withTasks(env, { status: 'success' });
}
const accKey = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/^(kk|ir|ee) /, '').replace(/^(j|vnī) ?\| ?/, '');
export async function getAccess(db, pin, me) {
  if (!await login(db, pin, me)) { await slow(); return {}; }
  const o = {}; (await all(db, "SELECT adrese, piekluve FROM objects WHERE piekluve != ''")).forEach(r => { const a = accKey(r.adrese); if (a) o[a] = String(r.piekluve).trim(); });
  return o;
}
export async function checkCarrierPin(db, pin, me) { if (await login(db, pin, me)) return true; await slow(); return false; }
export async function completeTask(env, d, me) {
  const db = env.DB; d = d || {};
  const lg = await login(db, d.pin, me); if (!lg) return fail('Nepareiza parole', 'pin');
  const t0 = await byId(db, d.id); if (!t0) return fail('Pieteikums nav atrasts — iespējams, tas ir izdzēsts');
  let bags = null, coefNote = '';
  if (d.bagsHauled !== undefined && d.bagsHauled !== null && d.bagsHauled !== '') {
    bags = parseInt(d.bagsHauled, 10);
    if (!(bags >= 1 && bags <= 1000)) return fail('Nepareizs maisu skaits (1–1000)');
    const coef = (d.heavy ? COEF_HEAVY : 0) + (d.mixed ? COEF_MIXED : 0);
    d.m3Hauled = Math.round(bags * BAG_M3 * (1 + coef) * 100) / 100;
    coefNote = [d.heavy ? '+10% smagi maisi' : '', d.mixed ? '+5% sadzīves atkritumi' : ''].filter(Boolean).join('; ');
  }
  /* Izvedēja bildes: tikai tikko uzņemtas (data:image) vai jau mūsu R2 (/img?id=r2-…) — svešas saites neder */
  const okPh = (x) => /^data:image\/[\w.+-]+;base64,/.test(String(x || '')) || /^https:\/\/vaitkevix\.cloud\/sh\/api\/img\?id=r2-[\w-]+/.test(String(x || ''));
  const asL = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);
  const pb = asL(d.photosBefore).filter(okPh);
  if (!pb.length) return fail('Pievienojiet bildi pirms savākšanas');
  const ph = asL(d.photosAfter || d.photoAfter).filter(okPh);
  if (!ph.length) return fail('Pievienojiet bildi pēc izvešanas');
  { const st0 = t0.statuss || ST_PENDING;   // pārbauda PIRMS bilžu saglabāšanas (citādi R2 paliek liekas bildes)
    if (st0 === ST_DONE) return fail('Šis pieteikums jau ir atzīmēts kā izpildīts');
    if (st0 === ST_CANCELLED) return fail('Šis pieteikums ir atcelts'); }
  const photoB = await savePhotos(env, pb, t0.id, 'Pirms');
  const photo = await savePhotos(env, ph, t0.id, 'Izvests');
  const t = await byId(db, d.id); if (!t) return fail('Pieteikums nav atrasts — iespējams, tas ir izdzēsts');
  const st = t.statuss || ST_PENDING;
  if (st === ST_DONE) return fail('Šis pieteikums jau ir atzīmēts kā izpildīts');
  if (st === ST_CANCELLED) return fail('Šis pieteikums ir atcelts');
  const m3 = d.m3Hauled === 0 ? '0' : String(d.m3Hauled || '');
  let v = log(t, 'Izpildīts · ' + (bags ? bags + ' maisi × 150 l' + (coefNote ? ' (' + coefNote + ')' : '') + ' = ' : '') + fmt(num(d.m3Hauled)) + ' m³ (izvedējs)');
  if (d.aiNote) v += '\n' + stamp() + ' · AI pārbaude: ' + String(d.aiNote).slice(0, 200);
  await db.prepare('UPDATE izv_task SET statuss = ?, sia = ?, foto_izv_pirms = ?, foto_pec = ?, m3 = ?, izv_kom = ?, izpildits = ?, maisi_izv = ?, koef = ?, vesture = ? WHERE id = ?')
    .bind(ST_DONE, lg.sia || t.sia || '', photoB || t.foto_izv_pirms || '', photo || t.foto_pec || '', m3, String(d.carrierComment || ''), stamp(), bags ? String(bags) : t.maisi_izv, bags ? coefNote : t.koef, v, t.id).run();
  return withTasks(env, { status: 'success' });
}
export async function reportProblem(env, d, me) {
  const db = env.DB; d = d || {};
  if (!await login(db, d.pin, me)) return fail('Nepareiza parole', 'pin');
  const reason = String(d.reason || '').trim(); if (!reason) return fail('Izvēlieties iemeslu');
  const comment = String(d.comment || '').trim();
  const t = await byId(db, d.id); if (!t) return fail('Pieteikums nav atrasts — iespējams, tas ir izdzēsts');
  if ((t.statuss || ST_PENDING) !== ST_PENDING) return fail('Pieteikums vairs nav neizpildīts (statuss: ' + t.statuss + ')');
  const text = reason + (comment ? ' — ' + comment : '');
  await db.prepare('UPDATE izv_task SET problema = ?, vesture = ? WHERE id = ?').bind(stamp() + ' · ' + text, log(t, 'Nevarēja izvest: ' + text), t.id).run();
  return withTasks(env, { status: 'success' });
}

/* ---------- koordinātas (OpenStreetMap, kešs D1 «geo»; līdz 5 jaunām reizē) ---------- */
export async function geocodeAddresses(db, addrs) {
  const list = [...new Set((Array.isArray(addrs) ? addrs : []).map(a => String(a || '').trim()).filter(Boolean))], out = {};
  const have = {}; for (let i = 0; i < list.length; i += 80) { const ch = list.slice(i, i + 80);
    (await all(db, 'SELECT k, lat, lng FROM geo WHERE k IN (' + ch.map(() => '?').join(',') + ')', ...ch.map(a => a.toLowerCase().slice(0, 200)))).forEach(r => have[r.k] = r); }
  let left = 5;
  for (const a of list) {
    const k = a.toLowerCase().slice(0, 200); let g = have[k];
    if (!g && left > 0) { left--;
      try { const q = accKey(a).replace(/\s*\|\s*/g, ' ') + ', Latvija';
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=lv&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'SH-portals/1.0', 'Accept-Language': 'lv' } });
        const j = r.ok ? await r.json() : null, h = j && j[0];
        g = { lat: h ? +h.lat : null, lng: h ? +h.lon : null };
        await db.prepare('INSERT OR REPLACE INTO geo (k, lat, lng, t) VALUES (?, ?, ?, ?)').bind(k, g.lat, g.lng, stamp()).run();
        await new Promise(r => setTimeout(r, 1100));
      } catch (e) {} }
    out[a] = g && g.lat != null ? [g.lat, g.lng] : null;
  }
  return { status: 'success', coords: out, base: '' };
}

/* ---------- atskaite (tā pati kā GAS PDF; tagad HTML → lietotne drukā / saglabā PDF) ---------- */
const MONTHS = ['janvāris', 'februāris', 'marts', 'aprīlis', 'maijs', 'jūnijs', 'jūlijs', 'augusts', 'septembris', 'oktobris', 'novembris', 'decembris'];
const kindOf = (b) => { const v = String(b || '').trim().toLowerCase(); return v === 'zari' ? 'branches' : v.indexOf('bio') === 0 ? 'bio' : v.indexOf('lielgab') === 0 ? 'bulky' : 'bags'; };
const isVni = (a) => /^\s*VN[ĪI](?![A-Za-zĀ-ž0-9])/i.test(String(a || ''));
export async function reportData(db, year, month) {
  const o = { year, month, groups: { sh: {}, vni: {} }, count: 0, months: [], items: [], speedH: 0, speedN: 0 };
  for (let i = 0; i < 12; i++) o.months.push({ n: 0, bags: 0, branches: 0, bio: 0, bulky: 0, total: 0 });
  for (const t of await all(db, 'SELECT * FROM izv_task WHERE statuss = ? ORDER BY row', ST_DONE)) {
    const d = pd(t.datums); if (!d || d.getUTCFullYear() !== year || (month >= 0 && d.getUTCMonth() !== month)) continue;
    const address = String(t.adrese || '—').trim() || '—', g = o.groups[isVni(address) ? 'vni' : 'sh'];
    const a = g[address] || (g[address] = { n: 0, bags: 0, branches: 0, bio: 0, bulky: 0, total: 0 });
    const v = num(t.m3), k = kindOf(t.maisi), mo = o.months[d.getUTCMonth()];
    a.n++; a[k] += v; a.total += v; mo.n++; mo[k] += v; mo.total += v; o.count++;
    const dn = pd(t.izpildits); if (dn && dn >= d) { o.speedH += (dn - d) / 36e5; o.speedN++; }
    o.items.push({ date: dmy(d), done: dn ? dmy(dn) : '', address, kind: k, m3: v,
      before: String((t.foto_izv_pirms || '') + '\n' + (t.foto_pirms || '')).split(/\s+/).filter(u => /^https?:/.test(u)), after: String(t.foto_pec || '').split(/\s+/).filter(u => /^https?:/.test(u)) });
  }
  return o;
}
function reportHtml(rep) {
  const p0 = parts(), today = p0.day + '.' + p0.month + '.' + p0.year, nowS = stamp();
  const period = rep.month >= 0 ? MONTHS[rep.month].charAt(0).toUpperCase() + MONTHS[rep.month].slice(1) + ' ' + rep.year : rep.year + '. gads';
  const KEYS = ['bags', 'branches', 'bio', 'bulky'];
  const KIND = { bags: { t: 'Lapas', c: '#b7862a', s: '#f4e4b4' }, branches: { t: 'Zari', c: '#8b5a2b', s: '#eee5dc' }, bio: { t: 'Bio', c: '#2f5d45', s: '#d6e8e1' }, bulky: { t: 'Lielgabarīts', c: '#5c6f86', s: '#d8e6f2' } };
  const ACC = '#f4e4b4', INK = '#17201c', INK2 = '#4a534f', MUTED = '#6d7672', LINE = '#dfe5e2', CARD = '#f3f5f4', ZEBRA = '#fafbfa', GOOD = '#2f5d45';
  const FONT = 'Manrope,-apple-system,"Segoe UI",Arial,Helvetica,sans-serif';
  const sum = () => ({ n: 0, bags: 0, branches: 0, bio: 0, bulky: 0, total: 0 });
  const add = (a, o) => { a.n += o.n; KEYS.forEach(k => a[k] += o[k]); a.total += o.total; };
  const pct = (v, max) => max > 0 ? Math.max(v > 0 ? 1.5 : 0, Math.round(v / max * 1000) / 10) : 0;
  const cell_ = (w, color) => '<td width="' + w + '%" style="width:' + w + '%;border-top:6px solid ' + color + ';font-size:1px;line-height:1px;padding:0">&nbsp;</td>';
  const bar = (v, max, color) => { const p = pct(v, max); return '<table class="bar"><tr>' + (p > 0 ? cell_(p, color) : '') + (p < 100 ? cell_(100 - p, '#ffffff') : '') + '</tr></table>'; };
  const dot = c => '<span class="dot" style="color:' + c + '">●</span>';
  const chip = k => '<span class="chip" style="background:' + KIND[k].s + '">' + KIND[k].t + '</span>';
  const card = (title, hint, body) => '<table class="card"><tr><td class="ci">' + (title ? '<div class="ct">' + title + (hint ? ' <span class="ch">' + hint + '</span>' : '') + '</div>' : '') + body + '</td></tr></table>';
  const h2 = (title, hint) => '<div class="h2">' + title + (hint ? ' <span class="ch">' + hint + '</span>' : '') + '</div>';
  const sh = sum(), vni = sum(), grand = sum();
  Object.keys(rep.groups.sh).forEach(a => add(sh, rep.groups.sh[a])); Object.keys(rep.groups.vni).forEach(a => add(vni, rep.groups.vni[a])); add(grand, sh); add(grand, vni);
  const nAddr = Object.keys(rep.groups.sh).length + Object.keys(rep.groups.vni).length;
  const sq = c => '<td style="background:' + c + ';width:10px;height:10px;font-size:1px;line-height:1px;padding:0;border-radius:3px">&nbsp;</td>';
  const logo = '<table class="logo"><tr><td class="lgo"><table class="lgi"><tr>' + sq('#d6e8e1') + '<td class="lgg"></td>' + sq('#f4e4b4') + '</tr><tr><td colspan="3" class="lgh"></td></tr><tr>' + sq('#d8e6f2') + '<td class="lgg"></td>' + sq('#e2ddf2') + '</tr></table></td></tr></table>';
  const head = '<table class="top"><tr><td class="tl">' + logo + '</td><td class="brand"><div class="bn">SELECTUM HOME</div><div class="bs">Izvešanas atskaite · lapas, zari, bio</div></td>' +
    '<td class="tr"><div class="bd">' + today + '</div><div class="bs">' + period + '</div></td></tr></table>' +
    '<table class="band"><tr><td class="sl"><div class="st">Izvešanas atskaite · ' + period + '</div><div class="ss">Izpildītie pieteikumi, pēc pieteikuma datuma</div></td>' +
    '<td class="sr"><span class="big">' + fmt(grand.total) + '</span> <span class="u">m³ izvests</span></td></tr></table>';
  const wrap = (inner) => '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Izvešanas atskaite · ' + period + '</title><style>' +
    '@page{size:A4;margin:14mm}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'body{font-family:' + FONT + ';font-size:11px;line-height:1.35;color:' + INK + ';margin:0;background:#ffffff}' +
    'table{border-collapse:collapse;width:100%}td,th{vertical-align:middle}tr{page-break-inside:avoid;break-inside:avoid}' +
    '.top td{padding:0 0 12px}.tl{width:44px}.logo{width:34px}.top .lgo{background:' + INK + ';width:20px;height:22px;border-radius:9px;padding:6px 7px !important;vertical-align:middle}' +
    '.lgi{width:20px;border-collapse:collapse}.top .lgi td{padding:0 !important}.lgg{width:2px}.top .lgh{height:2px;font-size:1px;line-height:1px}' +
    '.bn{font-size:13px;font-weight:800;letter-spacing:-.02em;color:' + INK + '}.bs{font-size:10px;color:' + MUTED + ';margin-top:1px}.tr{text-align:right}.bd{font-size:12px;font-weight:700;color:' + INK + '}' +
    '.band{background:' + ACC + ';border-radius:14px}.band td{padding:14px 16px}.sl{width:65%}.sr{width:35%;text-align:right;white-space:nowrap}' +
    '.st{font-size:22px;font-weight:800;letter-spacing:-.02em;color:' + INK + '}.ss{font-size:11px;color:' + INK2 + ';margin-top:3px}.big{font-size:24px;font-weight:800;letter-spacing:-.02em;color:' + INK + '}.u{font-size:11px;color:' + INK2 + '}' +
    '.card{background:' + CARD + ';border-radius:12px;margin-top:10px}.ci{padding:12px 14px 13px}.ct{font-size:12.5px;font-weight:800;letter-spacing:-.02em;color:' + INK + ';margin-bottom:8px}' +
    '.ch{font-size:10px;font-weight:400;letter-spacing:0;color:' + MUTED + ';margin-left:6px}.h2{font-size:15px;font-weight:800;letter-spacing:-.02em;color:' + INK + ';margin:4px 0 8px}' +
    '.kpis{margin-top:10px}.kpi{background:' + CARD + ';border-radius:12px;padding:10px 12px 11px;width:18.4%}.gap{width:2%}.kl{font-size:10px;color:' + MUTED + '}' +
    '.kv{font-size:18px;font-weight:800;letter-spacing:-.02em;margin-top:3px;color:' + INK + '}.ku{font-size:10.5px;font-weight:400;letter-spacing:0;color:' + MUTED + '}' +
    '.two td{vertical-align:top}.col7{width:62%}.col5{width:36%}.gap2{width:2%}.kinds td{padding:4px 0;border:0}.kn{width:26%;font-weight:700}.mn{width:18%}.tn{width:44%}' +
    '.kb{padding-right:8px !important}.kb2{padding-right:8px !important}.bar{table-layout:fixed}.bar td{height:6px;padding:0;border:0}' +
    '.kvv{width:17%;text-align:right;font-weight:700;white-space:nowrap}.kp{width:9%;text-align:right;color:' + MUTED + '}.dot{font-size:10px;margin-right:4px}.lg{margin-left:8px}' +
    '.rank{display:inline-block;width:14px;color:' + MUTED + '}.splits td{border:0}.split{padding:6px 0 8px;border-bottom:1px solid ' + LINE + ' !important}.split.last{border-bottom:0 !important}' +
    '.sv{font-size:17px;font-weight:800;letter-spacing:-.02em;margin-top:2px}.sm{font-size:10px;color:' + MUTED + ';margin-top:2px}' +
    '.dt{border-collapse:separate;border-spacing:0;margin-top:2px}.dt th{background:' + INK + ';color:#ffffff;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:7px 7px;text-align:left}' +
    '.dt th.f{border-radius:8px 0 0 8px}.dt th.l{border-radius:0 8px 8px 0}.dt td{font-size:11px;padding:6px 7px;border-bottom:1px solid ' + LINE + '}.dt tr.zb td{background:' + ZEBRA + '}' +
    '.r{text-align:right !important;white-space:nowrap;font-variant-numeric:tabular-nums}.b{font-weight:700}.nw{white-space:nowrap}.z{color:#b9c0bd}.n{color:' + MUTED + ';width:18px;font-size:10px}' +
    'tr.grp td{font-weight:800;font-size:12px;padding:12px 7px 6px;background:#ffffff;border-bottom:1px solid ' + INK + '}.gc{font-weight:400;color:' + MUTED + ';font-size:10px;margin-left:4px}' +
    'tr.sub td{font-weight:700;background:' + CARD + '}tr.tot td{font-weight:800;font-size:12px;background:' + ACC + ';border-bottom:0;padding:9px 7px}' +
    'tr.tot td:first-child{border-radius:8px 0 0 8px}tr.tot td:last-child{border-radius:0 8px 8px 0}tr.tot td.z{color:' + INK2 + '}' +
    '.chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:10px;font-weight:700;color:' + INK + ';white-space:nowrap}.empty{padding:28px;text-align:center;color:' + MUTED + ';font-size:12.5px}' +
    '.foot{margin-top:16px;border-top:1px solid ' + LINE + '}.foot td{padding-top:7px;font-size:9.5px;color:' + MUTED + '}.foot .fr{text-align:right}' +
    '.newpage{page-break-before:always}.pb{height:12px}.ap td{font-size:10.5px;padding:5px 6px}.ap th{font-size:10px}.ph a{color:' + GOOD + ';font-weight:700;text-decoration:none}' +
    '</style></head><body>' + inner + '<table class="foot"><tr><td>SELECTUM HOME · vaitkevix.cloud/sh · Izvešanas atskaite · sagatavots ' + nowS + '</td><td class="fr">© VAITKEVIX, SIA</td></tr></table></body></html>';
  if (!rep.count) return wrap(head + card('', '', '<div class="empty">Šajā periodā nav izpildītu pieteikumu</div>'));
  const kpi = (label, value, unit, accent) => '<td class="kpi"' + (accent ? ' style="background:' + ACC + '"' : '') + '><div class="kl">' + label + '</div><div class="kv">' + value + '<span class="ku">' + (unit ? ' ' + unit : '') + '</span></div></td>';
  const sp = rep.speedN ? rep.speedH / rep.speedN : null;
  const speedTxt = sp == null ? '–' : sp < 24 ? Math.max(1, Math.round(sp)) + ' h' : fmt(Math.round(sp / 24 * 10) / 10) + ' d.';
  const kpis = '<table class="kpis"><tr>' + kpi('Izvests kopā', fmt(grand.total), 'm³', true) + '<td class="gap"></td>' + kpi('Izpildīti pieteikumi', grand.n, '') + '<td class="gap"></td>' +
    kpi('Adreses', nAddr, '') + '<td class="gap"></td>' + kpi('Vidēji uz izvešanu', fmt(grand.n ? grand.total / grand.n : 0), 'm³') + '<td class="gap"></td>' + kpi('Vidēji izved', speedTxt, '') + '</tr></table>';
  const kindRows = KEYS.filter(k => grand[k] > 0 || k !== 'bulky').map(k => { const share = grand.total ? Math.round(grand[k] / grand.total * 100) : 0;
    return '<tr><td class="kn">' + dot(KIND[k].c) + KIND[k].t + '</td><td class="kb">' + bar(grand[k], grand.total, KIND[k].c) + '</td><td class="kvv">' + fmt(grand[k]) + ' m³</td><td class="kp">' + share + '%</td></tr>'; }).join('');
  const split = (title, o, last) => '<tr><td class="split' + (last ? ' last' : '') + '"><div class="kl">' + title + '</div><div class="sv">' + fmt(o.total) + ' <span class="ku">m³</span></div>' +
    '<div class="sm">' + o.n + ' izvešanas · ' + (grand.total ? Math.round(o.total / grand.total * 100) : 0) + '%</div></td></tr>';
  const kindsBlock = '<table class="two"><tr><td class="col7">' + card('Pa veidiem', '', '<table class="kinds">' + kindRows + '</table>') + '</td><td class="gap2"></td>' +
    '<td class="col5">' + card('Pa objektiem', '', '<table class="splits">' + split('SH objekti', sh) + split('VNĪ objekti', vni, true) + '</table>') + '</td></tr></table>';
  let monthsBlock = '';
  if (rep.month < 0) {
    const maxM = Math.max.apply(null, rep.months.map(m => m.total));
    const rows = rep.months.map((m, i) => { if (!m.total && !m.n) return '';
      const segs = KEYS.filter(k => m[k] > 0).map(k => cell_(pct(m[k], maxM), KIND[k].c)).join(''), used = KEYS.reduce((s, k) => s + (m[k] > 0 ? pct(m[k], maxM) : 0), 0);
      return '<tr><td class="mn">' + MONTHS[i].charAt(0).toUpperCase() + MONTHS[i].slice(1) + '</td><td class="kb"><table class="bar"><tr>' + segs + (used < 100 ? cell_(Math.max(0, 100 - used), '#ffffff') : '') + '</tr></table></td>' +
        '<td class="kvv">' + fmt(m.total) + ' m³</td><td class="kp">' + m.n + '×</td></tr>'; }).join('');
    monthsBlock = card('Pa mēnešiem', KEYS.filter(k => grand[k] > 0).map(k => '<span class="lg">' + dot(KIND[k].c) + KIND[k].t + '</span>').join(''), '<table class="kinds">' + rows + '</table>');
  }
  const A = []; ['sh', 'vni'].forEach(gk => Object.keys(rep.groups[gk]).forEach(a => A.push({ a, o: rep.groups[gk][a] }))); A.sort((x, y) => y.o.total - x.o.total);
  const top = A.slice(0, 5), topMax = top.length ? top[0].o.total : 0;
  const topBlock = card('Visvairāk izvests', 'pēc izvestajiem m³', '<table class="kinds">' + top.map((t, i) => '<tr><td class="tn"><span class="rank">' + (i + 1) + '</span>' + esc(t.a) + '</td>' +
    '<td class="kb2">' + bar(t.o.total, topMax, INK) + '</td><td class="kvv">' + fmt(t.o.total) + ' m³</td></tr>').join('') + '</table>');
  const COLK = KEYS.filter(k => k !== 'bulky' || grand.bulky > 0);
  const cells = o => '<td class="r">' + o.n + '</td>' + COLK.map(k => '<td class="r' + (o[k] ? '' : ' z') + '">' + fmt(o[k]) + '</td>').join('') + '<td class="r b">' + fmt(o.total) + '</td>';
  const section = (title, g, s) => { const names = Object.keys(g).sort((a, b) => a.localeCompare(b, 'lv')); if (!names.length) return '';
    return '<tr class="grp"><td colspan="' + (COLK.length + 4) + '">' + title + ' <span class="gc">' + names.length + (names.length === 1 ? ' adrese' : ' adreses') + '</span></td></tr>' +
      names.map((name, i) => '<tr class="' + (i % 2 ? 'zb' : '') + '"><td class="n">' + (i + 1) + '</td><td>' + esc(name) + '</td>' + cells(g[name]) + '</tr>').join('') +
      '<tr class="sub"><td></td><td>Kopā ' + title + '</td>' + cells(s) + '</tr>'; };
  const table = '<div class="pb"></div>' + h2('Pa adresēm', nAddr + (nAddr === 1 ? ' adrese' : ' adreses')) + '<table class="dt"><thead><tr><th class="f"></th><th>Adrese</th><th class="r">Reizes</th>' +
    COLK.map(k => '<th class="r">' + KIND[k].t + '</th>').join('') + '<th class="r l">Kopā m³</th></tr></thead><tbody>' + section('SH objekti', rep.groups.sh, sh) + section('VNĪ objekti', rep.groups.vni, vni) +
    '<tr class="tot"><td></td><td>Pavisam kopā</td>' + cells(grand) + '</tr></tbody></table>';
  const links = (arr, label) => arr.map((u, i) => '<a href="' + esc(u) + '">' + label + (arr.length > 1 ? ' ' + (i + 1) : '') + '</a>').join(' ');
  const pk = d => { const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(d); return m ? m[3] + m[2] + m[1] : d; };
  const items = rep.items.slice().sort((a, b) => pk(a.date) < pk(b.date) ? -1 : pk(a.date) > pk(b.date) ? 1 : 0);
  const appendix = '<div class="newpage"></div>' + h2('Izpildītie pieteikumi ar bildēm', items.length + ' pieteikumi · saites atver bildes') +
    '<table class="dt ap"><thead><tr><th class="f"></th><th>Pieteikts</th><th>Izpildīts</th><th>Adrese</th><th>Veids</th><th class="r">m³</th><th class="l">Bildes</th></tr></thead><tbody>' +
    items.map((it, i) => '<tr class="' + (i % 2 ? 'zb' : '') + '"><td class="n">' + (i + 1) + '</td><td class="nw">' + esc(it.date) + '</td><td class="nw">' + (esc(it.done) || '<span class="z">–</span>') + '</td><td>' + esc(it.address) + '</td>' +
      '<td>' + chip(it.kind) + '</td><td class="r b">' + fmt(it.m3) + '</td><td class="ph">' + (links(it.before, 'Pirms') || '<span class="z">nav pirms</span>') + ' &nbsp; ' + (links(it.after, 'Pēc') || '<span class="z">nav pēc</span>') + '</td></tr>').join('') + '</tbody></table>';
  return wrap(head + kpis + kindsBlock + monthsBlock + topBlock + table + appendix);
}
export async function reportPdf(db, year, month) {
  year = parseInt(year, 10); month = (month === '' || month == null) ? -1 : parseInt(month, 10);
  if (!year) return fail('Nav norādīts gads');
  if (isNaN(month) || month < -1 || month > 11) month = -1;
  const rep = await reportData(db, year, month);
  return { status: 'success', name: 'Izvesanas_atskaite_' + year + (month >= 0 ? '-' + ('0' + (month + 1)).slice(-2) : '') + '.pdf', html: reportHtml(rep), count: rep.count };
}

/* ---------- AI ---------- */
function matchAddr(a, list) {
  const n = x => String(x || '').toLowerCase().replace(/^(j|vnī) ?\| ?|^(kk|ir|ee) /, '').replace(/\s+/g, ' ').trim();
  const q = n(a); if (!q) return '';
  const ex = list.find(x => n(x) === q); if (ex) return ex;
  const m = /^(.*?\D)\s(\d+[a-z]?(?:\s?k-\d+)?)$/.exec(q);
  const hits = list.filter(x => { const e = n(x); if (e.indexOf(q) === 0) return true; if (!m || e.indexOf(m[1]) < 0) return false; return e.split(/[,/]/).some(part => part.trim().replace(m[1], '').trim() === m[2]); });
  return hits.length === 1 ? hits[0] : '';
}
const aiErr = (e) => ({ status: 'error', message: String(e && e.message || e) });
async function photoData(env, url) {
  const m = /[?&]id=([\w-]{20,80})/.exec(url) || /\/d\/([\w-]{20,80})/.exec(url); if (!m) return null;
  const id = m[1]; let o = env.FOTO && await env.FOTO.get(id.startsWith('r2-') ? id : F.driveKey(id)), buf, ct;
  if (o) { buf = await o.arrayBuffer(); ct = (o.httpMetadata && o.httpMetadata.contentType) || 'image/jpeg'; }
  else { const g = await fetch('https://drive.google.com/thumbnail?id=' + id + '&sz=w1600', { redirect: 'follow' }); if (!g.ok) return null; buf = await g.arrayBuffer(); ct = g.headers.get('content-type') || 'image/jpeg'; }
  if (buf.byteLength > 4e6) return 'big';
  let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return 'data:' + ct + ';base64,' + btoa(s);
}
export async function ai(env, fn, a, me) {
  const db = env.DB;
  try {
    await AI.aiLimit(db, 'izv', AI_DAILY);
    if (fn === 'aiParseMessage') {
      const text = String(a[0] || '').trim().slice(0, 2000); if (!text) return aiErr('Nav teksta');
      const L = await getInitialData(env);
      const prompt = 'No šīs ziņas izveido izvešanas pieteikumu.\n\nZIŅA:\n' + text + '\n\nADREŠU SARAKSTS (izvēlies tieši vienu no šiem vai ""):\n' + L.addresses.join('\n') + '\n\n' +
        'PASŪTĪTĀJI (izvēlies vienu no šiem vai ""):\n' + L.people.join('\n') + '\n\n' +
        'Atbildi TIKAI ar JSON: {"address":"", "requester":"", "kind":"bags|branches|bio", "bags":"skaitlis vai \\"\\"", "urgent":true/false, "comment":"īss komentārs latviski ar pārējo informāciju (vieta, piekļuve), bez adreses un daudzuma"}. ' +
        'kind: bags = lapas maisos, branches = zari, bio = dārzniecības bioatkritumi (zāle, ziedi). Ja adrese ziņā rakstīta saīsināti, atrodi atbilstošo no saraksta.';
      const j = AI.aiJson(await AI.aiContent(env, prompt, 3000)); if (!j) return aiErr('AI nesaprata ziņu');
      j.address = matchAddr(j.address, L.addresses); if (L.people.indexOf(j.requester) < 0) j.requester = ''; if (['bags', 'branches', 'bio'].indexOf(j.kind) < 0) j.kind = 'bags';
      return { status: 'success', data: j };
    }
    if (fn === 'aiCheckPhoto') {
      const prompt = 'Šī ir bilde izvešanas pieteikumam (kas jāizved). Atbildi TIKAI ar JSON: {"kind":"bags|branches|bio|bulky|other", "ok":true/false, "note":"ja ok=false, īsi latviski kāpēc (piem., izplūdusi, tumša, nav redzami atkritumi)"}. ' +
        'bags = lapas maisos, branches = koku zari, bio = zāle/ziedi/dārza atkritumi, bulky = mēbeles, tehnika.';
      const j = AI.aiJson(await AI.aiContent(env, [AI.imgPart(a[0]), { type: 'text', text: prompt }], 3000)); if (!j) return aiErr('AI neatbildēja');
      return { status: 'success', data: { kind: String(j.kind || ''), ok: j.ok !== false, note: String(j.note || '') } };
    }
    if (fn === 'aiCompare') {
      const d = a[0] || {}; if (!await login(db, d.pin, me)) return { status: 'error', code: 'pin', message: 'Nepareiza parole' };
      const t = await byId(db, d.id); if (!t) return aiErr('Pieteikums nav atrasts');
      const first = String(t.foto_pirms || '').split(/\s+/).filter(Boolean)[0] || '';
      const own = /^data:image\/[\w.+-]+;base64,/.test(String(d.before || '')) && String(d.before).length < 1500000 ? d.before : null;   // izvedēja bilde «pirms savākšanas»
      const before = own || (first ? await photoData(env, first) : null);
      if (!before) return { status: 'success', data: { clean: null, note: 'Nav bildes "pirms", ar ko salīdzināt' } };
      if (before === 'big') return { status: 'success', data: { clean: null, note: 'Bilde "pirms" par lielu salīdzināšanai' } };
      const prompt = 'Pirmā bilde: atkritumi PIRMS izvešanas. Otrā bilde: tā pati vieta PĒC izvešanas. Vai atkritumi ir izvesti? Atbildi TIKAI ar JSON: {"clean":true/false, "note":"ļoti īsi latviski, ko redzi"}. ' +
        'Ja bildes nav no vienas vietas, clean=false un note to pasaka.';
      const j = AI.aiJson(await AI.aiContent(env, [AI.imgPart(before), AI.imgPart(d.after), { type: 'text', text: prompt }], 3000)); if (!j) return aiErr('AI neatbildēja');
      return { status: 'success', data: { clean: j.clean !== false, note: String(j.note || '') } };
    }
    if (fn === 'aiAsk') {
      const question = String(a[0] || '').trim().slice(0, 400); if (!question) return aiErr('Nav jautājuma');
      const KN = { bags: 'lapas', branches: 'zari', bio: 'bio', bulky: 'lielgabarīts' }, agg = {}, mon = {};
      (await getTasks(db)).forEach(t => { const m = /(\d\d)\.(\d\d)\.(\d{4})/.exec(String(t.date)); if (!m) return;
        const ym = m[3] + '-' + m[2], k = KN[kindOf(t.bagsEst)], key = ym + '|' + t.address + '|' + k;
        const o = agg[key] || (agg[key] = { n: 0, done: 0, m3: 0, open: 0, prob: 0 }), M = mon[ym] || (mon[ym] = { n: 0, done: 0, m3: 0, open: 0 });
        o.n++; M.n++; if (t.status === ST_DONE) { o.done++; M.done++; o.m3 += num(t.m3Hauled); M.m3 += num(t.m3Hauled); } else if (t.status === ST_PENDING) { o.open++; M.open++; } if (t.problem) o.prob++; });
      const r1 = x => Math.round(x * 10) / 10, p = parts();
      const monLines = Object.keys(mon).sort().map(ym => ym + ': ' + mon[ym].n + ' pieteikumi, ' + mon[ym].done + ' izpildīti, ' + r1(mon[ym].m3) + ' m3, ' + mon[ym].open + ' neizpildīti');
      const rows = Object.keys(agg).sort().map(key => { const o = agg[key]; return key.split('|').join(';') + ';' + o.n + ';' + o.done + ';' + r1(o.m3) + ';' + o.open + (o.prob ? ';nevarēja izvest ' + o.prob : ''); });
      const system = 'Tu atbildi uz jautājumiem par izvešanas pieteikumu datiem. Atbildi latviski, īsi (līdz 6 teikumiem), ar konkrētiem skaitļiem. Šodien ir ' + p.day + '.' + p.month + '.' + p.year + '. Ja datos atbildes nav, pasaki to.';
      const prompt = 'KOPĀ PA MĒNEŠIEM:\n' + monLines.join('\n') + '\n\nPA MĒNEŠIEM UN ADRESĒM (mēnesis;adrese;veids;pieteikumi;izpildīti;izvestie m3;neizpildīti):\n' + rows.join('\n') + '\n\nJAUTĀJUMS: ' + question;
      return { status: 'success', text: await AI.aiContent(env, prompt, 6000, system) };
    }
    if (fn === 'aiMonthSummary') {
      const year = Number(a[0]), month = Number(a[1]), d = await reportData(db, year, month), lines = [];
      ['sh', 'vni'].forEach(g => Object.keys(d.groups[g]).forEach(x => { const o = d.groups[g][x]; lines.push(x + ': ' + o.n + ' izvešanas, ' + Math.round(o.total * 10) / 10 + ' m3 (lapas ' + o.bags + ', zari ' + o.branches + ', bio ' + o.bio + ')'); }));
      const prompt = 'Periods: ' + (month >= 0 ? (month + 1) + '. mēnesis ' : '') + year + '. gads. Izpildīti ' + d.count + ' pieteikumi. Vidējais laiks līdz izvešanai: ' + (d.speedN ? Math.round(d.speedH / d.speedN) + ' h' : 'nav datu') + '.\n' +
        'Pa adresēm:\n' + lines.join('\n') + '\n\nUzraksti īsu kopsavilkumu latviski (4–6 teikumi) vadībai: kopējais apjoms, kuras adreses lielākās, veidu sadalījums, ātrums, kas būtu jāpievērš uzmanība. Bez virsrakstiem un saraksta zīmēm.';
      return { status: 'success', text: await AI.aiContent(env, prompt, 6000) };
    }
  } catch (e) { return aiErr(e); }
  return aiErr('Nezināma darbība');
}

/* ---------- /izv?fn=… ---------- */
export async function handle(env, fn, a, me) {
  const db = env.DB; a = Array.isArray(a) ? a : [];
  switch (fn) {
    case 'getBoot': return { lists: await getInitialData(env), tasks: await getTasks(db) };
    case 'getTasks': return await getTasks(db);
    case 'getInitialData': return await getInitialData(env);
    case 'saveTask': return await saveTask(env, a[0]);
    case 'updateTask': return await updateTask(env, a[0]);
    case 'setTaskCancelled': return await setTaskCancelled(env, a[0], a[1]);
    case 'getAccess': return await getAccess(db, a[0], me);
    case 'checkCarrierPin': return await checkCarrierPin(db, a[0], me);
    case 'portalCarrier': { const pc = portalCarrier(me); return pc ? { name: pc.sia || pc.admin } : null; }
    case 'completeTask': return await completeTask(env, a[0], me);
    case 'reportProblem': return await reportProblem(env, a[0], me);
    case 'reportPdf': return await reportPdf(db, a[0], a[1]);
    case 'geocodeAddresses': return await geocodeAddresses(db, a[0]);
    case 'saveFileToDrive': return await savePhotos(env, a[0], 'izv', 'bilde');
  }
  if (/^ai/.test(fn)) return await ai(env, fn, a, me);
  return undefined;
}

/* ---------- vienreizējs imports no «Izvešana · Pieteikumi» (A–W) + pārslēgšana (kv izv:switch = '1') ---------- */
export async function imports(env) {
  const v = await G.read(env, TAB, 'A1:W'), db = env.DB, st = [];
  const have = new Set((await all(db, 'SELECT id FROM izv_task')).map(r => r.id));
  v.forEach((r, i) => { const id = String(r[0] || '').trim(); if (!i || !id || have.has(id)) return; have.add(id); const s = (k) => String(r[k] == null ? '' : r[k]);
    st.push(db.prepare('INSERT OR IGNORE INTO izv_task (id, row, datums, adrese, pasutitajs, maisi, komentars, foto_pirms, statuss, sia, foto_pec, m3, izv_kom, izmaksas, starpsumma, bez_pvn, ar_pvn, izpildits, steidzami, termins, problema, vesture, maisi_izv, koef) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, i + 1, s(1), s(2), s(3), s(4), s(5), s(6), s(7) || ST_PENDING, s(8), s(9), s(10), s(11), s(12), s(13), s(14), s(15), s(16), isYes(r[17]) ? 1 : 0, s(18), s(19), s(20), s(21), s(22))); });
  for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
  await cache(env);
  return { lapa: v.length - 1, ievesti: st.length };
}
export async function maybeSwitch(env) {
  const db = env.DB;
  if ((await kvGet(db, 'izv:switch')) !== '1' || await isNative(env) || !env.GOOGLE_SA) return;
  const q = await db.prepare("SELECT COUNT(*) n FROM izv_q WHERE part = 0 AND fn NOT LIKE '%|%' AND err = ''").first();
  if (q && q.n) { await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('izv:switchLog', ?)").bind('gaida rindu: ' + q.n).run(); return; }
  const r = await imports(env);
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('izv:native', '1'), ('izv:switch', 'done'), ('izv:switchLog', ?)").bind(new Date().toISOString() + ' ' + JSON.stringify(r)).run();
}
