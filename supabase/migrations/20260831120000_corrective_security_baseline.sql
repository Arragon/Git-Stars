-- Corrective security baseline for the current GitHub-only schema.
--
-- Supersedes the unversioned supabase/migrations/secure_rls.sql (never applied by
-- the CLI, kept for reference in docs/archived/legacy-secure_rls.sql) and repairs
-- the permissive state left by 20240101000000_init.sql, which disabled RLS and
-- granted ALL PRIVILEGES on every business table to anon and authenticated.
--
-- Forward-only: earlier migrations are not edited. Idempotent, so installations
-- that already ran legacy-secure_rls.sql by hand converge to the same state.

-- 1. Future tables in public must not inherit client-role grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;

-- 2. Row Level Security on every exposed business table.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_projects ENABLE ROW LEVEL SECURITY;

-- 3. Reset client-role table grants, then grant only what the client performs.
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.projects FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_projects FROM anon, authenticated;
REVOKE ALL ON TABLE public.collections FROM anon, authenticated;
REVOKE ALL ON TABLE public.collection_projects FROM anon, authenticated;

-- anon receives nothing: the application is authenticated-only.
-- users: no DELETE, account rows are never removed by a client.
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO authenticated;
-- projects hold shared provider facts: no DELETE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.collections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.collection_projects TO authenticated;

-- 4. Ownership policies.

-- users: own row only, keyed on the Supabase auth subject.
DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_insert_own ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;
DROP POLICY IF EXISTS users_delete_own ON public.users;

CREATE POLICY users_select_own ON public.users
FOR SELECT TO authenticated
USING (id = auth.uid());

CREATE POLICY users_insert_own ON public.users
FOR INSERT TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY users_update_own ON public.users
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- projects: readable by any authenticated user; writable because the browser
-- currently performs provider sync and stores AI summaries on the shared row.
-- Column-level ownership arrives with the LibraryItem split (PHASE D); DELETE
-- stays unavailable so shared facts cannot be destroyed from a client.
DROP POLICY IF EXISTS projects_select_authenticated ON public.projects;
DROP POLICY IF EXISTS projects_insert_authenticated ON public.projects;
DROP POLICY IF EXISTS projects_update_authenticated ON public.projects;
DROP POLICY IF EXISTS projects_delete_authenticated ON public.projects;

CREATE POLICY projects_select_authenticated ON public.projects
FOR SELECT TO authenticated
USING (true);

CREATE POLICY projects_insert_authenticated ON public.projects
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY projects_update_authenticated ON public.projects
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- user_projects: star/fork membership belongs to one user.
DROP POLICY IF EXISTS user_projects_select_own ON public.user_projects;
DROP POLICY IF EXISTS user_projects_insert_own ON public.user_projects;
DROP POLICY IF EXISTS user_projects_update_own ON public.user_projects;
DROP POLICY IF EXISTS user_projects_delete_own ON public.user_projects;

CREATE POLICY user_projects_select_own ON public.user_projects
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY user_projects_insert_own ON public.user_projects
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_projects_update_own ON public.user_projects
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY user_projects_delete_own ON public.user_projects
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- collections / collection_projects already carry ownership policies from
-- 20260510000000_collections.sql; they are re-asserted here so installations
-- created before that migration, or hand-patched ones, converge.
DROP POLICY IF EXISTS collections_select_own ON public.collections;
DROP POLICY IF EXISTS collections_insert_own ON public.collections;
DROP POLICY IF EXISTS collections_update_own ON public.collections;
DROP POLICY IF EXISTS collections_delete_own ON public.collections;

CREATE POLICY collections_select_own ON public.collections
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY collections_insert_own ON public.collections
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY collections_update_own ON public.collections
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY collections_delete_own ON public.collections
FOR DELETE TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS collection_projects_select_own ON public.collection_projects;
DROP POLICY IF EXISTS collection_projects_insert_own ON public.collection_projects;
DROP POLICY IF EXISTS collection_projects_update_own ON public.collection_projects;
DROP POLICY IF EXISTS collection_projects_delete_own ON public.collection_projects;

CREATE POLICY collection_projects_select_own ON public.collection_projects
FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_projects.collection_id
      AND c.user_id = auth.uid()
));

CREATE POLICY collection_projects_insert_own ON public.collection_projects
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_projects.collection_id
      AND c.user_id = auth.uid()
));

CREATE POLICY collection_projects_update_own ON public.collection_projects
FOR UPDATE TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_projects.collection_id
      AND c.user_id = auth.uid()
))
WITH CHECK (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_projects.collection_id
      AND c.user_id = auth.uid()
));

CREATE POLICY collection_projects_delete_own ON public.collection_projects
FOR DELETE TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_projects.collection_id
      AND c.user_id = auth.uid()
));
