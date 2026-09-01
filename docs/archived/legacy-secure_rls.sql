ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_projects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM anon;
REVOKE ALL ON TABLE public.projects FROM anon;
REVOKE ALL ON TABLE public.user_projects FROM anon;

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

CREATE POLICY users_delete_own ON public.users
FOR DELETE TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS projects_select_authenticated ON public.projects;
DROP POLICY IF EXISTS projects_insert_authenticated ON public.projects;
DROP POLICY IF EXISTS projects_update_authenticated ON public.projects;

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
