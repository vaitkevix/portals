-- Izvešana: regulārie pieteikumi (adrese, ik N dienas, nākamais datums, aktīvs). Cron izveido izv_task.
CREATE TABLE IF NOT EXISTS izv_reg (id TEXT PRIMARY KEY, adrese TEXT NOT NULL DEFAULT '', ik INTEGER NOT NULL DEFAULT 7, nakamais TEXT NOT NULL DEFAULT '', aktivs INTEGER NOT NULL DEFAULT 1,
  maisi TEXT NOT NULL DEFAULT '', komentars TEXT NOT NULL DEFAULT '', pasutitajs TEXT NOT NULL DEFAULT '', izveidoja TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '', pedejais TEXT NOT NULL DEFAULT '');
