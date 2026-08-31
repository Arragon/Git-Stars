begin;
create extension if not exists pgtap;

select plan(4);

select has_table('public', 'users', 'users table exists');
select has_table('public', 'projects', 'projects table exists');
select has_table('public', 'user_projects', 'user_projects table exists');
select has_table('public', 'collections', 'collections table exists');

select * from finish();
rollback;
