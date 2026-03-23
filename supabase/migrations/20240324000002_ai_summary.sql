-- Add columns for AI summary and tags
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_tags TEXT[] DEFAULT '{}'::TEXT[];

-- Create index for array elements to make tag searching faster
CREATE INDEX IF NOT EXISTS idx_projects_ai_tags ON projects USING GIN (ai_tags);
