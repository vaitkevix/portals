-- SH | Objekta papildinformācija administrēšanā: algas pa amatiem (Personālam), piezīmes. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS obj_info (anorm TEXT PRIMARY KEY, algas TEXT NOT NULL DEFAULT '[]', piezimes TEXT NOT NULL DEFAULT '', atjaunots TEXT NOT NULL DEFAULT '');
