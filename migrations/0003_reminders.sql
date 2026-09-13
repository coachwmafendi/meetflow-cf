-- Marks when the 24-hour reminder was queued, so the hourly cron sweep never
-- sends the same guest two reminders. NULL means "not reminded yet".
ALTER TABLE bookings ADD COLUMN reminder_sent_at TEXT;

-- The sweep looks for confirmed bookings in a start_at window that still need a
-- reminder; this keeps that scan off a full table read.
CREATE INDEX idx_bookings_reminder_due
ON bookings(start_at)
WHERE status = 'confirmed' AND reminder_sent_at IS NULL;
