-- SH | Personāls: grozījumi (amats/objekts/SIA, alga/slodze, personas dati, darba attiecību beigas). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS pers_chg (id TEXT PRIMARY KEY, row INTEGER NOT NULL UNIQUE, iesniegts TEXT NOT NULL DEFAULT '', iesniedza TEXT NOT NULL DEFAULT '',
  darbinieks TEXT NOT NULL DEFAULT '', veids TEXT NOT NULL DEFAULT '', speka_no TEXT NOT NULL DEFAULT '', sia_bija TEXT NOT NULL DEFAULT '', objekts_bija TEXT NOT NULL DEFAULT '',
  sia TEXT NOT NULL DEFAULT '', objekts TEXT NOT NULL DEFAULT '', amats TEXT NOT NULL DEFAULT '', alga TEXT NOT NULL DEFAULT '', slodze TEXT NOT NULL DEFAULT '', stundas TEXT NOT NULL DEFAULT '',
  adrese TEXT NOT NULL DEFAULT '', tel TEXT NOT NULL DEFAULT '', epasts TEXT NOT NULL DEFAULT '', banka TEXT NOT NULL DEFAULT '', iban TEXT NOT NULL DEFAULT '', inval TEXT NOT NULL DEFAULT '',
  pens TEXT NOT NULL DEFAULT '', beigu_datums TEXT NOT NULL DEFAULT '', iemesls TEXT NOT NULL DEFAULT '', piezimes TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'Jauns',
  komentars TEXT NOT NULL DEFAULT '', mail_err TEXT NOT NULL DEFAULT '');
