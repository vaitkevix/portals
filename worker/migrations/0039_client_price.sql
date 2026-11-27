-- SH | Cenu vēsture: klienta cena par vienību katrai lietotnei ar «spēkā no». Atskaite ņem cenu, kas spēkā darba datumā (bez vēstures — clients.cenas). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS client_price (client TEXT NOT NULL, app TEXT NOT NULL, cena REAL NOT NULL DEFAULT 0, no TEXT NOT NULL, kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (client, app, no));
