-- SH | E3 pretenzijas grafika lietotnēs: vadītājs pie izpildīta apmeklējuma — teksts + bilde; izpildītājs «Labots» ar jaunu bildi.
-- Kamēr statuss 'atverta' — apmeklējums neiet klienta aktā/rēķinā (klienti.js report → aizturets). Nedzēš. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS claim (id TEXT PRIMARY KEY, app TEXT NOT NULL, visit TEXT NOT NULL, anorm TEXT NOT NULL DEFAULT '', adrese TEXT NOT NULL DEFAULT '', datums TEXT NOT NULL DEFAULT '',
  teksts TEXT NOT NULL DEFAULT '', foto TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', izpilditajs TEXT NOT NULL DEFAULT '',
  statuss TEXT NOT NULL DEFAULT 'atverta', lab_kas TEXT NOT NULL DEFAULT '', lab_laiks TEXT NOT NULL DEFAULT '', lab_foto TEXT NOT NULL DEFAULT '', lab_piez TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS claim_app ON claim (app, statuss);
CREATE INDEX IF NOT EXISTS claim_visit ON claim (app, visit);
