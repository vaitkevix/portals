-- Personāls: darba attiecību izbeigšana no darbinieka kartītes (pēdējā diena → Darba laikā neaktīvs pēc tās)
CREATE TABLE IF NOT EXISTS pers_end (id TEXT PRIMARY KEY, vkey TEXT NOT NULL DEFAULT '', vards TEXT NOT NULL DEFAULT '', pedeja TEXT NOT NULL DEFAULT '', iemesls TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', dl_done TEXT NOT NULL DEFAULT '', atcelts TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS pers_end_v ON pers_end (vkey);
