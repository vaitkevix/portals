-- SH | Pazemes stāvvietu mazgāšana: savas tabulas (objekta iestatījumi, izbraukumi, žurnāls). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS stav_obj (anorm TEXT PRIMARY KEY, qty REAL NOT NULL DEFAULT 0, intervals INTEGER NOT NULL DEFAULT 0, aktivs INTEGER NOT NULL DEFAULT 1,
  brigade TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', veidi TEXT NOT NULL DEFAULT '', lat REAL, lng REAL);
CREATE TABLE IF NOT EXISTS stav_visit (id TEXT PRIMARY KEY, anorm TEXT NOT NULL, adrese TEXT NOT NULL, datums TEXT NOT NULL, statuss TEXT NOT NULL DEFAULT 'plan',
  prio INTEGER NOT NULL DEFAULT 0, brigade TEXT NOT NULL DEFAULT '', izpilditajs TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', foto TEXT NOT NULL DEFAULT '',
  iemesls TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', parcelts INTEGER NOT NULL DEFAULT 0, pazinots TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS stav_visit_d ON stav_visit (datums);
CREATE INDEX IF NOT EXISTS stav_visit_a ON stav_visit (anorm);
CREATE TABLE IF NOT EXISTS stav_log (id INTEGER PRIMARY KEY AUTOINCREMENT, laiks TEXT NOT NULL, teksts TEXT NOT NULL);
