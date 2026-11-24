-- SH | Aizvietošana: viena sērijas (pastāvīgā / vairāku dienu) darba rinda dienā — novērš dublikātus, ja ensureStanding izsauc vienlaicīgi. © VAITKEVIX, SIA
CREATE UNIQUE INDEX IF NOT EXISTS jobs_serija_datums ON jobs (serija, datums) WHERE serija != '';
