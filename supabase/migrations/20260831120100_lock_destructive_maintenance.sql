-- Make the destructive maintenance functions unreachable from client roles.
--
-- 20240324000000_incremental_sync_and_cleanup.sql created cleanup_old_users() and
-- cleanup_inactive_users(), which DELETE FROM users and therefore cascade into
-- user_projects and collections. plpgsql functions grant EXECUTE to PUBLIC by
-- default, so any browser session could invoke them through PostgREST rpc.
--
-- The functions are kept for operator-run history management; only the grants
-- change here.

REVOKE ALL ON FUNCTION public.cleanup_old_users(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_old_users(INT) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.cleanup_inactive_users(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_inactive_users(INT) FROM anon, authenticated;
