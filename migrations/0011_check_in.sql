-- Door check-in: when the host verifies a guest's ticket at the door. Null
-- until checked in; a cancelled seat can never be checked in (enforced in the
-- UPDATE guard).
ALTER TABLE booking_attendees ADD COLUMN checked_in_at TEXT;
