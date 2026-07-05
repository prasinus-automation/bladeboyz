/**
 * Auth session + profile state for the menus.
 *
 * Wraps Supabase auth (email/password v1) and the `profiles` row (username
 * + credits — see supabase/migrations/). Pubsub so menu widgets re-render
 * on sign-in/out and credit changes. Everything no-ops into guest mode
 * when Supabase env isn't configured.
 */

import { getSupabase } from './supabaseClient';

export interface Profile {
  id: string;
  username: string;
  credits: number;
}

export interface AuthState {
  /** null = signed out / guest. */
  profile: Profile | null;
  /** Supabase access token for the game-server join handshake. */
  accessToken: string | null;
  configured: boolean;
}

const state: AuthState = {
  profile: null,
  accessToken: null,
  configured: false,
};

type Listener = (s: AuthState) => void;
const listeners: Listener[] = [];

export function onAuthChange(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn(state);
    } catch (e) {
      console.error('[auth] listener error', e);
    }
  }
}

export function getAuthState(): AuthState {
  return state;
}

async function loadProfile(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    state.profile = null;
    state.accessToken = null;
    notify();
    return;
  }
  state.accessToken = session.access_token;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, credits')
    .eq('id', session.user.id)
    .single();
  if (!error && data) {
    state.profile = data as Profile;
  } else {
    // Profile row is created by the on-signup trigger; a brief race on
    // first sign-in is possible — fall back to a minimal profile.
    state.profile = {
      id: session.user.id,
      username: session.user.email?.split('@')[0] ?? 'player',
      credits: 0,
    };
  }
  notify();
}

/** Call once at boot: restores a persisted session + watches changes. */
export function initAuth(): void {
  const supabase = getSupabase();
  state.configured = supabase !== null;
  if (!supabase) {
    notify();
    return;
  }
  void loadProfile();
  supabase.auth.onAuthStateChange(() => {
    void loadProfile();
  });
}

export async function signUp(
  email: string,
  password: string,
  username: string,
): Promise<{ ok: boolean; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: 'Auth not configured' };
  const { error } = await supabase.auth.signUp({
    email,
    password,
    // The on-signup trigger reads `username` from raw_user_meta_data.
    options: { data: { username } },
  });
  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    message: 'Account created. Check your email if confirmation is enabled.',
  };
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: boolean; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: 'Auth not configured' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: 'Signed in.' };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  state.profile = null;
  state.accessToken = null;
  notify();
}

/** Refresh the profile row (e.g. after a credit grant). */
export async function refreshProfile(): Promise<void> {
  await loadProfile();
}
