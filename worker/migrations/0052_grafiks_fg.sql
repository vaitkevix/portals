-- SH | F/G kārta grafika lietotnēm (2026-11-28). Tikai pievieno — nekas netiek dzēsts. © VAITKEVIX, SIA
-- Pļaušana: pieteikumi ārpus grafika (kā logi/dārzs) un stundas pie «Nopļauts»
ALTER TABLE pl_visit ADD COLUMN avots TEXT NOT NULL DEFAULT 'grafiks';
ALTER TABLE pl_visit ADD COLUMN steidzami INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pl_visit ADD COLUMN apraksts TEXT NOT NULL DEFAULT '';
ALTER TABLE pl_visit ADD COLUMN termins TEXT NOT NULL DEFAULT '';
ALTER TABLE pl_visit ADD COLUMN pieteica TEXT NOT NULL DEFAULT '';
ALTER TABLE pl_visit ADD COLUMN stundas REAL NOT NULL DEFAULT 0;
-- Sniegs: izsaukuma veids — sniegs | kaisisana (apledojums pēc prognozes)
ALTER TABLE sniegs_call ADD COLUMN veids TEXT NOT NULL DEFAULT 'sniegs';
-- G1 kontrolsaraksts pie izpildes: punkti JSON [{t, ok, req}]
CREATE TABLE IF NOT EXISTS chk (app TEXT NOT NULL, visit TEXT NOT NULL, punkti TEXT NOT NULL DEFAULT '[]', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', PRIMARY KEY (app, visit));
-- G2 komentāri pie darba (vadītājs ↔ izpildītājs)
CREATE TABLE IF NOT EXISTS thread (id TEXT PRIMARY KEY, app TEXT NOT NULL, visit TEXT NOT NULL, kas TEXT NOT NULL DEFAULT '', loma TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', teksts TEXT NOT NULL DEFAULT '', foto TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS thread_v ON thread (app, visit);
-- Mājas lieta: iekārtu reģistrs ar apkopēm un skaitītāju rādījumi
CREATE TABLE IF NOT EXISTS ml_iek (id TEXT PRIMARY KEY, anorm TEXT NOT NULL, nosaukums TEXT NOT NULL DEFAULT '', veids TEXT NOT NULL DEFAULT '', intervals INTEGER NOT NULL DEFAULT 12,
  pedeja TEXT NOT NULL DEFAULT '', atbildigais TEXT NOT NULL DEFAULT '', dok TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', aktivs INTEGER NOT NULL DEFAULT 1, kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ml_iek_a ON ml_iek (anorm);
CREATE TABLE IF NOT EXISTS ml_apk (id TEXT PRIMARY KEY, iek TEXT NOT NULL, datums TEXT NOT NULL, kas TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', dok TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ml_apk_i ON ml_apk (iek);
CREATE TABLE IF NOT EXISTS ml_skait (id TEXT PRIMARY KEY, anorm TEXT NOT NULL, veids TEXT NOT NULL DEFAULT '', nr TEXT NOT NULL DEFAULT '', datums TEXT NOT NULL, radijums REAL NOT NULL DEFAULT 0,
  foto TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ml_skait_a ON ml_skait (anorm, veids, datums);
