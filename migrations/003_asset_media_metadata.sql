-- Durable metadata supports model validation while media bytes remain on disk.
ALTER TABLE assets ADD COLUMN size_bytes INTEGER;
ALTER TABLE assets ADD COLUMN codec TEXT;
ALTER TABLE assets ADD COLUMN container TEXT;
ALTER TABLE assets ADD COLUMN fps REAL;
