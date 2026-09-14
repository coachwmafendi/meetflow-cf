-- Gap after each meeting of an event type, so the host is never back-to-back.
-- 0 means meetings may follow each other with no gap.
ALTER TABLE event_types ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 0;