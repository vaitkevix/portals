-- SH | Darba laiks: sētnieku un uzkopēju atzīmes «sāku / beidzu darbu» (pats, kolēģis vai vadītājs). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS dl_mark (id TEXT PRIMARY KEY, datums TEXT NOT NULL, vards TEXT NOT NULL, veids TEXT NOT NULL, laiks TEXT NOT NULL,
  vieniba TEXT NOT NULL DEFAULT '', avots TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS dl_mark_d ON dl_mark (datums, vards);
