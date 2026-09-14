-- Meeting links hosts reuse across event types (a Meet room, a Zoom URL).
-- Kept per platform so the booking form can offer "recently used" instead of
-- forcing the host to retype the same URL.
CREATE TABLE saved_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    location_type TEXT NOT NULL,
    location_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, location_type, location_value)
);

CREATE INDEX idx_saved_locations_user ON saved_locations(user_id, location_type);