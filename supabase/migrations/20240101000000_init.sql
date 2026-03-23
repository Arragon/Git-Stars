-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id VARCHAR(50) UNIQUE NOT NULL,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id BIGINT UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    full_name VARCHAR(300) NOT NULL,
    description TEXT,
    language VARCHAR(100),
    stars_count INTEGER DEFAULT 0,
    forks_count INTEGER DEFAULT 0,
    html_url TEXT NOT NULL,
    github_created_at TIMESTAMP WITH TIME ZONE,
    github_updated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create user_projects table
CREATE TABLE IF NOT EXISTS user_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(20) CHECK (type IN ('star', 'fork')),
    starred_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, project_id, type)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_projects_github_id ON projects(github_id);
CREATE INDEX IF NOT EXISTS idx_projects_language ON projects(language);
CREATE INDEX IF NOT EXISTS idx_projects_stars_count ON projects(stars_count DESC);
CREATE INDEX IF NOT EXISTS idx_user_projects_user_id ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project_id ON user_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_type ON user_projects(type);

-- Basic access permissions
GRANT SELECT ON users TO anon;
GRANT SELECT ON projects TO anon;
GRANT SELECT ON user_projects TO anon;

-- Authenticated user permissions
GRANT ALL PRIVILEGES ON users TO authenticated;
GRANT ALL PRIVILEGES ON projects TO authenticated;
GRANT ALL PRIVILEGES ON user_projects TO authenticated;

-- Disable Row Level Security (RLS) entirely to avoid permission issues during data sync
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_projects DISABLE ROW LEVEL SECURITY;

-- Grant all privileges to anon and authenticated roles
GRANT ALL PRIVILEGES ON users TO anon, authenticated;
GRANT ALL PRIVILEGES ON projects TO anon, authenticated;
GRANT ALL PRIVILEGES ON user_projects TO anon, authenticated;

-- Grant usage on sequence if any exists
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Ensure default privileges allow future tables to be accessed
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;



