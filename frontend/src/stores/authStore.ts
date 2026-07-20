import { create } from 'zustand';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  profile: UserProfile | null;
  status: AuthStatus;
  error: string | null;
  hydrate: () => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

async function readUserResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.user) {
    throw new Error(payload.error || 'Unable to authenticate with Google.');
  }
  return payload.user as UserProfile;
}

export const useAuthStore = create<AuthState>((set) => {
  // A slow hydration request must not be able to undo a newer sign-in or sign-out.
  let authRequestId = 0;
  const beginAuthRequest = () => {
    authRequestId += 1;
    return authRequestId;
  };
  const isCurrentRequest = (requestId: number) => requestId === authRequestId;

  return {
    profile: null,
    status: 'loading',
    error: null,

    hydrate: async () => {
      const requestId = beginAuthRequest();
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!isCurrentRequest(requestId)) return;
        if (!response.ok || !payload.user) {
          set({ profile: null, status: 'unauthenticated', error: null });
          return;
        }
        set({ profile: payload.user as UserProfile, status: 'authenticated', error: null });
      } catch {
        if (isCurrentRequest(requestId)) {
          set({ profile: null, status: 'unauthenticated', error: 'The authentication service is unavailable.' });
        }
      }
    },

    signInWithGoogle: async (idToken) => {
      const requestId = beginAuthRequest();
      set({ status: 'loading', error: null });
      try {
        const profile = await readUserResponse(await fetch('/api/auth/google', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }));
        if (isCurrentRequest(requestId)) {
          set({ profile, status: 'authenticated', error: null });
        }
      } catch (error) {
        if (!isCurrentRequest(requestId)) return;
        const message = error instanceof Error ? error.message : 'Unable to sign in with Google.';
        set({ profile: null, status: 'unauthenticated', error: message });
        throw error;
      }
    },

    signOut: async () => {
      const requestId = beginAuthRequest();
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } finally {
        if (isCurrentRequest(requestId)) {
          set({ profile: null, status: 'unauthenticated', error: null });
        }
      }
    },
  };
});
