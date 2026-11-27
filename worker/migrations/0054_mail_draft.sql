-- SH | I5 AI e-pasta kaste (pieteikumi@vaitkevix.cloud): katra vēstule = melnraksts; darbu izveido tikai admins ar «Apstiprināt». Nedzēš. © VAITKEVIX, SIA
-- statuss: jauns (zināms sūtītājs) | nezinams | apstiprinats | noraidits; ai = JSON izvilkums; rezultats = '<app>:<id>'
CREATE TABLE IF NOT EXISTS mail_draft (id TEXT PRIMARY KEY, laiks TEXT NOT NULL, no TEXT NOT NULL DEFAULT '', kam TEXT NOT NULL DEFAULT '', tema TEXT NOT NULL DEFAULT '', teksts TEXT NOT NULL DEFAULT '',
  foto TEXT NOT NULL DEFAULT '', pielikumi TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'jauns', ai TEXT NOT NULL DEFAULT '', rezultats TEXT NOT NULL DEFAULT '',
  kas TEXT NOT NULL DEFAULT '', apstr TEXT NOT NULL DEFAULT '', msgid TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS mail_draft_s ON mail_draft (statuss, laiks);
CREATE INDEX IF NOT EXISTS mail_draft_m ON mail_draft (msgid);
