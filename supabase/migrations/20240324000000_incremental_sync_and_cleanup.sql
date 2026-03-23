-- Add new columns to users table for incremental sync and auto-cleanup
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create an index on last_login_at for faster cleanup queries
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);

-- Create a function to perform capacity-based cleanup
-- Keep max 1000 users (configurable), delete oldest by last_login_at
CREATE OR REPLACE FUNCTION cleanup_old_users(max_users INT DEFAULT 1000)
RETURNS void AS $$
BEGIN
    DELETE FROM users
    WHERE id IN (
        SELECT id FROM users
        ORDER BY last_login_at DESC
        OFFSET max_users
    );
END;
$$ LANGUAGE plpgsql;

-- Create a function to perform time-based cleanup
-- Delete users who haven't logged in for 'days_inactive' days
CREATE OR REPLACE FUNCTION cleanup_inactive_users(days_inactive INT DEFAULT 30)
RETURNS void AS $$
BEGIN
    DELETE FROM users
    WHERE last_login_at < NOW() - (days_inactive || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;
