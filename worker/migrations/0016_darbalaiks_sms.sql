-- SH | Darba laiks ar SMS pa objektiem: objektu kodi, darbinieki pēc tālruņa, SMS žurnāls. Vecās dl_mark rindas paliek. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS dl_obj (anorm TEXT PRIMARY KEY, kods TEXT NOT NULL UNIQUE, vajag_uzk INTEGER NOT NULL DEFAULT 1, vajag_set INTEGER NOT NULL DEFAULT 1, aktivs INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS dl_worker (phone TEXT PRIMARY KEY, vards TEXT NOT NULL DEFAULT '', amats TEXT NOT NULL DEFAULT 'uzk', anorm TEXT NOT NULL DEFAULT '', aktivs INTEGER NOT NULL DEFAULT 1);
ALTER TABLE dl_mark ADD COLUMN anorm TEXT NOT NULL DEFAULT '';
ALTER TABLE dl_mark ADD COLUMN amats TEXT NOT NULL DEFAULT '';
ALTER TABLE dl_mark ADD COLUMN phone TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS dl_mark_obj ON dl_mark (datums, anorm, amats);
CREATE TABLE IF NOT EXISTS dl_sms (id TEXT PRIMARY KEY, laiks TEXT NOT NULL, virziens TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', anorm TEXT NOT NULL DEFAULT '', teksts TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT '', msg_id TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS dl_sms_t ON dl_sms (laiks);
CREATE INDEX IF NOT EXISTS dl_sms_m ON dl_sms (msg_id);
