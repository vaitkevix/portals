// SH | E-pasts caur Cloudflare Email Routing (binding MAIL, sūtītājs @vaitkevix.cloud). Adresātiem jābūt apstiprinātiem
// Cloudflare → Email Routing → Destination addresses. Pielikumi: [{ name, mime, b64 }]. © VAITKEVIX, SIA
import { EmailMessage } from 'cloudflare:email';

export const FROM = 'sistema@vaitkevix.cloud';
const enc = (s) => '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(String(s)))) + '?=';
const b64 = (s) => btoa(unescape(encodeURIComponent(String(s)))).replace(/.{76}/g, '$&\r\n');
const wrap76 = (s) => String(s).replace(/\s+/g, '').replace(/.{76}/g, '$&\r\n');
export const valid = (a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a || '').trim());

/** Viens e-pasts katram adresātam. Atgriež { sent:[...], failed:[{to, error}] } */
export async function send(env, { to, subject, html, fromName, attachments, replyTo }) {
  if (!env.MAIL) throw new Error('E-pasts nav iestatīts');
  let list = [...new Set((Array.isArray(to) ? to : String(to || '').split(/[,;\s]+/)).map(x => String(x).trim()).filter(valid))].slice(0, 20);
  if (!list.length) throw new Error('Nav e-pasta adreses');
  // Pagaidu novirzīšana (kv «mail:override» = adrese): visas vēstules uz vienu adresi, tēmā — kam bija domāta
  const ov = env.DB && await env.DB.prepare("SELECT v FROM kv WHERE k = 'mail:override'").first().catch(() => null);
  if (ov && valid(ov.v)) { subject = '[→ ' + list.join(', ') + '] ' + (subject || ''); list = [ov.v.trim()]; }
  const sent = [], failed = [];
  for (const addr of list) {
    const bnd = 'sh' + crypto.randomUUID().replace(/-/g, ''), host = FROM.split('@')[1];
    const H = ['From: ' + enc(fromName || 'SELECTUM HOME') + ' <' + FROM + '>', 'To: <' + addr + '>', 'Subject: ' + enc(subject || ''),
      'Date: ' + new Date().toUTCString(), 'Message-ID: <' + crypto.randomUUID() + '@' + host + '>', 'MIME-Version: 1.0'];
    if (replyTo && valid(replyTo)) H.push('Reply-To: <' + replyTo + '>');
    H.push('Content-Type: multipart/mixed; boundary="' + bnd + '"');
    let body = '--' + bnd + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(html || '') + '\r\n';
    for (const a of attachments || []) {
      if (!a || !a.b64) continue;
      body += '--' + bnd + '\r\nContent-Type: ' + (a.mime || 'application/octet-stream') + '; name="' + enc(a.name || 'pielikums') + '"\r\nContent-Transfer-Encoding: base64\r\n' +
        'Content-Disposition: attachment; filename="' + enc(a.name || 'pielikums') + '"\r\n\r\n' + wrap76(a.b64) + '\r\n';
    }
    body += '--' + bnd + '--\r\n';
    try { await env.MAIL.send(new EmailMessage(FROM, addr, H.join('\r\n') + '\r\n\r\n' + body)); sent.push(addr); }
    catch (e) { failed.push({ to: addr, error: String(e && e.message || e) }); }
  }
  return { sent, failed };
}

/** Pārbaude: kv «mailTest» = adrese → nosūta testa vēstuli, rezultāts kv «mailTestOut» */
export async function selfTest(env) {
  const r = await env.DB.prepare("SELECT v FROM kv WHERE k = 'mailTest'").first();
  if (!r || !r.v || !env.MAIL) return;
  await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('mailTest', '')").run();
  let out; try { out = await send(env, { to: r.v, subject: 'SH sistēmas e-pasta pārbaude', html: '<p>Šī ir SH sistēmas (Cloudflare) testa vēstule. Ja to redzat — e-pasts strādā.</p><p style="color:#6d7672;font-size:12px">© VAITKEVIX, SIA</p>', fromName: 'SELECTUM HOME' }); }
  catch (e) { out = { error: String(e.message || e) }; }
  await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('mailTestOut', ?)").bind(new Date().toISOString() + ' ' + JSON.stringify(out)).run();
}
