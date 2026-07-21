import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiKeys } from '@/api/keys';
import { getCurrentUser, getGoogleConfig, signInWithGoogle, signOut } from '@/api/auth';
import { createRoom, deleteRoom, getRoom, joinRoom, listJoinRequests, listRooms, resetRoomPassword, resolveJoinRequest } from '@/api/rooms';
import { createPlugin, createPluginVersion, listMyPlugins, listPluginCatalogue, submitPlugin } from '@/api/plugins';
import { addAdmin, beginAdminTwoFactorSetup, getAdminSession, listAdminPlugins, listAdmins, logoutAdminTwoFactor, publishAdminPlugin, removeAdmin, removeAdminPluginFromRegistry, reviewAdminPlugin, verifyAdminTwoFactor } from '@/api/admin';
import type { AddAdminRequest, AdminPluginReviewRequest, CreatePluginRequest, CreatePluginVersionRequest, CreateRoomRequest, GoogleSignInRequest, JoinRoomRequest } from '@/api/types';

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
    onSuccess: (_payload, variables) => queryClient.invalidateQueries({ queryKey: apiKeys.admin.plugins() }),
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
