// SH | AI (Claude) tieši no Worker — bez Apps Script. Secret ANTHROPIC_API_KEY, pēc izvēles var AI_MODEL. © VAITKEVIX, SIA

const PROMBUTNE = ['Atvaļinājums', 'DNL', 'Vakance'];

export async function aiCall(env, system, prompt, maxTokens) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('AI nav iestatīts');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.AI_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens || 2000, system, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('AI kļūda: ' + ((j.error && j.error.message) || r.status));
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}

/* ---------- Aizvietošana: darba piezīme (tas pats, kas GAS aiNote) ---------- */
const NOTE_SYSTEM = 'Tu palīdzi apsaimniekošanas uzņēmuma darbiniekiem uzrakstīt īsas darba piezīmes latviešu valodā. ' +
  'Pārraksti lietotāja tekstu skaidrā, pieklājīgā, lietišķā latviešu valodā ar pareizu gramatiku un garumzīmēm. ' +
  'Saglabā visus faktus (vārdus, laikus, numurus, vietas), neko neizdomā un nepievieno jaunas detaļas. ' +
  'Ja teksts ir tukšs, sagatavo piezīmi TIKAI no piekļuves informācijas (kodi, iezvani, vārti) — bez vispārīgiem norādījumiem un bez izdomātām detaļām. ' +
  'Piekļuves kodus, tālruņu numurus un simbolus (#, *) pārraksti precīzi, neko nemainot. Neizdomā informāciju, kuras nav. ' +
  'Neatkārto adresi un darba nosaukumu — tie jau redzami blakus piezīmei. ' +
  'Garums: 1–3 teikumi, ne vairāk kā 300 rakstzīmes. Atbildē raksti TIKAI gatavo piezīmi, bez pēdiņām un paskaidrojumiem.';

export async function aiNote(env, r) {
  const kind = { note: 'Darbu vadītāja piezīme brigādei pie pieteiktā darba', done: 'Brigādes komentārs pēc darba izpildes',
    cant: 'Brigādes paskaidrojums, kāpēc darbu nevar izpildīt' }[r.kind] || 'Darba piezīme';
  const prompt = 'Situācija: ' + kind + '\nAdrese: ' + (r.adrese || '—') + '\nDarbs: ' + (r.tips || '—') +
    (r.piekluve ? '\nPiekļuve: ' + r.piekluve : '') +
    '\n\nLietotāja teksts:\n' + (String(r.text || '').trim() ? String(r.text).slice(0, 1000) : '(tukšs — sagatavo piezīmi)');
  const text = await aiCall(env, NOTE_SYSTEM, prompt, 2000);
  return { text: String(text || '').trim().replace(/^["„“]|["”“]$/g, '') };
}

/* ---------- Aizvietošana: ziņa → pieteikuma rindas (tas pats, kas GAS aiParseBridge_) ---------- */
export async function aiParse(env, r) {
  const msg = String(r.text || '').trim();
  if (!msg) throw new Error('Ielīmē vai uzraksti ziņu');
  const types = r.types || [], mgrs = r.managers || [];
  const system = 'Tu no apsaimniekošanas darbu vadītāja ziņas izveido darbu pieteikumus. Atbildi TIKAI ar JSON, bez paskaidrojumiem.';
  const prompt = 'Šodien: ' + r.today + ' (' + r.weekday + ').\n' +
    (r.role === 'admin' ? 'Darbu vadītāji: ' + mgrs.join(', ') + '. Ja ziņā minēts, kurš vadītājs piesaka, norādi "vaditajs".\n' : '') +
    'Darbu veidi (tips jāizvēlas TIKAI no šiem): ' + types.map(t => t.name + ' [' + t.group + ']').join('; ') + '\n' +
    'Zināmās adreses (ja ziņā minēta līdzīga, izmanto precīzi šo rakstību): ' + (r.addresses || []).join('; ') + '\n\n' +
    'Ziņa:\n' + msg.slice(0, 3000) + '\n\n' +
    'Atgriez JSON: {"datums":"YYYY-MM-DD vai null","vaditajs":"vārds vai null","rindas":[{"adrese":"...","tips":"...","apraksts":"īsa piezīme latviski vai tukšs","prombutne":"Atvaļinājums|DNL|Vakance vai null","lidz":"YYYY-MM-DD vai null"}]}. ' +
    '"prombutne" — kāpēc jāaizvieto: atvaļinājums, DNL (slimības lapa, darba nespējas lapa, slims) vai vakance (nav darbinieka); tikai aizvietošanas darbiem. ' +
    '"datums" = diena, uz kuru attiecas darbi (piem. "rīt" → rītdienas datums); ja nav minēts, null. ' +
    '"lidz" aizpildi tikai, ja aizvietojamais ir atvaļinājumā/prombūtnē līdz konkrētam datumam. ' +
    '"aizvietot sētnieku" → tips "Sētnieks"; "abus"/"sētnieku un apkopēju" → "Abi". Neizdomā adreses.';
  const raw = await aiCall(env, system, prompt, 8000);
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI neatgrieza pieteikumu');
  const data = JSON.parse(m[0]);
  const names = types.map(t => t.name);
  const rows = (data.rindas || []).filter(x => x && x.adrese).map(x => ({
    adrese: String(x.adrese).trim(), tips: names.indexOf(x.tips) !== -1 ? x.tips : '',
    apraksts: String(x.apraksts || '').trim(), lidz: /^\d{4}-\d{2}-\d{2}$/.test(x.lidz || '') ? x.lidz : '',
    prombutne: PROMBUTNE.indexOf(x.prombutne) !== -1 ? x.prombutne : ''
  }));
  return { datums: /^\d{4}-\d{2}-\d{2}$/.test(data.datums || '') ? data.datums : '', vaditajs: mgrs.indexOf(data.vaditajs) !== -1 ? data.vaditajs : '', rows };
}
