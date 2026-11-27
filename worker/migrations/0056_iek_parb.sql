-- SH | I7 obligāto pārbaužu termiņi (Mājas lietas iekārtu reģistrs): nakama — ar roku norādīts nākamais datums (citādi pēdējā + intervāls),
-- obligata — obligāta pārbaude (dūmvadi, ugunsdzēšamie aparāti, lifts, rotaļlaukums, apdrošināšana, elektroinstalācija), atg — pēdējais atgādinājums «<slieksnis>:<datums>». © VAITKEVIX, SIA
ALTER TABLE ml_iek ADD COLUMN nakama TEXT NOT NULL DEFAULT '';
ALTER TABLE ml_iek ADD COLUMN obligata INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ml_iek ADD COLUMN atg TEXT NOT NULL DEFAULT '';
