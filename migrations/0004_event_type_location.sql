-- Where a meeting happens. location_type picks the rendering on the booking
-- page ("none" means the host never set one); location_value holds the Meet or
-- Zoom URL, the street address, or the phone number.
ALTER TABLE event_types ADD COLUMN location_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE event_types ADD COLUMN location_value TEXT;