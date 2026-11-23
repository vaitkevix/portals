-- SH | Personāls → Darba laiks: sinhronizācijas atzīme (''=gaida, 'ok', 'gaida beigas', 'kļūda: …'). © VAITKEVIX, SIA
ALTER TABLE pers_hire ADD COLUMN dl_sync TEXT NOT NULL DEFAULT '';
ALTER TABLE pers_chg ADD COLUMN dl_sync TEXT NOT NULL DEFAULT '';
