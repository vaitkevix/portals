-- SH | Fiksētā līgumcena: klienta abonēšanas rindas (objekts vai visi, apraksts, €/mēn., spēkā no/līdz). Atskaitē un rēķinā kā «ligums». © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS client_sub (id TEXT PRIMARY KEY, client TEXT NOT NULL, anorm TEXT NOT NULL DEFAULT '', adrese TEXT NOT NULL DEFAULT '', apraksts TEXT NOT NULL DEFAULT '',
  summa REAL NOT NULL DEFAULT 0, no TEXT NOT NULL DEFAULT '', lidz TEXT NOT NULL DEFAULT '', avots TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS client_sub_c ON client_sub (client);
