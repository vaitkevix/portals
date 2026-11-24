-- SH | Mājas lieta: apvienoto objektu sastāvdaļas, ko admins norādījis ar roku (parts = JSON adrešu masīvs; 'auto' = sadalīt pēc adreses). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS ml_parts (anorm TEXT PRIMARY KEY, parts TEXT NOT NULL DEFAULT 'auto', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '');
