-- SH | I3/I4 pieteikumi par māju: iedzīvotāji (QR mājas lapa) un darbinieki («Pamanīju bojājumu», SMS BOJ). Nedzēš. © VAITKEVIX, SIA
-- atslega — iedzīvotāja statusa saite (maja.html#r=…); kontakts tikai ar piekrišanu (piekrit = 1), publiski netiek rādīts.
CREATE TABLE IF NOT EXISTS ml_req (id TEXT PRIMARY KEY, atslega TEXT NOT NULL UNIQUE, anorm TEXT NOT NULL, adrese TEXT NOT NULL DEFAULT '', avots TEXT NOT NULL DEFAULT 'iedzivotajs',
  kategorija TEXT NOT NULL DEFAULT '', teksts TEXT NOT NULL DEFAULT '', foto TEXT NOT NULL DEFAULT '', kontakts TEXT NOT NULL DEFAULT '', piekrit INTEGER NOT NULL DEFAULT 0,
  steidz TEXT NOT NULL DEFAULT '', ai TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'jauns', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '',
  atjaunots TEXT NOT NULL DEFAULT '', apstr TEXT NOT NULL DEFAULT '', darbs TEXT NOT NULL DEFAULT '', atbilde TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT '', visit TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ml_req_a ON ml_req (anorm, statuss);
CREATE INDEX IF NOT EXISTS ml_req_s ON ml_req (statuss, laiks);
