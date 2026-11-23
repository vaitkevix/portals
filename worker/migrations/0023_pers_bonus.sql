-- SH | Personāls: piemaksas (vadītāji pievieno, administrators apstiprina). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS pers_bonus (id TEXT PRIMARY KEY, row INTEGER NOT NULL UNIQUE, iesniegts TEXT NOT NULL DEFAULT '', iesniedza TEXT NOT NULL DEFAULT '',
  darbinieks TEXT NOT NULL DEFAULT '', menesis TEXT NOT NULL DEFAULT '', iemesls TEXT NOT NULL DEFAULT '', summa TEXT NOT NULL DEFAULT '', objekts TEXT NOT NULL DEFAULT '',
  piezimes TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'Jauns', komentars TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS pers_bonus_m ON pers_bonus (menesis);
