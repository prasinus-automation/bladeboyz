-- BladeBoyz — profiles, credits, and freemium groundwork.
-- Apply with: supabase db push   (or paste into the SQL editor).
-- See docs/supabase-setup.md for the full setup walkthrough.

-- ── profiles ────────────────────────────────────────────────────────────
-- One row per auth user. `credits` is the premium currency (distinct from
-- in-match gold, which is ephemeral/game-side). Server-authoritative
-- mutations only — clients can READ their credits but never write them.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (char_length(username) between 2 and 20
           and username ~ '^[A-Za-z0-9_\- ]+$'),
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone signed-in can read usernames (scoreboards, killfeeds).
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

-- Users may update ONLY their own username — never credits (enforced by
-- the trigger below; RLS alone can't do column-level checks).
create policy "users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Column-level guard: reject any client-side change to `credits`.
--
-- IMPORTANT (QA finding on PR #193): SECURITY DEFINER does NOT change
-- `current_setting('role')` — a client-invoked RPC still reports
-- 'authenticated', so a role check alone would also block the legitimate
-- spend/grant RPCs below. Those RPCs therefore set a TRANSACTION-SCOPED
-- flag (`set_config(..., is_local => true)`, auto-cleared at COMMIT/ABORT)
-- immediately before their UPDATE; the trigger accepts either that flag
-- or a genuine service_role session. Clients cannot set the flag to any
-- effect: `set_config` inside their own transaction doesn't survive into
-- an RPC (which runs its own function scope) and a raw UPDATE with the
-- flag set still can't bypass RLS row checks or the RPCs' balance logic —
-- the flag only exists so OUR definer functions can pass this trigger.
create or replace function public.protect_credits()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.credits is distinct from old.credits
     and coalesce(current_setting('bladeboyz.credit_write', true), '') <> 'allowed'
     and current_setting('role', true) <> 'service_role' then
    raise exception 'credits can only be changed server-side';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_credits on public.profiles;
create trigger protect_credits
  before update on public.profiles
  for each row execute function public.protect_credits();

-- Auto-create a profile on signup. Username comes from the signup
-- metadata (`options.data.username`), falling back to the email prefix,
-- de-duplicated with a numeric suffix.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  base_name text;
  candidate text;
  suffix integer := 0;
begin
  base_name := coalesce(
    nullif(regexp_replace(new.raw_user_meta_data ->> 'username', '[^A-Za-z0-9_\- ]', '', 'g'), ''),
    split_part(new.email, '@', 1)
  );
  base_name := left(base_name, 20);
  if char_length(base_name) < 2 then
    base_name := 'player';
  end if;
  candidate := base_name;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(base_name, 20 - char_length(suffix::text)) || suffix::text;
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── credits ledger ──────────────────────────────────────────────────────
-- Append-only audit trail for every credit mutation. Payments (Stripe
-- webhook → edge function) and kill rewards write here via the RPCs below.

create table if not exists public.credits_ledger (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null,
  reason text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.credits_ledger enable row level security;

create policy "users can read own ledger"
  on public.credits_ledger for select
  to authenticated
  using (auth.uid() = profile_id);

-- Server-side credit mutation (service_role only — call from an edge
-- function / payment webhook / trusted game server, NEVER from the client).
create or replace function public.grant_credits(
  p_profile_id uuid,
  p_delta integer,
  p_reason text,
  p_metadata jsonb default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'grant_credits is service-role only';
  end if;
  perform set_config('bladeboyz.credit_write', 'allowed', true);
  update public.profiles
    set credits = credits + p_delta
    where id = p_profile_id
    returning credits into new_balance;
  if new_balance is null then
    raise exception 'no such profile %', p_profile_id;
  end if;
  insert into public.credits_ledger (profile_id, delta, reason, metadata)
    values (p_profile_id, p_delta, p_reason, p_metadata);
  return new_balance;
end;
$$;

-- Client-callable spend (validates balance atomically; used for future
-- in-game purchases like skins).
create or replace function public.spend_credits(
  p_delta integer,
  p_reason text,
  p_metadata jsonb default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if p_delta <= 0 then
    raise exception 'spend amount must be positive';
  end if;
  perform set_config('bladeboyz.credit_write', 'allowed', true);
  update public.profiles
    set credits = credits - p_delta
    where id = auth.uid() and credits >= p_delta
    returning credits into new_balance;
  if new_balance is null then
    raise exception 'insufficient credits';
  end if;
  insert into public.credits_ledger (profile_id, delta, reason, metadata)
    values (auth.uid(), -p_delta, p_reason, p_metadata);
  return new_balance;
end;
$$;

-- Permission hardening: the in-body role check on grant_credits is
-- belt-and-braces; the real gate is EXECUTE. Definer functions default to
-- PUBLIC execute — revoke and re-grant deliberately.
revoke execute on function public.grant_credits(uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, jsonb) to service_role;
revoke execute on function public.spend_credits(integer, text, jsonb) from public, anon;
grant execute on function public.spend_credits(integer, text, jsonb) to authenticated;

-- ── skins (freemium groundwork) ─────────────────────────────────────────
-- Catalog + ownership. Purchasing a skin = spend_credits + insert into
-- profile_skins inside `purchase_skin` below.

create table if not exists public.skins (
  id text primary key,              -- e.g. 'crimson-steel'
  name text not null,
  description text not null default '',
  price_credits integer not null check (price_credits >= 0),
  body_color text not null,         -- hex like '#cc2244'
  created_at timestamptz not null default now()
);

alter table public.skins enable row level security;

create policy "skins are readable by everyone"
  on public.skins for select
  using (true);

create table if not exists public.profile_skins (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  skin_id text not null references public.skins (id) on delete cascade,
  purchased_at timestamptz not null default now(),
  primary key (profile_id, skin_id)
);

alter table public.profile_skins enable row level security;

create policy "users can read own skins"
  on public.profile_skins for select
  to authenticated
  using (auth.uid() = profile_id);

create or replace function public.purchase_skin(p_skin_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  price integer;
  new_balance integer;
begin
  select price_credits into price from public.skins where id = p_skin_id;
  if price is null then
    raise exception 'no such skin %', p_skin_id;
  end if;
  if exists (
    select 1 from public.profile_skins
    where profile_id = auth.uid() and skin_id = p_skin_id
  ) then
    raise exception 'skin already owned';
  end if;
  new_balance := public.spend_credits(price, 'skin', jsonb_build_object('skin_id', p_skin_id));
  insert into public.profile_skins (profile_id, skin_id) values (auth.uid(), p_skin_id);
  return new_balance;
end;
$$;

revoke execute on function public.purchase_skin(text) from public, anon;
grant execute on function public.purchase_skin(text) to authenticated;

-- Starter catalog.
insert into public.skins (id, name, description, price_credits, body_color) values
  ('crimson-steel', 'Crimson Steel', 'Battle-worn red plate.', 500, '#b03030'),
  ('midnight',      'Midnight',      'Black on black on black.', 500, '#20202c'),
  ('goldenboy',     'Goldenboy',     'For supporters with taste.', 1000, '#d4a017')
on conflict (id) do nothing;
