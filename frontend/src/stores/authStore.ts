import { create } from 'zustand';
import { getCurrentUser, signOut as signOutRequest } from '@/api/auth';
import { apiKeys } from '@/api/keys';
import { queryClient } from '@/api/queryClient';
import type { UserProfile } from '@/api/types';

export type { UserProfile } from '@/api/types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  profile: UserProfile | null;
  status: AuthStatus;
  error: string | null;
  hydrate: () => Promise<void>;
  signOut: () => Promise<void>;
  setAuthenticated: (profile: UserProfile) => void;
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
        const payload = await queryClient.fetchQuery({
          queryKey: apiKeys.auth.me,
          queryFn: getCurrentUser,
          staleTime: 0,
        });
        if (!isCurrentRequest(requestId)) return;
        set({ profile: payload.user, status: 'authenticated', error: null });
      } catch {
        if (isCurrentRequest(requestId)) {
          set({ profile: null, status: 'unauthenticated', error: 'The authentication service is unavailable.' });
        }
      }
    },

    signOut: async () => {
      const requestId = beginAuthRequest();
      try {
        await signOutRequest();
      } finally {
        if (isCurrentRequest(requestId)) {
          set({ profile: null, status: 'unauthenticated', error: null });
        }
      }
    },

    setAuthenticated: (profile) => set({ profile, status: 'authenticated', error: null }),
  };
});
