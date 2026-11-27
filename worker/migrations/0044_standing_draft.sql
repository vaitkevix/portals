-- SH | Aizvietošana (C4): pastāvīgās aizvietošanas melnraksts no apstiprināta atvaļinājuma / prombūtnes. melnraksts '1' = gaida vadītāju, 'noraidīts'; brigade = izvēlētais aizvietotājs; avots = 'vac:A-0001:<anorm>' / 'abs:<id>:<anorm>'. © VAITKEVIX, SIA
ALTER TABLE standing ADD COLUMN melnraksts TEXT NOT NULL DEFAULT '';
ALTER TABLE standing ADD COLUMN brigade TEXT NOT NULL DEFAULT '';
ALTER TABLE standing ADD COLUMN avots TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS standing_avots ON standing (avots);
