begin;
create extension if not exists pgtap;

select plan(30);

-- Fixtures are created as the session (owner) role, which bypasses RLS.
insert into public.users (id, github_id, username) values
  ('11111111-1111-1111-1111-111111111111', 'gh-a', 'user-a'),
  ('22222222-2222-2222-2222-222222222222', 'gh-b', 'user-b');

insert into public.projects (id, github_id, name, full_name, html_url) values
  ('33333333-3333-3333-3333-333333333333', 101, 'repo-a', 'owner/repo-a', 'https://example.com/owner/repo-a'),
  ('34343434-3434-3434-3434-343434343434', 102, 'repo-b', 'owner/repo-b', 'https://example.com/owner/repo-b');

insert into public.user_projects (user_id, project_id, type) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'star'),
  ('22222222-2222-2222-2222-222222222222', '34343434-3434-3434-3434-343434343434', 'star');

insert into public.collections (id, user_id, name) values
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'collection-a'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'collection-b');

insert into public.collection_projects (collection_id, project_id) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333'),
  ('55555555-5555-5555-5555-555555555555', '34343434-3434-3434-3434-343434343434');

-- row level security is enabled on every exposed business table.
select is((select relrowsecurity from pg_class where oid = 'public.users'::regclass), true, 'RLS enabled on users');
select is((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), true, 'RLS enabled on projects');
select is((select relrowsecurity from pg_class where oid = 'public.user_projects'::regclass), true, 'RLS enabled on user_projects');
select is((select relrowsecurity from pg_class where oid = 'public.collections'::regclass), true, 'RLS enabled on collections');
select is((select relrowsecurity from pg_class where oid = 'public.collection_projects'::regclass), true, 'RLS enabled on collection_projects');

-- anonymous callers are rejected on every business table.
set local role anon;

select throws_ok('select id from public.users', '42501', null, 'anon cannot read users');
select throws_ok('select id from public.projects', '42501', null, 'anon cannot read projects');
select throws_ok('select id from public.user_projects', '42501', null, 'anon cannot read user_projects');
select throws_ok('select id from public.collections', '42501', null, 'anon cannot read collections');
select throws_ok('select id from public.collection_projects', '42501', null, 'anon cannot read collection_projects');

reset role;

-- user A is isolated from user B and keeps working on its own rows.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

select is((select count(*)::int from public.users), 1, 'user A sees only its own users row');
select is((select count(*)::int from public.user_projects), 1, 'user A sees only its own user_projects rows');
select is((select count(*)::int from public.collections), 1, 'user A sees only its own collections');
select is((select count(*)::int from public.collection_projects), 1, 'user A sees only its own collection_projects');

select throws_ok(
  $$insert into public.collections (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'hijacked')$$,
  '42501', null, 'user A cannot create a collection owned by user B');

select throws_ok(
  $$insert into public.collection_projects (collection_id, project_id)
    values ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333')$$,
  '42501', null, 'user A cannot add projects to a collection owned by user B');

with updated as (
  update public.users set username = 'hijacked'
  where id = '22222222-2222-2222-2222-222222222222' returning 1)
select is(
  (select count(*)::int from updated),
  0, 'user A cannot update user B''s users row');

select throws_ok('delete from public.projects', '42501', null, 'authenticated cannot delete shared project facts');
select throws_ok('delete from public.users', '42501', null, 'authenticated cannot delete users rows');

with updated as (
  update public.users set last_synced_at = now()
  where id = '11111111-1111-1111-1111-111111111111' returning 1)
select is(
  (select count(*)::int from updated),
  1, 'user A can update its own users row');

select lives_ok(
  $$insert into public.projects (github_id, name, full_name, html_url)
    values (103, 'repo-c', 'owner/repo-c', 'https://example.com/owner/repo-c')$$,
  'authenticated can insert project facts (browser-side sync)');

select lives_ok(
  $$insert into public.user_projects (user_id, project_id, type)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'fork')$$,
  'user A can insert its own membership row');

select lives_ok(
  $$insert into public.collections (user_id, name) values ('11111111-1111-1111-1111-111111111111', 'collection-a2')$$,
  'user A can create its own collection');

select lives_ok(
  $$insert into public.collection_projects (collection_id, project_id)
    values ('44444444-4444-4444-4444-444444444444', '34343434-3434-3434-3434-343434343434')$$,
  'user A can add a project to its own collection');

reset role;

-- destructive maintenance functions are unavailable to client roles.
select ok(not has_function_privilege('anon', 'public.cleanup_old_users(int)', 'execute'),
  'anon cannot execute cleanup_old_users');
select ok(not has_function_privilege('authenticated', 'public.cleanup_old_users(int)', 'execute'),
  'authenticated cannot execute cleanup_old_users');
select ok(not has_function_privilege('anon', 'public.cleanup_inactive_users(int)', 'execute'),
  'anon cannot execute cleanup_inactive_users');
select ok(not has_function_privilege('authenticated', 'public.cleanup_inactive_users(int)', 'execute'),
  'authenticated cannot execute cleanup_inactive_users');
select is((select count(*)::int from public.users), 2, 'fixture users survive the whole run');
select is((select count(*)::int from public.collections where user_id = '22222222-2222-2222-2222-222222222222'), 1,
  'user B collections survive the whole run');

select * from finish();
rollback;
