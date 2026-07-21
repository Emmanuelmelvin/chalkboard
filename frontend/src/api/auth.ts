import { apiRequest } from '@/api/client';
import type { AuthMeResponse, GoogleConfigResponse, GoogleSignInRequest, GoogleSignInResponse, LogoutResponse } from '@/api/types';

export function getCurrentUser() {
  return apiRequest<AuthMeResponse>({ url: '/auth/me', method: 'GET' });
}

export function getGoogleConfig() {
  return apiRequest<GoogleConfigResponse>({ url: '/auth/google/config', method: 'GET' });
}

export function signInWithGoogle(input: GoogleSignInRequest) {
  return apiRequest<GoogleSignInResponse>({ url: '/auth/google', method: 'POST', data: input });
}

export function signOut() {
  return apiRequest<LogoutResponse>({ url: '/auth/logout', method: 'POST', data: {} });
}
