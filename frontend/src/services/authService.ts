import { API_BASE_URL, isMockApi } from '@/config/apiMode';
import { mockBackend } from '@/services/mock/mockBackend';
import { httpClient } from '@/services/httpClient';
import { readStoredSession, storeSession } from '@/services/sessionStorage';
import type { Session } from '@/types/app';

export const authService = {
  async beginGoogleSignIn() {
    if (isMockApi) {
      mockBackend.beginGoogleSignIn();
      return;
    }
    window.location.href = `${API_BASE_URL}/auth/google`;
  },

  async getMe(token: string): Promise<Session> {
    if (isMockApi) return mockBackend.getMe();
    return httpClient.get<Session>('/api/auth/me', token);
  },

  async completeOnboarding(token: string): Promise<Session> {
    if (isMockApi) return mockBackend.completeOnboarding();
    return httpClient.post<Session>('/api/onboarding/complete', undefined, token);
  },

  readStoredSession,
  storeSession,
};
