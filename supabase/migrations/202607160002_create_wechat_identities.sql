create table if not exists public.wechat_identities (
  identity_hash text primary key check (identity_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

comment on table public.wechat_identities is
  'Server-only mapping from a SHA-256 WeChat identity hash to a Supabase Auth user.';

alter table public.wechat_identities enable row level security;

revoke all on table public.wechat_identities from public, anon, authenticated;
grant select, insert, update, delete on table public.wechat_identities to service_role;

drop policy if exists "wechat_identities_deny_client_access" on public.wechat_identities;
create policy "wechat_identities_deny_client_access"
on public.wechat_identities
for all
to anon, authenticated
using (false)
with check (false);
