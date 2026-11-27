-- SH | I6 kvalitātes pārbaude: dienas paraugs (~10 %) izpildītiem darbiem; verdict ok|bad, vert 1–5, claim = izveidotā pretenzija. Nedzēš. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS qc (id TEXT PRIMARY KEY, datums TEXT NOT NULL, app TEXT NOT NULL, visit TEXT NOT NULL, anorm TEXT NOT NULL DEFAULT '', adrese TEXT NOT NULL DEFAULT '',
  izpilditajs TEXT NOT NULL DEFAULT '', foto TEXT NOT NULL DEFAULT '', pirms TEXT NOT NULL DEFAULT '', flags TEXT NOT NULL DEFAULT '[]', ai TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL DEFAULT '', vert INTEGER NOT NULL DEFAULT 0, piez TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', claim TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS qc_v ON qc (app, visit);
CREATE INDEX IF NOT EXISTS qc_d ON qc (datums);
