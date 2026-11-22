-- SH | Personāls bez Apps Script: pieņemšana darbā un atvaļinājumi D1 (agrāk «Personāls · Pieņemšana» A–W un «Personāls · Atvaļinājumi» A–Q). © VAITKEVIX, SIA
-- Datumi glabāti tieši tā, kā tos rādīja GAS (iesniegts 'dd.MM.yyyy HH:mm', pārējie 'dd.MM.yyyy'); skaitļi kā teksts (String(v)).
-- Iestatījumi (ADMIN_EMAIL u.c.) — kv «pers:set» (JSON), vecie lietotāji — kv «pers:users», vecie saraksti — kv «pers:lists».
CREATE TABLE IF NOT EXISTS pers_hire (id TEXT PRIMARY KEY, row INTEGER NOT NULL UNIQUE, iesniegts TEXT NOT NULL DEFAULT '', iesniedza TEXT NOT NULL DEFAULT '',
  vards TEXT NOT NULL DEFAULT '', pk TEXT NOT NULL DEFAULT '', adrese TEXT NOT NULL DEFAULT '', tel TEXT NOT NULL DEFAULT '', epasts TEXT NOT NULL DEFAULT '',
  inval TEXT NOT NULL DEFAULT '', pens TEXT NOT NULL DEFAULT '', vesel TEXT NOT NULL DEFAULT '', sia TEXT NOT NULL DEFAULT '', objekts TEXT NOT NULL DEFAULT '',
  amats TEXT NOT NULL DEFAULT '', sakums TEXT NOT NULL DEFAULT '', alga TEXT NOT NULL DEFAULT '', banka TEXT NOT NULL DEFAULT '', iban TEXT NOT NULL DEFAULT '',
  piezimes TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'Jauns', komentars TEXT NOT NULL DEFAULT '', kal TEXT NOT NULL DEFAULT '', begin_time TEXT NOT NULL DEFAULT '',
  mail_err TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS pers_vac (id TEXT PRIMARY KEY, row INTEGER NOT NULL UNIQUE, iesniegts TEXT NOT NULL DEFAULT '', iesniedza TEXT NOT NULL DEFAULT '',
  darbinieks TEXT NOT NULL DEFAULT '', sia TEXT NOT NULL DEFAULT '', objekts TEXT NOT NULL DEFAULT '', amats TEXT NOT NULL DEFAULT '', veids TEXT NOT NULL DEFAULT '',
  no TEXT NOT NULL DEFAULT '', lidz TEXT NOT NULL DEFAULT '', kal_dienas TEXT NOT NULL DEFAULT '', darba_dienas TEXT NOT NULL DEFAULT '', aizv TEXT NOT NULL DEFAULT '',
  piezimes TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'Jauns', komentars TEXT NOT NULL DEFAULT '', kal TEXT NOT NULL DEFAULT '',
  mail_err TEXT NOT NULL DEFAULT '');
