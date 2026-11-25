// SH | Budžets — bez Apps Script: tāmes D1 (budz_*), e-pasts Cloudflare (mail.js), AI Worker. PDF/Excel veido lietotne pārlūkā.
// Ieslēdz kv «budz:native» = '1' (pēc imports()). Darbības un atbildes — tādas pašas kā vecajam GAS. © VAITKEVIX, SIA
import * as G from './sheets.js';
import * as M from './mail.js';
import { personByPin, people } from './portal.js';

const APP_URL = 'https://vaitkevix.cloud/sh/#budz';
const STATUSES = ['Melnraksts', 'Iesniegts', 'Apstiprināts', 'Noraidīts', 'Arhivēts'];
const DEF_SET = { 'Vadības e-pasti': '', 'Sūtīt paziņojumus': 'jā', 'Sūtītāja vārds': 'SH | Budžets' };
const SERIJAS = { pirmskara: 'Pirmskara ēka', koka: 'Koka māja', stalina: 'Staļina laika ēka', '316': '316. sērija', '318': '318. sērija', '464': '464. sērija',
  lt_vecais: 'Lietuviešu vecais projekts', lt_jaunais: 'Lietuviešu jaunais projekts', lt: 'Lietuviešu projekts', '103': '103. sērija', '467': '467. sērija', '602': '602. sērija',
  '602u': '602. uzlabotā sērija', '119': '119. sērija', '104': '104. sērija', mazgim: 'Mazģimeņu projekts', cehu: 'Čehu projekts', franc: 'Franču projekts',
  brezn: 'Brežņeva laika projekts', spec: 'Specprojekts', jauns: 'Jaunais projekts', cits: 'Cits' };
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const kvGet = async (db, k) => { const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first(); return r ? r.v : null; };
export const isNative = async (env) => (await kvGet(env.DB, 'budz:native')) === '1';

const P = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d || new Date()).map(x => [x.type, x.value]));
const now = () => { const p = P(); return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second; };
const norm = (s) => String(s || '').trim().toLowerCase();
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (x) => { const n = r2(x), s = Math.abs(n).toFixed(2).split('.'); s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' '); return (n < 0 ? '−' : '') + '€' + s[0] + ',' + s[1]; };
const pct = (x, d) => (Math.round((Number(x) || 0) * 1000) / 10).toFixed(d == null ? 1 : d).replace('.', ',').replace(/,0$/, '') + '%';
const num = (x, d) => (Number(x) || 0).toFixed(d || 0).replace('.', ',');
const lvDate = (iso) => { if (!iso) return ''; const p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : iso; };
const serijaName = (k) => k ? (SERIJAS[k] || String(k)) : '—';
const copy = () => '© ' + P().year + ' VAITKEVIX, SIA. Visas tiesības aizsargātas.';
const isMgmt = (u) => u.role === 'vadība' || u.role === 'admin';
const isMaker = (u) => u.role === 'gatavotājs' || u.role === 'admin';

async function settings(db) { let o = {}; try { o = JSON.parse((await kvGet(db, 'budz:settings')) || '{}'); } catch (e) {} return Object.assign({}, DEF_SET, o); }
const listOf = (v) => String(v || '').split(/[,;\s]+/).map(x => x.trim()).filter(M.valid);
async function log(db, user, action, id, info) { try { await db.prepare('INSERT INTO budz_log (laiks, lietotajs, darbiba, budzets, info) VALUES (?, ?, ?, ?, ?)').bind(now(), user || '', action, id || '', String(info || '').slice(0, 500)).run(); } catch (e) {} }

/** PIN → { name, role, email, viewer } (kā GAS centralUser_; skatītājs = admins bez saglabāšanas) */
async function auth(db, pin) {
  const p = await personByPin(db, pin); if (!p) return null;
  const r = (p.perms || {}).budz || ''; if (!r) return { none: true };
  return { name: p.name, role: r === 'skatitajs' ? 'admin' : r, email: p.email || '', viewer: r === 'skatitajs' };
}

const meta = (b) => ({ id: b.id, nosaukums: b.nosaukums, adrese: b.adrese, pasutitajs: b.pasutitajs, izpilditajs: b.izpilditajs, sagatavots: b.sagatavots, derigs: b.derigs,
  autors: b.autors, statuss: b.statuss, bezPVN: Number(b.bez_pvn) || 0, arPVN: Number(b.ar_pvn) || 0, versija: Number(b.versija) || 1, izveidots: b.izveidots, atjaunots: b.atjaunots,
  komentars: b.komentars, izskatija: b.izskatija, plat: Number(b.plat) || 0, serija: b.serija || '', perM2: Number(b.plat) > 0 ? r2(Number(b.bez_pvn) / Number(b.plat) * 100) / 100 : null });
const canSee = (u, m) => isMgmt(u) || norm(m.autors) === norm(u.name);
const row = (db, id) => db.prepare("SELECT * FROM budz_budget WHERE id = ? AND statuss != 'Dzēsts'").bind(String(id || '')).first();

/* ---------- e-pasts ---------- */
const wrap = (inner) => `<div style="font-family:Manrope,-apple-system,'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;color:#17201c;max-width:560px">
    <div style="background:#e2ddf2;padding:14px 18px;border-radius:14px 14px 0 0;font-weight:800;font-size:16px;letter-spacing:-.02em">SELECTUM HOME <span style="font-weight:600;color:#4a534f">· Budžets</span></div>
    <div style="background:#ffffff;border:1px solid #dfe5e2;border-top:0;padding:18px;border-radius:0 0 14px 14px">${inner}
    <p style="margin-top:18px"><a href="${APP_URL}" style="background:#17201c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:700">Atvērt SH | Budžets</a></p></div>
    <p style="color:#6d7672;font-size:11px;margin-top:10px">SELECTUM HOME · vaitkevix.cloud/sh · ${copy()}</p></div>`;
const fileName = (d, m) => { const o = (d && d.objekts) || {}; return ('Tāme ' + (o.nosaukums || o.adrese || (m && m.id) || 'budžets')).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90); };
async function mailBudget(env, u, m, d, c, to, kind, note, pdfB64) {
  to = (to || []).filter(Boolean);
  if (!to.length) throw new Error('Nav e-pasta adreses (Budžets → Iestatījumi → Vadības e-pasti).');
  const o = (d && d.objekts) || {}, nos = o.nosaukums || o.adrese || m.id || 'Budžets', S = await settings(env.DB);
  const tr = (k, v, big) => `<tr><td style="padding:6px 0;border-bottom:1px solid #dfe5e2;color:#6d7672">${k}</td><td style="padding:6px 0;border-bottom:1px solid #dfe5e2;text-align:right${big ? ';font-size:18px' : ''}">${v}</td></tr>`;
  const inner = `<p>${kind === 'iesniegts' ? `<b>${esc(u.name)}</b> iesniedza budžetu izskatīšanai.` : `<b>${esc(u.name)}</b> nosūtīja budžetu.`}</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${tr('Objekts', '<b>' + esc(nos) + '</b>')}${tr('Adrese', esc(o.adrese || '—'))}${tr('Budžets', esc(m.id || '') + (m.versija ? ' · v' + m.versija : ''))}
    ${tr('Cena mēnesī bez PVN', '<b>' + eur(c.bezPVN) + '</b>', 1)}${c.perM2bez != null ? tr('€ / dzīvokļu m²', '€' + num(c.perM2bez, 4)) : ''}</table>
    ${note ? `<p style="background:#f3f5f4;padding:10px 12px;border-radius:12px">Piezīme: ${esc(note)}</p>` : ''}${pdfB64 ? '<p style="color:#6d7672">Tāme ar pielikumiem — PDF failā.</p>' : ''}`;
  const r = await M.send(env, { to, subject: (kind === 'iesniegts' ? 'Iesniegts budžets: ' : 'Budžets: ') + nos + ' — ' + eur(c.bezPVN) + '/mēn. bez PVN', html: wrap(inner),
    fromName: S['Sūtītāja vārds'] || 'SH | Budžets', replyTo: u.email, attachments: pdfB64 ? [{ name: fileName(d, m) + '.pdf', mime: 'application/pdf', b64: pdfB64 }] : [] });
  await log(env.DB, u.name, 'E-pasts', m.id || '', r.sent.join(', ') + (r.failed.length ? ' · neizdevās: ' + r.failed.map(x => x.to).join(', ') : ''));
  if (!r.sent.length) throw new Error('E-pasts netika nosūtīts: ' + r.failed.map(x => x.to + ' (' + x.error + ')').join('; '));
  return r.sent.concat(r.failed.map(x => 'KĻŪDA: ' + x.to));
}

/** Īsts PDF ar Cloudflare Browser Rendering (binding BROWSER) — vienāds visos pārlūkos. Ja nav pieejams → '' (lietotne taisa PDF pati). */
async function serverPdf(env, html) {
  if (!env.BROWSER) return '';
  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  const br = await puppeteer.launch(env.BROWSER);
  try {
    const pg = await br.newPage();
    await pg.setContent(html, { waitUntil: 'load', timeout: 20000 });
    const pdf = await pg.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: 20000 });
    let s = ''; const u8 = new Uint8Array(pdf); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  } finally { await br.close().catch(() => {}); }
}

/* ---------- PDF HTML (tas pats, kas GAS pdfHtml_; lietotne to pārvērš PDF) ---------- */
function pdfHtml(d, c, m) {
  const o = d.objekts || {}, prm = d.param || {};
  const INK = '#17201c', INK2 = '#4a534f', MUTE = '#6d7672', LINE = '#dfe5e2', SOFT = '#f3f5f4', ACC = '#e2ddf2', BAD = '#8a2a3b', GOOD = '#2f5d45';
  const css = `@page{size:A4;margin:14mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Manrope,-apple-system,"Segoe UI",Arial,Helvetica,sans-serif;color:${INK};font-size:11.5px;line-height:1.4;margin:0}
  table{border-collapse:separate;border-spacing:0;width:100%}tr{page-break-inside:avoid;break-inside:avoid}.hd td{vertical-align:middle;border:0;padding:0}
  .logo{width:34px;height:34px;background:${INK};border-radius:9px;padding:6px;box-sizing:border-box}.logo table{width:22px;border-spacing:2px;border-collapse:separate}
  .logo td{width:9px;height:9px;border-radius:3px;padding:0;font-size:1px;line-height:1px}.brand{font-weight:800;font-size:13px;letter-spacing:-.01em;color:${INK}}
  .kind{color:${MUTE};font-size:10.5px}.when{text-align:right;color:${INK2};font-size:10.5px}.when b{color:${INK};font-weight:800}
  .band{background:${ACC};border-radius:14px;padding:16px 18px;margin:12px 0 14px}h1{font-size:24px;font-weight:800;letter-spacing:-.02em;margin:0 0 4px;color:${INK}}
  .band .sub{color:${INK2};font-size:11px}h2{font-size:15px;font-weight:800;letter-spacing:-.02em;margin:18px 0 8px;color:${INK}}
  .card{background:${SOFT};border-radius:12px;padding:12px 14px;vertical-align:top}.card .cap{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${MUTE};margin-bottom:6px}
  .kv td{padding:4px 0;border-bottom:1px solid ${LINE};font-size:11.5px}.kv tr.last td{border-bottom:0}.kv td.k{color:${MUTE}}.kv td.v{text-align:right;font-weight:600}
  .big{font-size:22px;font-weight:800;letter-spacing:-.02em;color:${INK}}
  .t th{background:${INK};color:#fff;text-align:left;padding:7px 8px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.t th.f{border-radius:8px 0 0 8px}.t th.l{border-radius:0 8px 8px 0}
  .t td{padding:6px 8px;border-bottom:1px solid ${LINE};font-size:11px}.t tr.z td{background:#fafbfa}.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.t th.r,.t td.r{text-align:right}
  .muted{color:${MUTE}}.t tr.tot td{background:${SOFT};font-weight:800}.t tr.grand td{background:${ACC};font-weight:800;font-size:12.5px;border-bottom:0}
  .note{margin-top:12px;color:${INK2};font-size:10.5px}.chip{display:inline-block;border-radius:999px;padding:1px 8px;font-weight:700;font-size:10px}.pb{page-break-before:always}
  .ft{margin-top:18px;border-top:1px solid ${LINE}}.ft td{padding-top:6px;color:${MUTE};font-size:9.5px;border:0}`;
  const zebra = (i) => i % 2 ? ' class="z"' : '';
  const kv = (rows) => rows.map((r, i) => `<tr${i === rows.length - 1 ? ' class="last"' : ''}><td class="k">${r[0]}</td><td class="v">${r[1]}</td></tr>`).join('');
  const objRows = kv([['Nosaukums', o.nosaukums], ['Adrese', o.adrese], ['Pasūtītājs', o.pasutitajs], ['Ēkas sērija', serijaName(o.serija) + (o.gads ? ' · ' + o.gads + '. g.' : '') + (o.stavi ? ' · ' + o.stavi + ' st.' : '')],
    ['Sagatavots', lvDate(o.sagatavots)], ['Izpildītājs', o.izpilditajs], ['Dzīvokļi / dzīvokļu m²', (o.dzivokli || '—') + ' / ' + (o.lietderiga ? num(o.lietderiga, 1) : '—')]].map(r => [esc(r[0]), esc(r[1] || '')]));
  const resRows = kv([['Cena mēnesī bez PVN', `<span class="big">${eur(c.bezPVN)}</span>`], ['Cena gadā bez PVN', `<b>${eur(c.bezPVN * 12)}</b>`],
    ['Uzk. izd. = € / dzīvokļu m² bez PVN', `<b>${c.perM2bez == null ? '—' : '€' + num(c.perM2bez, 4)}</b>`], ['Cena mēnesī ar PVN (' + pct(prm.pvn, 0) + ')', eur(c.arPVN)]]);
  const lines = (c.lines || []).map((l, i) => `<tr class="${l.total ? 'grand' : (l.bold ? 'tot' : (i % 2 ? 'z' : ''))}"><td class="muted">${esc(l.nr || '')}</td><td>${esc(l.name)}</td>
      <td class="r">${eur(l.men)}</td><td class="r">${eur(l.gada)}</td><td class="r">${l.dala == null ? '' : pct(l.dala)}</td></tr>`).join('');
  const darbi = (c.darbi || []).map((x, i) => `<tr${zebra(i)}><td>${esc(x.nosaukums)}</td><td>${esc(x.izp)}</td><td class="r">${num(x.area)}</td><td class="r">${num(x.reizes, 2)}</td><td class="r">${num(x.raziba)}</td>
      <td class="r">${num(x.h, 1)}</td><td class="r">${eur(x.cost)}</td></tr>`).join('');
  const sez = (c.sezon || []).map((x, i) => `<tr${zebra(i)}><td>${esc(x.nosaukums)}</td><td class="r">${num(x.area)}</td><td class="r">${num(x.cena, 3)}</td><td class="r">${num(x.reizes)}</td><td class="r">${eur(x.gada)}</td>
      <td class="r">${eur(x.men)}</td></tr>`).join('');
  const invRows = [].concat((d.invIek || []).filter(x => x.on).map(x => ['Iekštelpas', x]), (d.invPag || []).filter(x => x.on).map(x => ['Pagalms', x]))
    .map((a, i) => `<tr${zebra(i)}><td class="muted">${a[0]}</td><td>${esc(a[1].nosaukums)}</td><td class="muted">${esc(a[1].apraksts || '')}</td><td class="r">${eur(a[1].cena)}</td></tr>`).join('');
  const th = (cols) => '<tr>' + cols.map((h, i) => `<th class="${[i === 0 ? 'f' : '', i === cols.length - 1 ? 'l' : '', h[1] ? 'r' : ''].join(' ').trim()}">${h[0]}</th>`).join('') + '</tr>';
  const sq = (col) => `<td style="background:${col}">&nbsp;</td>`;
  const idTxt = m.id ? esc(m.id) + (m.versija ? ' · v' + m.versija : '') : '';
  const head = (kind) => `<table class="hd"><tr><td style="width:44px"><div class="logo"><table><tr>${sq('#d6e8e1')}${sq('#f4e4b4')}</tr><tr>${sq('#d8e6f2')}${sq('#e2ddf2')}</tr></table></div></td>
    <td><div class="brand">SELECTUM HOME</div><div class="kind">${kind}</div></td><td class="when">${o.sagatavots ? 'Sagatavots <b>' + esc(lvDate(o.sagatavots)) + '</b>' : ''}${idTxt ? '<br>' + idTxt : ''}</td></tr></table>`;
  const foot = `<table class="ft"><tr><td>SELECTUM HOME · vaitkevix.cloud/sh</td><td style="text-align:right">${copy()}</td></tr></table>`;
  const minChip = c.minOk ? `<span class="chip" style="background:#d6e8e1;color:${GOOD}">atbilst</span>` : `<span class="chip" style="background:#f5dbe3;color:${BAD}">ZEM MINIMĀLĀS ALGAS</span>`;
  return `<html><head><meta charset="utf-8"><title>${esc(fileName(d, m))}</title><style>${css}</style></head><body>${head('Budžets · uzkopšanas tāme')}
  <div class="band"><h1>Sanitārās apkopes tāme</h1><div class="sub">Struktūra atbilst MK noteikumu Nr. 408 tāmes pozīcijai «1.1. Dzīvojamās mājas sanitārā apkope».${m.id ? ' · ' + esc(m.id) + (m.versija ? ' (v' + m.versija + ')' : '') : ''}</div></div>
  <table><tr><td class="card" style="width:50%"><div class="cap">Objekts</div><table class="kv">${objRows}</table></td><td style="width:12px;padding:0;border:0"></td>
  <td class="card"><div class="cap">Rezultāts</div><table class="kv">${resRows}</table></td></tr></table>
  <h2>Tāme</h2><table class="t">${th([['Nr.'], ['Pozīcija (MK 408 — 1.1. Sanitārā apkope)'], ['Mēnesī', 1], ['Gadā', 1], ['Daļa', 1]])}${lines}</table>
  <div class="note">Pilnā stundas cena: apkopēja ${eur(c.fullA)}, sētnieks ${eur(c.fullS)} (ar atvaļinājuma rezervi un VSAOI). Neproduktīvais laiks ${pct(prm.neprod, 0)}. Minimālās algas pārbaude: ${minChip}.</div>${foot}
  <div class="pb"></div>${head('Budžets · tāmes pielikumi')}<h2>Pielikums 1 — Regulārie darbi</h2>
  <table class="t">${th([['Darbs'], ['Izpildītājs'], ['m²', 1], ['Reizes/mēn.', 1], ['m²/h', 1], ['h/mēn.', 1], ['€/mēn.', 1]])}${darbi}
  <tr class="tot"><td colspan="5">Kopā</td><td class="r">${num((c.hA || 0) + (c.hS || 0), 1)}</td><td class="r">${eur(c.darbiCost)}</td></tr></table>
  <h2>Pielikums 2 — Sezonālie darbi</h2><table class="t">${th([['Darbs'], ['Platība', 1], ['Cena reizē', 1], ['Reizes gadā', 1], ['Gadā', 1], ['Mēnesī', 1]])}${sez}
  <tr class="tot"><td colspan="4">Kopā</td><td class="r">${eur(c.sezonGada)}</td><td class="r">${eur(c.sezonMen)}</td></tr></table>
  <h2>Pielikums 3 — Inventārs</h2><table class="t">${th([['Grupa'], ['Pozīcija'], ['Apraksts'], ['Cena', 1]])}${invRows}
  <tr class="tot"><td colspan="3">Kopā (nolietojums ${prm.invMen} mēn. → ${eur(c.inv)} mēnesī)</td><td class="r">${eur(c.invTotal)}</td></tr></table>${foot}</body></html>`;
}

/* ---------- AI (tie paši prompti/shēmas kā GAS) ---------- */
async function aiTool(env, system, prompt, schema, maxTokens) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('AI nav iestatīts');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.AI_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens, system, tools: [{ name: 'aizpildit_formu', description: 'Aizpilda tāmes formu ar datiem no kadastra teksta.', input_schema: schema }],
      tool_choice: { type: 'tool', name: 'aizpildit_formu' }, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('AI kļūda: ' + ((j.error && j.error.message) || r.status));
  const tu = (j.content || []).find(c => c.type === 'tool_use'); if (!tu) throw new Error('AI neatgrieza datus.');
  return tu.input || {};
}
async function aiKadastrs(env, u, text) {
  text = String(text || '').trim(); if (text.length < 20) throw new Error('Ielīmē kadastra datus (vismaz dažas rindas).'); if (text.length > 30000) text = text.slice(0, 30000);
  const N = { type: ['number', 'null'] }, D = (d) => Object.assign({ description: d }, N);
  const schema = { type: 'object', properties: {
    nosaukums: { type: ['string', 'null'], description: 'Īsa adrese + dzīvokļu skaits, piem. "Kvēles 24 (60 dzīvokļi)"; ja dzīvokļu skaits nav zināms — tikai īsā adrese' },
    adrese: { type: ['string', 'null'], description: 'Pilna adrese bez pasta indeksa, piem. "Kvēles iela 24, Rīga"' },
    dzivokli: D('Dzīvokļu skaits, ja norādīts'), lietderiga: D('Dzīvokļu m² bez ārtelpām/balkoniem: "Dzīvokļu platība"; ja tādas nav — "Dzīvokļu kopējā platība" mīnus "Dzīvokļu ārtelpu platība"'),
    stavi: D('Virszemes stāvu skaits'), gads: D('Uzbūvēšanas gads'), lifti: D('Liftu skaits, ja norādīts'), zemes_platiba: D('Zemes vienības platība m², ja norādīta'), apbuves_laukums: D('Būves apbūves laukums m², ja norādīts'),
    zonas: { type: 'object', properties: { kapnu: D('Kāpņu telpas, gaiteņi, vestibils m². Ja ir tikai kopējā "Koplietošanas iekštelpu platība" — liec to šeit (atņemot citas zonas, ja tās zināmas)'),
      ratinu: D('Ratiņu/velosipēdu telpa m²'), tehniskas: D('Tehniskās telpas, siltummezgls, elektro, apsaimniekotāja telpa m²'), atputas: D('Koplietošanas atpūtas telpa / sanmezgls m²'),
      terase: D('Koplietošanas terase / koplietošanas ārtelpas m² (piem. "Koplietošanas ārtelpu platība")') } },
    citas_zonas: { type: 'array', items: { type: 'object', properties: { nosaukums: { type: 'string' }, m2: { type: 'number' } }, required: ['nosaukums', 'm2'] } },
    teritorija: { type: 'object', properties: { cieti: D('Cietie segumi m² (ja zināma zeme: (zeme − apbūve) × 40%, ja sadalījums nav dots)'), zale: D('Zālāji, apstādījumi m² (ja zināma zeme: (zeme − apbūve) × 60%, ja sadalījums nav dots)') } },
    garaza: D('Pazemes autostāvvieta / garāža m², ja ir'), piezimes: { type: 'string', description: 'Īsi latviski: no kurām rindām ņemti skaitļi, kas ir aplēse, kas trūkst (piem. zemes platība)' } }, required: ['piezimes'] };
  const system = ['Tu no Latvijas Kadastra (kadastrs.lv / VZD) izkopēta teksta aizpildi uzkopšanas tāmes formu, izsaucot rīku aizpildit_formu.',
    'Ņem tikai skaitļus, kas tekstā tiešām ir (decimāldaļa ar punktu). Ko nevar noteikt — null. Neizdomā zemes platību, liftus vai dzīvokļu skaitu.',
    'Dzīvokļu īpašumu nodalījumi (pagrabi, noliktavas), kas pieder dzīvokļiem, NAV koplietošanas zonas.', 'Koplietošanas palīgtelpu platība = koplietošanas iekštelpas + koplietošanas ārtelpas; neskaiti to divreiz.'].join('\n');
  const j = await aiTool(env, system, text, schema, 1500);
  await log(env.DB, u.name, 'AI kadastrs', '', String(j.adrese || ''));
  return j;
}
async function aiTelpas(env, nosaukumi) {
  const names = (nosaukumi || []).map(String).filter(Boolean).slice(0, 200); if (!names.length) return [];
  const cats = ['kapnu', 'ratinu', 'lifts', 'tehniskas', 'atputas', 'saimniecibas', 'arpus', 'garaza', 'atkritumi', 'cits'];
  const schema = { type: 'object', properties: { telpas: { type: 'array', items: { type: 'object', properties: { nosaukums: { type: 'string' }, kategorija: { type: 'string', enum: cats } }, required: ['nosaukums', 'kategorija'] } } }, required: ['telpas'] };
  const system = ['Klasificē daudzdzīvokļu mājas koplietošanas telpu nosaukumus no Latvijas kadastra uzkopšanas tāmei. Izsauc rīku aizpildit_formu.',
    'kapnu = kāpņu telpas, gaiteņi, koridori, vestibili, tambūri, priekštelpas, halles, ieejas; ratinu = ratiņu/velosipēdu telpas;',
    'lifts = lifta šahtas un lifti (telpa "Lifts"); tehniskas = lifta mašīntelpa/lifta telpa, siltummezgls, elektro, ūdens, sūkņi, ventilācija, katlu, skaitītāji, apsaimniekotāja telpa;',
    'atputas = atpūtas telpas, sanmezgli, WC, dušas; saimniecibas = saimniecības telpas, pagrabi, noliktavas, bēniņi, žāvētavas, veļas telpas;',
    'arpus = balkoni, lodžijas, terases, ārtelpas; garaza = garāžas, autostāvvietas; atkritumi = atkritumu telpas/šahtas; cits = viss pārējais.'].join('\n');
  const j = await aiTool(env, system, names.join('\n'), schema, 1200);
  return (j.telpas || []).filter(x => cats.indexOf(x.kategorija) >= 0);
}

/* ---------- darbības ---------- */
async function nextId(db) {
  const y = P().year; let max = 0;
  (await all(db, "SELECT id FROM budz_budget WHERE id LIKE ?", 'B-' + y + '-%')).forEach(r => { const m = /^B-(\d{4})-(\d+)$/.exec(r.id); if (m) max = Math.max(max, +m[2]); });
  return 'B-' + y + '-' + ('000' + (max + 1)).slice(-4);
}
async function save(env, u, p) {
  const db = env.DB;
  if (!isMaker(u)) throw new Error('Vadības profils budžetus nelabo — tikai skatās un apstiprina.');
  const d = p.data || {}, c = p.calc || {}, o = d.objekts || {}, ts = now();
  let id = p.id, version = 1, status = p.statuss || 'Melnraksts', created = ts, autors = u.name, koment = '', izsk = '', exists = false;
  if (id) {
    const b = await row(db, id); if (!b) throw new Error('Budžets nav atrasts.');
    const m = meta(b);
    if (u.role !== 'admin' && norm(m.autors) !== norm(u.name)) throw new Error('Var labot tikai savus budžetus.');
    if (m.statuss === 'Apstiprināts' && u.role !== 'admin') throw new Error('Apstiprinātu budžetu labot nevar — izveido kopiju.');
    exists = true; version = m.versija + 1; created = m.izveidots; autors = m.autors; koment = m.komentars; izsk = m.izskatija;
    if (!p.statuss) status = m.statuss === 'Noraidīts' ? 'Melnraksts' : m.statuss;
  } else id = await nextId(db);
  const json = JSON.stringify(d);
  const vals = [o.nosaukums || '', o.adrese || '', o.pasutitajs || '', o.izpilditajs || '', o.sagatavots || '', autors, status, r2(c.bezPVN), r2(c.arPVN), version, created, ts, koment, izsk, json, Number(o.lietderiga) || 0, o.serija || ''];
  await db.batch([
    exists ? db.prepare('UPDATE budz_budget SET nosaukums=?, adrese=?, pasutitajs=?, izpilditajs=?, sagatavots=?, autors=?, statuss=?, bez_pvn=?, ar_pvn=?, versija=?, izveidots=?, atjaunots=?, komentars=?, izskatija=?, dati=?, plat=?, serija=? WHERE id=?').bind(...vals, id)
      : db.prepare('INSERT INTO budz_budget (nosaukums, adrese, pasutitajs, izpilditajs, sagatavots, autors, statuss, bez_pvn, ar_pvn, versija, izveidots, atjaunots, komentars, izskatija, dati, plat, serija, id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...vals, id),
    db.prepare('INSERT INTO budz_ver (id, versija, laiks, lietotajs, statuss, bez_pvn, piezime, dati) VALUES (?,?,?,?,?,?,?,?)').bind(id, version, ts, u.name, status, r2(c.bezPVN), p.piezime || '', json)]);
  await log(db, u.name, exists ? 'Saglabāja' : 'Izveidoja', id, 'v' + version + ' · ' + status);
  let sent = [];
  if (p.sutitVadibai && status === 'Iesniegts') {
    try { sent = await mailBudget(env, u, { id, versija: version, statuss: status, autors }, d, c, listOf((await settings(db))['Vadības e-pasti']), 'iesniegts', p.piezime, p.pdfB64); }
    catch (e) { await log(db, u.name, 'E-pasta kļūda', id, String(e.message || e)); sent = ['KĻŪDA: ' + (e.message || e)]; }
  }
  return { id, versija: version, statuss: status, atjaunots: ts, sent };
}
async function setStatus(env, u, id, status, comment) {
  const db = env.DB;
  if (STATUSES.indexOf(status) < 0) throw new Error('Nezināms statuss.');
  const b = await row(db, id); if (!b) throw new Error('Budžets nav atrasts.');
  const m = meta(b), own = norm(m.autors) === norm(u.name), mgmtOnly = ['Apstiprināts', 'Noraidīts', 'Arhivēts'];
  if (mgmtOnly.indexOf(status) >= 0 && !isMgmt(u)) throw new Error('Šo statusu var likt tikai vadība.');
  if (mgmtOnly.indexOf(status) < 0 && !own && u.role !== 'admin') throw new Error('Nav piekļuves.');
  const ts = now(), mg = mgmtOnly.indexOf(status) >= 0;
  await db.batch([db.prepare('UPDATE budz_budget SET statuss = ?, atjaunots = ?' + (mg ? ', komentars = ?, izskatija = ?' : '') + ' WHERE id = ?').bind(...(mg ? [status, ts, comment || '', u.name + ' · ' + ts.slice(0, 16).replace('T', ' '), id] : [status, ts, id])),
    db.prepare('INSERT INTO budz_ver (id, versija, laiks, lietotajs, statuss, bez_pvn, piezime, dati) VALUES (?,?,?,?,?,?,?,?)').bind(id, m.versija, ts, u.name, status, m.bezPVN, comment || ('Statuss → ' + status), '')]);
  await log(db, u.name, 'Statuss', id, status + (comment ? ' · ' + comment : ''));
  if ((status === 'Apstiprināts' || status === 'Noraidīts') && norm((await settings(db))['Sūtīt paziņojumus']) !== 'nē') {
    try {
      const au = (await people(db)).find(x => norm(x.name) === norm(m.autors));
      if (au && M.valid(au.email) && norm(au.name) !== norm(u.name)) {
        let d = {}; try { d = JSON.parse(b.dati || '{}'); } catch (e) {}
        const nos = (d.objekts && d.objekts.nosaukums) || id;
        await M.send(env, { to: au.email, subject: (status === 'Apstiprināts' ? '✓ Apstiprināts: ' : '✗ Noraidīts: ') + nos, fromName: (await settings(db))['Sūtītāja vārds'],
          html: wrap(`<p>Budžetu <b>${esc(nos)}</b> (${esc(id)}, ${eur(m.bezPVN)} mēnesī bez PVN) vadība (${esc(u.name)}) <b>${status === 'Apstiprināts' ? 'apstiprināja' : 'noraidīja'}</b>.</p>` + (comment ? `<p>Komentārs: <i>${esc(comment)}</i></p>` : '')) });
      }
    } catch (e) { await log(db, u.name, 'E-pasta kļūda', id, String(e.message || e)); }
  }
  return true;
}

/** Mājas lietas ml_kad.dati → Budžeta kadStart formāts ({buve, adrese, telpas, dzivokli, ...}) */
function mlToKad(adrese, d) {
  const B = Array.isArray(d.buves) ? d.buves : [], n = (v) => +v || 0, sum = (k) => B.reduce((s, b) => s + n(b[k]), 0);
  const telp = {}; (Array.isArray(d.telpas) ? d.telpas : []).forEach(t => { const k = String(t.nosaukums || 'Telpa').trim(); const x = telp[k] || (telp[k] = { nosaukums: k, m2: 0, skaits: 0 }); x.m2 += n(t.m2); x.skaits += n(t.skaits) || 1; });
  const gadi = B.map(b => n(b.ekspluatacijas_gads)).filter(g => g > 1700);
  const z = d.zeme || {}, c = d.citi || {};
  return { v: 1, avots: 'Mājas lieta', buve: B.map(b => b.apzimejums).filter(Boolean).join(', ') || String(d.kadastra_nr || adrese),
    adrese: String(d.adrese || adrese).split(';')[0].trim() || adrese, dzivokli: sum('dzivokli'), dzivoklu_m2: n(c['Dzīvokļu platība, m²']), kopeja: sum('kopplatiba_m2'),
    stavi: Math.max(0, ...B.map(b => n(b.virszemes_stavi))), pazemes: Math.max(0, ...B.map(b => n(b.pazemes_stavi))), gads: gadi.length ? Math.min(...gadi) : null,
    apbuve: sum('apbuves_laukums_m2'), zeme_m2: n(z.platiba_m2), zeme_apz: String(z.apzimejums || ''),
    telpas: Object.values(telp).map(t => Object.assign(t, { m2: Math.round(t.m2 * 10) / 10 })).sort((a, b) => b.m2 - a.m2) };
}

export async function handle(env, req) {
  const db = env.DB, u = await auth(db, req.pin);
  if (!u || u.none) { await new Promise(r => setTimeout(r, 700)); return { ok: false, error: 'Nepareizs PIN' }; }
  const a = String(req.action || ''), W = ['save', 'status', 'del', 'tplSave', 'tplDel', 'sendPdf', 'aiKadastrs', 'aiTelpas'];   // AI tērē tokenus — skatītājam nē
  if (u.viewer && W.indexOf(a) !== -1) return { ok: false, error: 'Jums ir tikai skatīšanās tiesības' };
  const user = { name: u.name, role: u.role, email: u.email };
  try {
    switch (a) {
      case 'login': await log(db, u.name, 'Pieteicās'); return { ok: true, user, settings: { vadibasEpasti: listOf((await settings(db))['Vadības e-pasti']) }, objekti: (await all(db, 'SELECT adrese FROM objects ORDER BY adrese')).map(o => o.adrese),
        objektiKad: (await all(db, "SELECT o.adrese FROM objects o JOIN ml_kad k ON k.anorm = o.anorm WHERE k.dati != '' AND k.dati != '{}' ORDER BY o.adrese").catch(() => [])).map(o => o.adrese) };   // adrešu ieteikumi no Mājas lietas
      case 'mlKad': {   // Mājas lietas objekta kadastra dati → tas pats formāts kā «SH Kadastrs» pogai
        const r = await db.prepare("SELECT o.adrese, k.dati FROM objects o JOIN ml_kad k ON k.anorm = o.anorm WHERE o.adrese = ?").bind(String(req.adrese || '').trim()).first();
        if (!r) throw new Error('Mājas lietā šim objektam nav kadastra datu.');
        return { ok: true, kad: mlToKad(r.adrese, JSON.parse(r.dati || '{}')) };
      }
      case 'list': { const L = (await all(db, "SELECT id, nosaukums, adrese, pasutitajs, izpilditajs, sagatavots, derigs, autors, statuss, bez_pvn, ar_pvn, versija, izveidots, atjaunots, komentars, izskatija, plat, serija FROM budz_budget WHERE statuss != 'Dzēsts'")).map(meta).filter(m => canSee(u, m));
        L.sort((x, y) => String(y.atjaunots).localeCompare(String(x.atjaunots))); return { ok: true, items: L }; }
      case 'get': {
        const b = await row(db, req.id); if (!b) throw new Error('Budžets nav atrasts.');
        const m = meta(b); if (!canSee(u, m)) throw new Error('Nav piekļuves.');
        if (req.versija) { const v = await db.prepare("SELECT dati FROM budz_ver WHERE id = ? AND versija = ? AND dati != '' ORDER BY n DESC LIMIT 1").bind(req.id, Number(req.versija)).first();
          if (!v) throw new Error('Versija nav atrasta.'); return { ok: true, meta: Object.assign({}, m, { versija: req.versija }), data: JSON.parse(v.dati) }; }
        return { ok: true, meta: m, data: JSON.parse(b.dati || '{}') };
      }
      case 'versions': {
        const b = await row(db, req.id); if (!b) throw new Error('Budžets nav atrasts.'); if (!canSee(u, meta(b))) throw new Error('Nav piekļuves.');
        return { ok: true, items: (await all(db, 'SELECT versija, laiks, lietotajs, statuss, bez_pvn, piezime, dati != \'\' AS ir FROM budz_ver WHERE id = ? ORDER BY n DESC', req.id))
          .map(r => ({ versija: r.versija, laiks: String(r.laiks), lietotajs: r.lietotajs, statuss: r.statuss, bezPVN: Number(r.bez_pvn) || 0, piezime: r.piezime, irDati: !!r.ir })) };
      }
      case 'save': return Object.assign({ ok: true }, await save(env, u, req));
      case 'status': return { ok: true, done: await setStatus(env, u, req.id, req.statuss, req.komentars) };
      case 'del': {
        const b = await row(db, req.id); if (!b) throw new Error('Budžets nav atrasts.');
        const m = meta(b), own = norm(m.autors) === norm(u.name);
        if (!(u.role === 'admin' || (own && m.statuss === 'Melnraksts'))) throw new Error('Dzēst var tikai savu melnrakstu (vai admins).');
        await db.prepare("UPDATE budz_budget SET statuss = 'Dzēsts', atjaunots = ? WHERE id = ?").bind(now(), req.id).run();   // dati paliek (atjaunot var admins D1)
        await log(db, u.name, 'Dzēsa', req.id, m.nosaukums); return { ok: true, done: true };
      }
      case 'pdf': {
        if (req.id) { const b = await row(db, req.id); if (b && !canSee(u, meta(b))) throw new Error('Nav piekļuves.'); }
        const name = fileName(req.data, req.meta) + '.pdf'; await log(db, u.name, 'PDF', req.id || '', name);
        const html = pdfHtml(req.data || {}, req.calc || {}, req.meta || {});
        const b64 = await serverPdf(env, html).catch(e => { console.log('budz pdf:', e && e.message); return ''; });
        return { ok: true, file: b64 ? { name, mime: 'application/pdf', b64 } : { name, mime: 'text/html', html } };
      }
      case 'sendPdf': {
        const to = String(req.to || '').split(/[,;\s]+/).map(x => x.trim()).filter(M.valid).slice(0, 10);
        if (req.id) { const b = await row(db, req.id); if (b && !canSee(u, meta(b))) throw new Error('Nav piekļuves.'); }
        return { ok: true, sent: await mailBudget(env, u, req.meta || {}, req.data || {}, req.calc || {}, to, 'sutits', req.piezime || '', req.pdfB64) };
      }
      case 'tplList': return { ok: true, items: (await all(db, 'SELECT id, nosaukums, apraksts, autors, izveidots FROM budz_tpl WHERE aktivs = 1 ORDER BY izveidots')).map(r => ({ id: r.id, nosaukums: r.nosaukums, apraksts: r.apraksts, autors: r.autors, izveidots: String(r.izveidots) })) };
      case 'tplGet': { const t = await db.prepare('SELECT * FROM budz_tpl WHERE id = ? AND aktivs = 1').bind(String(req.id)).first(); if (!t) throw new Error('Veidne nav atrasta.'); return { ok: true, tpl: { id: t.id, nosaukums: t.nosaukums, data: JSON.parse(t.dati || '{}') } }; }
      case 'tplSave': {
        if (!isMaker(u)) throw new Error('Veidnes veido budžetu gatavotājs.');
        const nos = String(req.nosaukums || '').trim(); if (!nos) throw new Error('Ievadi veidnes nosaukumu.');
        const p = P(), id = 'V-' + p.year.slice(2) + p.month + p.day + p.hour + p.minute + p.second;
        await db.prepare('INSERT INTO budz_tpl (id, nosaukums, apraksts, autors, izveidots, dati) VALUES (?,?,?,?,?,?)').bind(id, nos, String(req.apraksts || ''), u.name, now(), JSON.stringify(req.data || {})).run();
        await log(db, u.name, 'Veidne', id, nos); return { ok: true, tpl: { id, nosaukums: nos } };
      }
      case 'tplDel': {
        const t = await db.prepare('SELECT * FROM budz_tpl WHERE id = ? AND aktivs = 1').bind(String(req.id)).first(); if (!t) return { ok: true, done: false };
        if (u.role !== 'admin' && norm(t.autors) !== norm(u.name)) throw new Error('Dzēst var tikai savu veidni (vai admins).');
        await db.prepare('UPDATE budz_tpl SET aktivs = 0 WHERE id = ?').bind(t.id).run(); await log(db, u.name, 'Dzēsa veidni', t.id, t.nosaukums); return { ok: true, done: true };
      }
      case 'aiKadastrs': return { ok: true, ai: await aiKadastrs(env, u, req.text) };
      case 'aiTelpas': return { ok: true, kat: await aiTelpas(env, req.nosaukumi) };
      case 'xlsx': case 'listXlsx': throw new Error('Atjaunojiet lapu — Excel tagad veido lietotne.');
    }
    return { ok: false, error: 'Nezināma darbība' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* ---------- vienreizējs imports no «Budžets · …» lapām + pārslēgšana (kv budz:switch = '1') ---------- */
const T = { bud: 'Budžets · Budžeti', ver: 'Budžets · Versijas', log: 'Budžets · Žurnāls', tpl: 'Budžets · Veidnes', set: '⚙ Budžets Iestatījumi' };
const two = (n) => ('0' + n).slice(-2);
const iso = (v, dateOnly) => { if (typeof v === 'number' && v > 20000 && v < 80000) { const s = G.serial(v); const d = s.y + '-' + two(s.m) + '-' + two(s.d); return dateOnly ? d : d + 'T' + two(s.H) + ':' + two(s.M) + ':' + two(s.S); } return v == null ? '' : String(v); };
export async function imports(env) {
  const db = env.DB, out = {};
  const bud = await G.readRaw(env, T.bud, 'A1:S'), st = [];
  bud.forEach((r, i) => { const id = String(r[0] || '').trim(); if (!i || !id) return; const s = (k) => r[k] == null ? '' : r[k];
    st.push(db.prepare('INSERT OR IGNORE INTO budz_budget (id, nosaukums, adrese, pasutitajs, izpilditajs, sagatavots, derigs, autors, statuss, bez_pvn, ar_pvn, versija, izveidots, atjaunots, komentars, izskatija, dati, plat, serija, ord) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, String(s(1)), String(s(2)), String(s(3)), String(s(4)), iso(s(5), 1), iso(s(6), 1), String(s(7)), String(s(8) || 'Melnraksts'), Number(s(9)) || 0, Number(s(10)) || 0, Number(s(11)) || 1,
        iso(s(12)), iso(s(13)), String(s(14)), String(s(15)), String(s(16) || '{}'), Number(s(17)) || 0, String(s(18)), i)); });
  out.budzeti = st.length;
  const ver = await G.readRaw(env, T.ver, 'A1:H');
  ver.forEach((r, i) => { if (!i || !r[0]) return; st.push(db.prepare('INSERT INTO budz_ver (id, versija, laiks, lietotajs, statuss, bez_pvn, piezime, dati) VALUES (?,?,?,?,?,?,?,?)')
    .bind(String(r[0]), Number(r[1]) || 1, iso(r[2]), String(r[3] || ''), String(r[4] || ''), Number(r[5]) || 0, String(r[6] || ''), String(r[7] || ''))); });
  out.versijas = Math.max(0, ver.length - 1);
  const lg = await G.readRaw(env, T.log, 'A1:E');
  lg.forEach((r, i) => { if (!i || !r[0]) return; st.push(db.prepare('INSERT INTO budz_log (laiks, lietotajs, darbiba, budzets, info) VALUES (?,?,?,?,?)').bind(iso(r[0]), String(r[1] || ''), String(r[2] || ''), String(r[3] || ''), String(r[4] || ''))); });
  out.zurnals = Math.max(0, lg.length - 1);
  const tp = await G.readRaw(env, T.tpl, 'A1:F').catch(() => []);
  tp.forEach((r, i) => { if (!i || !r[0]) return; st.push(db.prepare('INSERT OR IGNORE INTO budz_tpl (id, nosaukums, apraksts, autors, izveidots, dati) VALUES (?,?,?,?,?,?)').bind(String(r[0]), String(r[1] || ''), String(r[2] || ''), String(r[3] || ''), iso(r[4]), String(r[5] || '{}'))); });
  out.veidnes = Math.max(0, tp.length - 1);
  const se = await G.readRaw(env, T.set, 'A1:B').catch(() => []), S = {};
  se.forEach((r, i) => { if (i && r[0]) S[String(r[0]).trim()] = String(r[1] == null ? '' : r[1]).trim(); });
  st.push(db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('budz:settings', ?)").bind(JSON.stringify(S)));
  for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
  return out;
}
export async function maybeSwitch(env) {
  const db = env.DB;
  if ((await kvGet(db, 'budz:switch')) !== '1' || await isNative(env) || !env.GOOGLE_SA) return;
  const q = await db.prepare("SELECT COUNT(*) n FROM izv_q WHERE part = 0 AND fn LIKE 'budz|%' AND err = ''").first();
  if (q && q.n) { await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('budz:switchLog', ?)").bind('gaida rindu: ' + q.n).run(); return; }
  const r = await imports(env);
  await db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('budz:native', '1'), ('budz:switch', 'done'), ('budz:switchLog', ?)").bind(new Date().toISOString() + ' ' + JSON.stringify(r)).run();
}
