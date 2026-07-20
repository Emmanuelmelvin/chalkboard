import { create } from 'zustand';
import { authService } from '@/services/authService';
import type { AuthUser } from '@/types/app';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => void;
  completeOnboarding: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  loading: true,
  error: null,

  hydrate: async () => {
    const stored = authService.readStoredSession();
    if (!stored) {
      set({ loading: false });
      return;
    }
    set({ loading: true, error: null, token: stored.token, user: stored.user });
    try {
      const session = await authService.getMe(stored.token);
      authService.storeSession(session);
      set({ token: session.token, user: session.user, loading: false });
    } catch (error) {
      authService.storeSession(null);
      set({ token: null, user: null, loading: false, error: error instanceof Error ? error.message : 'Session expired' });
    }
  },

  signInWithGoogle: async () => {
    set({ loading: true, error: null });
    await authService.beginGoogleSignIn();
    const session = authService.readStoredSession();
    set({ token: session?.token ?? null, user: session?.user ?? null, loading: false });
  },

  signOut: () => {
    authService.storeSession(null);
    set({ user: null, token: null, loading: false, error: null });
  },

  completeOnboarding: async () => {
    const token = get().token;
    if (!token) return;
    const session = await authService.completeOnboarding(token);
    set({ token: session.token, user: session.user });
  },
}));
