export const apiKeys = {
  auth: {
    me: ['auth', 'me'] as const,
    googleConfig: ['auth', 'google-config'] as const,
  },
  rooms: {
    all: ['rooms'] as const,
    detail: (slug: string) => ['rooms', 'detail', slug] as const,
    joinRequests: (slug: string) => ['rooms', 'join-requests', slug] as const,
  },
  plugins: {
    mine: ['plugins', 'mine'] as const,
    catalogue: ['plugins', 'catalogue'] as const,
    catalogueDetail: (pluginId: string) => ['plugins', 'catalogue', pluginId] as const,
  },
  admin: {
    session: ['admin', 'session'] as const,
    plugins: (status?: string) => ['admin', 'plugins', status || 'all'] as const,
    admins: ['admin', 'admins'] as const,
  },
} as const;
