-- CuriousMind Database Schema
-- Run this in Supabase SQL Editor

-- ============ TABLES ============

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE NOT NULL,
    telegram_username TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    receive_scheduled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recommendations table
CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    author TEXT,
    url TEXT NOT NULL,
    description TEXT,
    reason TEXT,
    tags TEXT[],
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-Recommendation junction table
CREATE TABLE IF NOT EXISTS user_recommendations (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    recommendation_id UUID REFERENCES recommendations(id) ON DELETE CASCADE,
    telegram_message_id BIGINT,
    rating INTEGER CHECK (rating >= 0 AND rating <= 5),
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    rated_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, recommendation_id)
);

-- User preferences (taste weights)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    weight REAL DEFAULT 50.0,
    sample_count INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, tag)
);

-- ============ INDEXES ============

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_url ON recommendations(url);
CREATE INDEX IF NOT EXISTS idx_user_recommendations_user ON user_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_recommendations_message ON user_recommendations(telegram_message_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);

-- ============ ROW LEVEL SECURITY ============

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations via service role key (anon key with RLS bypass)
-- In production, you'd want more restrictive policies

-- Users: Allow insert/select/update for anon role
CREATE POLICY "Allow all user operations" ON users FOR ALL USING (true) WITH CHECK (true);

-- Recommendations: Allow all (shared across users)
CREATE POLICY "Allow all recommendation operations" ON recommendations FOR ALL USING (true) WITH CHECK (true);

-- User Recommendations: Allow all
CREATE POLICY "Allow all user_recommendation operations" ON user_recommendations FOR ALL USING (true) WITH CHECK (true);

-- User Preferences: Allow all
CREATE POLICY "Allow all user_preference operations" ON user_preferences FOR ALL USING (true) WITH CHECK (true);

-- ============ INITIAL DATA (Optional) ============

-- Seed some initial tags if you want users to start with preferences
-- INSERT INTO user_preferences (user_id, tag, weight) VALUES (...);
