-- SH | Web Push abonementi (pēc cilvēka vārda). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, name TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS push_subs_n ON push_subs (name);
