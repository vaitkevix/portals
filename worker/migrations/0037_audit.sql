-- SH | Audita žurnāls: kas, kad un ko mainīja (cilvēki, klienti, rekvizīti, rēķini, slēgšana, SMS, personāls). Tikai pievieno, nedzēš. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, laiks TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', modulis TEXT NOT NULL DEFAULT '',
  objekts TEXT NOT NULL DEFAULT '', lauks TEXT NOT NULL DEFAULT '', bija TEXT NOT NULL DEFAULT '', kluva TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS audit_laiks ON audit (laiks);
CREATE INDEX IF NOT EXISTS audit_mod ON audit (modulis, laiks);
CREATE INDEX IF NOT EXISTS audit_kas ON audit (kas, laiks);
