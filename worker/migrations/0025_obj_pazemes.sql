-- SH | Objekta kartīte: «Pazemes stāvvieta» (1 = ir, 0 = nav). Stāvvietu lietotnē redzami tikai objekti ar 1. Esošie stāvvietu objekti — 1. © VAITKEVIX, SIA
ALTER TABLE obj_info ADD COLUMN pazemes INTEGER;
INSERT INTO obj_info (anorm, pazemes) SELECT anorm, 1 FROM stav_obj WHERE 1 ON CONFLICT(anorm) DO UPDATE SET pazemes = 1;
