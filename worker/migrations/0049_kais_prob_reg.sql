-- Kaisāmmateriāls: problēma/atteikums (kā Izvešanā), atcelšana ar iemeslu; sezonas pieteikumi (ik N dienas sezonā vai pēc sniega izsaukuma)
ALTER TABLE kais_task ADD COLUMN problema TEXT NOT NULL DEFAULT '';
ALTER TABLE kais_task ADD COLUMN prob_foto TEXT NOT NULL DEFAULT '';
ALTER TABLE kais_task ADD COLUMN atcelts TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS kais_reg (id TEXT PRIMARY KEY, adrese TEXT NOT NULL DEFAULT '', ik INTEGER NOT NULL DEFAULT 0, nakamais TEXT NOT NULL DEFAULT '', aktivs INTEGER NOT NULL DEFAULT 1,
  no_men INTEGER NOT NULL DEFAULT 11, lidz_men INTEGER NOT NULL DEFAULT 3, sniegs INTEGER NOT NULL DEFAULT 0, materials TEXT NOT NULL DEFAULT '', maisi TEXT NOT NULL DEFAULT '',
  komentars TEXT NOT NULL DEFAULT '', pasutitajs TEXT NOT NULL DEFAULT '', izveidoja TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '', pedejais TEXT NOT NULL DEFAULT '');
