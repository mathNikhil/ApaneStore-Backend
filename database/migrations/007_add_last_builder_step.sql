-- Add last_builder_step column to stores table
ALTER TABLE stores 
ADD COLUMN IF NOT EXISTS last_builder_step INTEGER DEFAULT 1;
