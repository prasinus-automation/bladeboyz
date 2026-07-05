# Supabase Setup — Accounts, Credits & Freemium Groundwork

The game works **without** Supabase (guest mode everywhere). Configuring it
enables: account creation / sign-in on the main menu, verified display
names in multiplayer, and the `credits` balance shown on the BUY CREDITS
panel.

## 1. Create the project

1. In your Supabase dashboard, create (or reuse) a project.
2. Project Settings → API: copy the **Project URL** and the **anon public
   key**.

## 2. Apply the migration

Either:

- **CLI**: `supabase link --project-ref <ref>` then `supabase db push`
  (migrations live in `supabase/migrations/`), or
- **Dashboard**: paste `supabase/migrations/20260705120000_profiles_credits.sql`
  into the SQL editor and run it.

What it creates:

| Object | Purpose |
| --- | --- |
| `profiles` | one row per user: `username` (unique), `credits` (premium currency, server-write-only) |
| `credits_ledger` | append-only audit of every credit mutation |
| `skins`, `profile_skins` | freemium catalog + ownership (3 starter skins seeded) |
| `handle_new_user` trigger | auto-creates the profile on signup (username from signup metadata, deduped) |
| `protect_credits` trigger | rejects any non-service-role change to `credits` |
| `grant_credits(profile, delta, reason)` | **service-role only** — call from a payment webhook / edge function / trusted server |
| `spend_credits(delta, reason)` | client-callable atomic spend (validates balance) |
| `purchase_skin(skin_id)` | spend + grant ownership in one transaction |

## 3. Configure the client

```bash
cp .env.example .env
# fill in:
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Vite injects both at build time. Restart `npm run dev` after editing.

For quick local testing, consider Dashboard → Authentication → Providers →
Email → disable "Confirm email" (otherwise new accounts must click the
confirmation link before signing in).

## 4. Configure the game server (optional but recommended)

The multiplayer server verifies Supabase access tokens so display names
can't be spoofed. Give it the same two values (non-VITE names work too):

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> npm run dev:server
```

In the deploy container, pass them as environment variables. Without them
the server accepts guests only (client-chosen names, sanitized).

## 5. Credits & payments (the freemium path)

- `credits` is the premium currency; in-match gold stays game-side.
- The BUY CREDITS button is a stub on purpose: real purchases should be a
  **Stripe Checkout → webhook → edge function → `grant_credits`** flow so
  the client never touches balances. The RPC + ledger are ready for it.
- Skins are the first planned sink: `purchase_skin('goldenboy')` from the
  client once a skin picker ships. `profiles.credits` and ownership rows
  are already enforced server-side.

## Verify the guardrails (once, after applying)

Run as a signed-in user (SQL editor "Run as" or a client session):

```sql
-- (i) MUST fail: clients can never write credits directly.
update public.profiles set credits = credits + 1000 where id = auth.uid();
-- (ii) MUST succeed (given balance ≥ 1): the definer RPC path is allowed.
select public.spend_credits(1, 'smoke-test');
```

The trigger admits the RPCs via a transaction-scoped `set_config` flag
(`SECURITY DEFINER` does not change `current_setting('role')`, so a naive
role check would block legitimate spends — see the comment on
`protect_credits` in the migration).

## Security model recap

- Clients can read their own profile/ledger/skins and everyone's username.
- Clients can NEVER write `credits` (trigger-enforced, even through RLS
  gaps) — only `grant_credits` under the service role.
- The game server treats Supabase identity as canonical when configured;
  guests are clearly guests.
