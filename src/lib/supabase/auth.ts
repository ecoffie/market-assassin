'use client';

import { getSupabase } from './client';
import type { User, Session } from '@supabase/supabase-js';

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: User;
  session?: Session;
}

/**
 * Sign up with email and password
 */
export async function signUp(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();

  if (!supabase) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user ?? undefined,
      session: data.session ?? undefined,
    };
  } catch (err) {
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();

  if (!supabase) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user,
      session: data.session,
    };
  } catch (err) {
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();

  if (!supabase) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Get the current user
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = getSupabase();

  if (!supabase) {
    return null;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    return null;
  }
}

/**
 * Get the current session
 */
export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();

  if (!supabase) {
    return null;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  } catch (err) {
    return null;
  }
}

/**
 * Reset password - sends email with reset link
 */
export async function resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();

  if (!supabase) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/planner/reset-password`,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: 'An unexpected error occurred' };
  }
}
