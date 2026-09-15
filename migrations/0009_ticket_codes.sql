-- Event tickets: every seat gets a human-presentable code the host can check
-- against at the door. Null for legacy rows.
ALTER TABLE booking_attendees ADD COLUMN ticket_code TEXT;

CREATE UNIQUE INDEX idx_attendees_ticket_code
ON booking_attendees(ticket_code)
WHERE ticket_code IS NOT NULL;
