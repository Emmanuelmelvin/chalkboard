import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiKeys } from '@/api/keys';
import { getCurrentUser, getGoogleConfig, signInWithGoogle, signOut } from '@/api/auth';
import { createRoom, deleteRoom, getRoom, joinRoom, listJoinRequests, listRooms, resetRoomPassword, resolveJoinRequest } from '@/api/rooms';
import { createPlugin, createPluginVersion, getMyPluginAnalytics, getPluginCataloguePlugin, listMyPlugins, listPluginCatalogue, submitPlugin } from '@/api/plugins';
import { addAdmin, beginAdminTwoFactorSetup, getAdminSession, listAdminPlugins, listAdmins, logoutAdminTwoFactor, publishAdminPlugin, removeAdmin, removeAdminPluginFromRegistry, reviewAdminPlugin, verifyAdminTwoFactor } from '@/api/admin';
import { cancelSubscription, createPortalSession, getCheckoutStatus, startCheckout } from '@/api/billing';
import type { AddAdminRequest, AdminPluginReviewRequest, CreatePluginRequest, CreatePluginVersionRequest, CreateRoomRequest, GoogleSignInRequest, JoinRoomRequest, StartCheckoutRequest } from '@/api/types';

export function useCurrentUserQuery(enabled = true) {
  return useQuery({ queryKey: apiKeys.auth.me, queryFn: getCurrentUser, enabled });
}

export function useGoogleConfigQuery(enabled = true) {
  return useQuery({ queryKey: apiKeys.auth.googleConfig, queryFn: getGoogleConfig, enabled });
}

export function useGoogleSignInMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GoogleSignInRequest) => signInWithGoogle(input),
    onSuccess: (payload) => {
      queryClient.setQueryData(apiKeys.auth.me, payload);
    },
  });
}

export function useSignOutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: apiKeys.auth.me });
    },
  });
}

export function useRoomsQuery(enabled = true) {
  return useQuery({ queryKey: apiKeys.rooms.all, queryFn: listRooms, enabled });
}

export function useRoomQuery(slug: string, enabled = Boolean(slug)) {
  return useQuery({ queryKey: apiKeys.rooms.detail(slug), queryFn: () => getRoom(slug), enabled });
}

export function useCreateRoomMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomRequest) => createRoom(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.rooms.all }),
  });
}

export function useJoinRoomMutation() {
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input?: JoinRoomRequest }) => joinRoom(slug, input),
  });
}

export function useJoinApprovalQuery(slug: string | null, enabled = Boolean(slug)) {
  return useQuery({
    queryKey: ['rooms', 'join-status', slug] as const,
    queryFn: () => joinRoom(slug as string),
    enabled,
    refetchInterval: enabled ? 2000 : false,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}

export function useResetRoomPasswordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => resetRoomPassword(slug),
    onSuccess: (_payload, slug) => {
      queryClient.invalidateQueries({ queryKey: apiKeys.rooms.all });
      queryClient.invalidateQueries({ queryKey: apiKeys.rooms.detail(slug) });
    },
  });
}

export function useDeleteRoomMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteRoom(slug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.rooms.all }),
  });
}

export function useJoinRequestsQuery(slug: string, enabled = false) {
  return useQuery({ queryKey: apiKeys.rooms.joinRequests(slug), queryFn: () => listJoinRequests(slug), enabled });
}

export function useResolveJoinRequestMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, userId, decision }: { slug: string; userId: string; decision: 'approve' | 'deny' }) => resolveJoinRequest(slug, userId, decision),
    onSuccess: (_payload, variables) => {
      queryClient.invalidateQueries({ queryKey: apiKeys.rooms.joinRequests(variables.slug) });
      queryClient.invalidateQueries({ queryKey: apiKeys.rooms.all });
      queryClient.invalidateQueries({ queryKey: apiKeys.rooms.detail(variables.slug) });
    },
  });
}

export function useMyPluginsQuery(enabled = true) {
  return useQuery({ queryKey: apiKeys.plugins.mine, queryFn: listMyPlugins, enabled });
}

export function usePluginCatalogueQuery(enabled = true) {
  return useQuery({ queryKey: apiKeys.plugins.catalogue, queryFn: listPluginCatalogue, enabled });
}

export function usePluginCataloguePluginQuery(pluginId: string | null, enabled = Boolean(pluginId)) {
  return useQuery({
    queryKey: apiKeys.plugins.catalogueDetail(pluginId ?? ''),
    queryFn: () => getPluginCataloguePlugin(pluginId as string),
    enabled: enabled && Boolean(pluginId),
  });
}

export function useMyPluginAnalyticsQuery(pluginId: string | null, enabled = Boolean(pluginId)) {
  return useQuery({
    queryKey: apiKeys.plugins.analytics(pluginId ?? ''),
    queryFn: () => getMyPluginAnalytics(pluginId as string),
    enabled,
  });
}

export function useCreatePluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePluginRequest) => createPlugin(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.plugins.mine }),
  });
}

export function useCreatePluginVersionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pluginId, input }: { pluginId: string; input: CreatePluginVersionRequest }) => createPluginVersion(pluginId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.plugins.mine }),
  });
}

export function useSubmitPluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) => submitPlugin(pluginId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.plugins.mine }),
  });
}

/**
 * Start a checkout. Nothing is invalidated on success: payment has not happened
 * yet, and the plan only changes once the webhook lands.
 */
export function useStartCheckoutMutation() {
  return useMutation({ mutationFn: (input: StartCheckoutRequest) => startCheckout(input) });
}

/**
 * Poll a checkout until the webhook has provisioned it.
 *
 * The redirect and the webhook race, and either can arrive first, so the return
 * page waits on `provisioned` rather than trusting the redirect. Polling stops
 * as soon as the plan is live or the checkout can no longer complete, and the
 * billing summary is invalidated so the rest of the app sees the new plan.
 */
export function useCheckoutStatusQuery(checkoutId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: apiKeys.billing.checkout(checkoutId ?? ''),
    queryFn: async () => {
      const status = await getCheckoutStatus(checkoutId as string);
      if (status.provisioned) {
        queryClient.invalidateQueries({ queryKey: apiKeys.billing.summary });
        queryClient.invalidateQueries({ queryKey: apiKeys.auth.me });
      }
      return status;
    },
    enabled: Boolean(checkoutId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      // Nothing further will change once the plan is live or the session died.
      if (data.provisioned || data.status === 'expired' || data.status === 'cancelled') return false;
      return 2000;
    },
    // A 404 here means the checkout is not ours, which a retry cannot fix.
    retry: 1,
  });
}

export function useCreatePortalSessionMutation() {
  return useMutation({ mutationFn: createPortalSession });
}

export function useCancelSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (atPeriodEnd: boolean) => cancelSubscription(atPeriodEnd),
    // The cancellation flag is reflected immediately; the authoritative state
    // still arrives by webhook.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.billing.summary }),
  });
}

export function useAdminSessionQuery(enabled = true) {
  return useQuery({ queryKey: apiKeys.admin.session, queryFn: getAdminSession, enabled, retry: false });
}

export function useAdminSetupMutation() {
  return useMutation({ mutationFn: beginAdminTwoFactorSetup });
}

export function useAdminVerifyMutation() {
  return useMutation({ mutationFn: verifyAdminTwoFactor });
}

export function useAdminPluginsQuery(status?: string, enabled = true) {
  return useQuery({ queryKey: apiKeys.admin.plugins(status), queryFn: () => listAdminPlugins(status), enabled });
}

export function useReviewAdminPluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pluginId, input }: { pluginId: string; input: AdminPluginReviewRequest }) => reviewAdminPlugin(pluginId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'plugins'] }),
  });
}

export function usePublishAdminPluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) => publishAdminPlugin(pluginId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'plugins'] }),
  });
}

export function useRemoveAdminPluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pluginId: string) => removeAdminPluginFromRegistry(pluginId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'plugins'] }),
  });
}

export function useAdminLogoutMutation() {
  return useMutation({ mutationFn: logoutAdminTwoFactor });
}

export function useAdminsQuery(enabled = false) {
  return useQuery({ queryKey: apiKeys.admin.admins, queryFn: listAdmins, enabled });
}

export function useAddAdminMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddAdminRequest) => addAdmin(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.admin.admins }),
  });
}

export function useRemoveAdminMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeAdmin(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeys.admin.admins }),
  });
}
