-- Flight Price Tracker schema (SQLite v1), matching architecture v2.
--
-- Note on preferred_routes.flight_date: for routes generated from an event,
-- this is the specific date the AI picked. For routes added manually for
-- long-term tracking (no event), it's left NULL and target_date_offset_days
-- is used instead to compute a rolling "today + N days" date at check time
-- -- the doc calls out that these two cases differ but doesn't say what a
-- non-event route's date should be, so this column fills that gap.

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL,
    event_datetime TIMESTAMP NOT NULL,
    location TEXT NOT NULL,
    origin TEXT NOT NULL,
    flexibility_days INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preferred_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    flight_date DATE,                          -- specific date if event-derived; NULL for general routes
    target_date_offset_days INTEGER DEFAULT 30, -- used only when flight_date IS NULL
    preferred_time_window TEXT,                 -- AI-suggested window, e.g. "sáng sớm 6-8h"; display only
    event_id INTEGER,
    ai_reasoning TEXT,                          -- why the AI picked this slot, saved once, reused in emails
    status TEXT NOT NULL DEFAULT 'tracking',    -- 'tracking' | 'booked' | 'expired'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,
    flight_date DATE NOT NULL,
    departure_time TEXT,
    price INTEGER NOT NULL,
    airline TEXT,
    checked_at TIMESTAMP NOT NULL,
    FOREIGN KEY (route_id) REFERENCES preferred_routes(id)
);

CREATE TABLE IF NOT EXISTS notifications_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER,
    type TEXT NOT NULL,              -- 'price_drop' | 'price_increase'
    sent_at TIMESTAMP NOT NULL,
    email_content TEXT,
    FOREIGN KEY (route_id) REFERENCES preferred_routes(id)
);

CREATE INDEX IF NOT EXISTS idx_price_history_route_checked
    ON price_history(route_id, checked_at);

CREATE INDEX IF NOT EXISTS idx_routes_status ON preferred_routes(status);
