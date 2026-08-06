import { apiRequest } from '@/api/client';
import type {
  AcceptInviteResponse,
  CreateWorkspaceInviteResponse,
  InviteLookupResponse,
  OkResponse,
  WorkspaceResponse,
} from '@/api/types';

/**
 * The Team-plan shared workspace: seat usage, members, and email invites.
 * The server re-checks plan, ownership, and the seat cap on every call; these
 * functions only shape the requests.
 */

export function getWorkspace() {
  return apiRequest<WorkspaceResponse>({ url: '/workspace', method: 'GET' });
}

export function createWorkspaceInvite(email: string) {
  return apiRequest<CreateWorkspaceInviteResponse>({ url: '/workspace/invites', method: 'POST', data: { email } });
}

export function getWorkspaceInvite(token: string) {
  return apiRequest<InviteLookupResponse>({
    url: `/workspace/invites/${encodeURIComponent(token)}`,
    method: 'GET',
  });
}

export function acceptWorkspaceInvite(token: string) {
  return apiRequest<AcceptInviteResponse>({
    url: `/workspace/invites/${encodeURIComponent(token)}/accept`,
    method: 'POST',
    data: {},
  });
}

export function revokeWorkspaceInvite(token: string) {
  return apiRequest<OkResponse>({
    url: `/workspace/invites/${encodeURIComponent(token)}/revoke`,
    method: 'POST',
    data: {},
  });
}

export function removeWorkspaceMember(userId: string) {
  return apiRequest<OkResponse>({
    url: `/workspace/members/${encodeURIComponent(userId)}`,
    method: 'DELETE',
  });
}
