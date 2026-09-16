-- Date-specific events: some bookings happen on fixed dates (a twice-a-year
-- briefing) rather than on a weekly schedule. dates_only = 1 makes the event
-- type ignore the host's weekly rules entirely and generate slots only from
-- its listed dates. Weekly types (dates_only = 0) are untouched.
ALTER TABLE event_types ADD COLUMN dates_only INTEGER NOT NULL DEFAULT 0;

CREATE TABLE event_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (event_type_id)
        REFERENCES event_types(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_event_dates_type ON event_dates(event_type_id, date);
