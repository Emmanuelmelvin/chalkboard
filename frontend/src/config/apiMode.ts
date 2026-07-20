export type ApiMode = 'mock' | 'live';

export const API_MODE: ApiMode = import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const isMockApi = API_MODE === 'mock';
