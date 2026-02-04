-- Admin Approval System
-- Run this in Supabase SQL Editor

-- 1. Add approval columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked')),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS approved_by BIGINT;

-- 2. Create function to check if user is approved
CREATE OR REPLACE FUNCTION is_user_approved(telegram_id_check BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users 
    WHERE telegram_id = telegram_id_check 
    AND status = 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
