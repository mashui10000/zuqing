create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_states enable row level security;

grant select, insert, update, delete on table public.app_states to authenticated;
revoke all on table public.app_states from anon;

drop policy if exists "app_states_select_own" on public.app_states;
create policy "app_states_select_own"
on public.app_states
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "app_states_insert_own" on public.app_states;
create policy "app_states_insert_own"
on public.app_states
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "app_states_update_own" on public.app_states;
create policy "app_states_update_own"
on public.app_states
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "app_states_delete_own" on public.app_states;
create policy "app_states_delete_own"
on public.app_states
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_app_states_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_states_updated_at on public.app_states;
create trigger set_app_states_updated_at
before update on public.app_states
for each row execute function public.set_app_states_updated_at();
