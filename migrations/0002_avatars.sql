-- Host avatars live in R2; the row stores only the object key.
-- Nullable: every existing host keeps their monogram until they upload one.
ALTER TABLE users ADD COLUMN avatar_key TEXT;
