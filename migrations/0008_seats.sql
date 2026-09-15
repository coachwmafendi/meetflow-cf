-- Seats per slot (group events). seats_total = 1 keeps today's private 1:1
-- behaviour; N > 1 lets N guests share one booked slot, each recorded as an
-- attendee row. The bookings row keeps representing the slot, so the overlap
-- engine, unique index, buffers and reminder sweep are untouched.
ALTER TABLE event_types ADD COLUMN seats_total INTEGER NOT NULL DEFAULT 1;

-- The people attending a booked slot. The slot's first guest is stored both on
-- the bookings row (legacy columns) and as the first attendee.
CREATE TABLE booking_attendees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    notes TEXT,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (booking_id)
        REFERENCES bookings(id)
        ON DELETE CASCADE
);

-- One confirmed seat per email per slot; a cancelled guest may rejoin.
CREATE UNIQUE INDEX idx_attendees_unique_confirmed
ON booking_attendees(booking_id, guest_email)
WHERE status = 'confirmed';

CREATE INDEX idx_attendees_booking
ON booking_attendees(booking_id);

CREATE INDEX idx_attendees_email
ON booking_attendees(guest_email);
