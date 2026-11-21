-- SH | Sniega tīrīšana: savas tabulas (objekta iestatījumi, izbraukumi, žurnāls). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS sniegs_obj (anorm TEXT PRIMARY KEY, aktivs INTEGER NOT NULL DEFAULT 1, brigade TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL);
-- Izsaukumi: gaida (vadītājam jāapstiprina) | aktivs | beigts | atcelts
CREATE TABLE IF NOT EXISTS sniegs_call (id TEXT PRIMARY KEY, datums TEXT NOT NULL, statuss TEXT NOT NULL DEFAULT 'gaida', cm REAL NOT NULL DEFAULT 0, avots TEXT NOT NULL DEFAULT '',
  izveidots TEXT NOT NULL DEFAULT '', apstiprinaja TEXT NOT NULL DEFAULT '', beigts TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS sniegs_call_d ON sniegs_call (datums);
CREATE TABLE IF NOT EXISTS sniegs_visit (id TEXT PRIMARY KEY, izs TEXT NOT NULL, anorm TEXT NOT NULL, adrese TEXT NOT NULL, datums TEXT NOT NULL, statuss TEXT NOT NULL DEFAULT 'plan',
  brigade TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL DEFAULT 0, izpilditajs TEXT NOT NULL DEFAULT '', sakums TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '',
  foto TEXT NOT NULL DEFAULT '', iemesls TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS sniegs_visit_i ON sniegs_visit (izs);
CREATE INDEX IF NOT EXISTS sniegs_visit_a ON sniegs_visit (anorm);
CREATE TABLE IF NOT EXISTS sniegs_log (id INTEGER PRIMARY KEY AUTOINCREMENT, laiks TEXT NOT NULL, teksts TEXT NOT NULL);
