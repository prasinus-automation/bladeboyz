/**
 * Supabase client singleton. Reads `VITE_SUPABASE_URL` +
 * `VITE_SUPABASE_ANON_KEY` from the Vite env (see `.env.example` and
 * `docs/supabase-setup.md`).
 *
 * GRACEFUL DEGRADATION: when the env isn't configured, `getSupabase()`
 * returns null and every auth surface falls back to guest mode — the game
 * must remain fully playable (practice AND multiplayer-as-guest) without
 * any Supabase project. Tests run without env by design.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let initialized = false;

export function getSupabase(): SupabaseClient | null {
  if (initialized) return client;
  initialized = true;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return null;
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}
