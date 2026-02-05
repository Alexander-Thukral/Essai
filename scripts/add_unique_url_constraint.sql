-- Migration: Add unique constraint to recommendations.url
-- Run this in Supabase SQL Editor to fix the "ON CONFLICT" error

ALTER TABLE recommendations ADD CONSTRAINT recommendations_url_key UNIQUE (url);
