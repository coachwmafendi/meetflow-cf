-- One read-only Google Calendar connection per host. Tokens are stored encrypted
-- (AES-GCM, key from the GOOGLE_TOKEN_KEY secret) and refreshed on use.
-- Reconnecting upserts, so there is exactly one row per host.
CREATE TABLE google_connections (
    user_id INTEGER PRIMARY KEY,
    google_email TEXT NOT NULL,
    enc_refresh TEXT NOT NULL,
    enc_access TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);