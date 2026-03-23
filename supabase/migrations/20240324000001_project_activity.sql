-- Add columns for project activity trend analysis
ALTER TABLE projects ADD COLUMN IF NOT EXISTS activity_index NUMERIC DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS activity_details JSONB DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS activity_analyzed_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster sorting by activity
CREATE INDEX IF NOT EXISTS idx_projects_activity_index ON projects(activity_index DESC);
