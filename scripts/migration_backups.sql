-- Add backup_urls to recommendations table
ALTER TABLE recommendations 
ADD COLUMN IF NOT EXISTS backup_urls TEXT[];
