/* SH | SIA (darbu izpildītāji): paziņojums par jaunu darbu (push + SMS), «Pieņemu / Nevaru šajā datumā» (Izvešana, Kaisāmmateriāls),
 * «Mans mēnesis» — izpildītie darbi visās lietotnēs bez cenām, admina saskaņojums (kv siaOk:<SIA>:<YYYY-MM>). © VAITKEVIX, SIA */
import { notify, managers } from './webpush.js';
import { sendSms, smsOn } from './darbalaiks.js';
import { report } from './klienti.js';

const KIND = { izv: 'izvedejs', kais: 'kurjers' };
const T = { izv: 'izv_task', kais: 'kais_task' };
const NAME = { izv: 'Izvešana', kais: 'Kaisāmmateriāls' };
const stamp = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return p.day + '.' + p.month + '.' + p.year + ' ' + p.hour + ':' + p.minute; };
const all = async (db, q, ...a) => ((await db.prepare(q).bind(...a).all().catch(() => ({ results: [] }))).results || []);

/** Uzņēmumi, kas var izpildīt šo lietotnes darbu (aktīvi, ar paroli) */
async function doers(db, app) { return (await all(db, 'SELECT name, kinds, phone, pass FROM companies WHERE active = 1')).filter(c => c.pass && String(c.kinds).split(',').indexOf(KIND[app]) !== -1); }

/** Jauns pieteikums → push uzņēmumam (visi tā darbinieki ir abonēti ar uzņēmuma nosaukumu) + SMS uz companies.phone (SMS funkcija «sia_darbs»).
 * Teksts bez personu vārdiem un piekļuves kodiem. Kļūdas darbību neaptur. */
export async function newJob(env, app, t) {
  try {
    const db = env.DB, C = await doers(db, app); if (!C.length) return;
    const what = app === 'izv' ? 'izvešana' : 'kaisāmmateriāls' + (t.materials ? ' (' + t.materials + ')' : '');
    const body = String(t.adrese || '') + (t.steidzami ? ' · steidzami' : '') + (t.termins ? ' · līdz ' + t.termins : '');
    await notify(env, C.map(c => c.name), { title: 'Jauns darbs: ' + what, body: body + ' — atveriet un nospiediet «Pieņemu»', url: '/sh/#' + app, urgent: !!t.steidzami });
    if (await smsOn(db, 'sia_darbs')) {
      const ph = C.map(c => c.phone).filter(Boolean);
      if (ph.length) await sendSms(env, ph, 'SH: jauns darbs (' + what + '): ' + body + '. Pienemt: vaitkevix.cloud/sh/#' + app, '');
    }
  } catch (e) { console.error('sia newJob', e); }
}

/** «Pieņemu» / «Nevaru šajā datumā» (d = { id, ok, reason }). me — portāla sesija (SIA vai tās darbinieks). */
export async function answer(env, app, d, me) {
  const db = env.DB; d = d || {};
  if (!me || !me.company || !(me.perms || {})[app]) return { status: 'error', message: 'Atbildēt var tikai izpildītājs (SIA), ienācis portālā' };
  const t = await db.prepare('SELECT * FROM ' + T[app] + ' WHERE id = ?').bind(String(d.id || '')).first();
  if (!t) return { status: 'error', message: 'Pieteikums nav atrasts' };
  const open = app === 'izv' ? (t.statuss || 'Neizpildīts') === 'Neizpildīts' : ['Piegādāts', 'Atcelts'].indexOf(t.statuss) === -1;
  if (!open) return { status: 'error', message: 'Pieteikums vairs nav atvērts' };
  const who = me.who || me.name, now = stamp();
  const mine = (v) => String(v || '').split(' · ')[0] === me.name || String(v || '').startsWith(me.name + ' · ');
  if (d.ok) {
    if (t.pienem && !mine(t.pienem)) return { status: 'error', message: 'Šo darbu jau pieņēma ' + String(t.pienem).split(' · ')[0] };
    const v = app === 'izv' ? (t.vesture ? t.vesture + '\n' : '') + now + ' · Pieņemts (' + who + ')' : null;
    if (app === 'izv') await db.prepare('UPDATE izv_task SET pienem = ?, nevar = ?, vesture = ? WHERE id = ?').bind(who + ' · ' + now, '', v, t.id).run();
    else await db.prepare('UPDATE kais_task SET pienem = ?, nevar = ? WHERE id = ?').bind(who + ' · ' + now, '', t.id).run();
    return { status: 'success' };
  }
  const why = String(d.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!why) return { status: 'error', message: 'Uzrakstiet iemeslu' };
  const nv = who + ' · ' + now + ' · ' + why;
  if (app === 'izv') await db.prepare('UPDATE izv_task SET nevar = ?, pienem = CASE WHEN pienem LIKE ? THEN \'\' ELSE pienem END, vesture = ? WHERE id = ?').bind(nv, me.name + '%', (t.vesture ? t.vesture + '\n' : '') + now + ' · Nevar šajā datumā: ' + why + ' (' + who + ')', t.id).run();
  else await db.prepare('UPDATE kais_task SET nevar = ?, pienem = CASE WHEN pienem LIKE ? THEN \'\' ELSE pienem END WHERE id = ?').bind(nv, me.name + '%', t.id).run();
  try {   // vadītājiem (lietotnes admini/vadītāji + portāla admini) un pieteicējam
    const to = (await managers(env, app)).concat(t.pasutitajs ? [t.pasutitajs] : []);
    await notify(env, to, { title: NAME[app] + ': izpildītājs nevar', body: t.adrese + ' — ' + why + ' (' + me.name + ')', url: '/sh/#' + app });
  } catch (e) { console.error('sia answer push', e); }
  return { status: 'success' };
}

/* ---------- «Mans mēnesis» ---------- */
const own = (company) => (kas) => { const k = String(kas || ''); return k === company || k.startsWith(company + ' · '); };
/** SIA izpildītie darbi mēnesī visās lietotnēs: daudzumi, bildes; bez cenām, bez klientiem. */
export async function siaMonth(db, company, ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis');
  const R = await report(db, '', ym), is = own(company);
  // grafika lietotnēs SIA = brigāde (izpildītājs var būt arī «SIA · vārds»); report() rindā «kas» = izpildītājs/brigāde
  const rows = R.rows.filter(r => r.app !== 'aizv' && r.app !== 'ligums' && is(r.kas)).map(r => ({ app: r.app, datums: r.datums, adrese: r.adrese, daudz: r.daudz, kas: r.kas, piez: r.piez || '', koef: r.koef || '', foto: String(r.foto || '').split(',').filter(Boolean).slice(0, 8) }));
  const sum = {}; rows.forEach(r => { const s = sum[r.app] = sum[r.app] || { app: r.app, reizes: 0, daudz: 0 }; s.reizes++; s.daudz = Math.round((s.daudz + (+r.daudz || 0)) * 100) / 100; });
  const ok = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('siaOk:' + company + ':' + ym).first();
  let ap = null; try { ap = ok ? JSON.parse(ok.v) : null; } catch (e) {}
  return { company, ym, rows, sum: Object.values(sum), saskanots: ap };
}
/** Admins: saskaņot / atcelt saskaņojumu */
export async function siaApprove(db, company, ym, who, undo) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Nederīgs mēnesis');
  if (!await db.prepare('SELECT 1 FROM companies WHERE name = ?').bind(company).first()) throw new Error('Uzņēmums nav atrasts');
  const k = 'siaOk:' + company + ':' + ym;
  if (undo) await db.prepare('DELETE FROM kv WHERE k = ?').bind(k).run();
  else await db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind(k, JSON.stringify({ kas: who, laiks: new Date().toISOString() })).run();
}
/** Admins: kuri uzņēmumi un mēneši saskaņoti (pēdējie 12 mēneši) */
export async function siaApprovals(db) {
  const m = {}; for (const r of await all(db, "SELECT k, v FROM kv WHERE k LIKE 'siaOk:%'")) { const i = r.k.lastIndexOf(':'); let v = {}; try { v = JSON.parse(r.v); } catch (e) {} (m[r.k.slice(6, i)] = m[r.k.slice(6, i)] || {})[r.k.slice(i + 1)] = v; }
  return m;
}
