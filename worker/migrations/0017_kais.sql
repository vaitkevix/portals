-- SH | Kaisāmmateriāls bez Apps Script: pieteikumi D1, tabula «Kaisāmmateriāls · Pieteikumi» = kopija. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS kais_task (id TEXT PRIMARY KEY, row INTEGER NOT NULL UNIQUE, datums TEXT NOT NULL DEFAULT '', adrese TEXT NOT NULL DEFAULT '', pasutitajs TEXT NOT NULL DEFAULT '',
  materials TEXT NOT NULL DEFAULT '', maisi TEXT NOT NULL DEFAULT '', komentars TEXT NOT NULL DEFAULT '', foto_pirms TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'Gaida piegādi',
  kurjers TEXT NOT NULL DEFAULT '', foto_pec TEXT NOT NULL DEFAULT '', piegadati TEXT NOT NULL DEFAULT '', kurj_kom TEXT NOT NULL DEFAULT '', piegadats TEXT NOT NULL DEFAULT '',
  sheet INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS kais_task_s ON kais_task (sheet);
