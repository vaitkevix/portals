-- Izpildītāju rēķini: izpildītāja SIA → pārvaldīšanas SIA par mēnesi (akts kā pamatojums). Izrakstot saglabā kopiju. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS sia_inv (
  nr TEXT PRIMARY KEY, company TEXT NOT NULL, parv TEXT NOT NULL, ym TEXT NOT NULL, datums TEXT NOT NULL DEFAULT '', termins TEXT NOT NULL DEFAULT '',
  summa REAL NOT NULL DEFAULT 0, pvn REAL NOT NULL DEFAULT 0, ar_pvn REAL NOT NULL DEFAULT 0, dati TEXT NOT NULL DEFAULT '',
  statuss TEXT NOT NULL DEFAULT 'izrakstīts', apmaksats TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS sia_inv_u ON sia_inv (company, parv, ym);
CREATE INDEX IF NOT EXISTS sia_inv_parv ON sia_inv (parv, ym);
