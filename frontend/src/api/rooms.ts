import { apiRequest } from '@/api/client';
import type { CreateRoomRequest, CreateRoomResponse, DeleteResponse, JoinRoomRequest, JoinRoomResponse, ListJoinRequestsResponse, ListRoomsResponse, ResetRoomPasswordResponse, ResolveJoinRequestResponse, RoomDetailsResponse } from '@/api/types';

export function listRooms() {
  return apiRequest<ListRoomsResponse>({ url: '/rooms', method: 'GET' });
}

export function getRoom(slug: string) {
  return apiRequest<RoomDetailsResponse>({ url: `/rooms/${encodeURIComponent(slug)}`, method: 'GET' });
}

export function createRoom(input: CreateRoomRequest) {
  return apiRequest<CreateRoomResponse>({ url: '/rooms', method: 'POST', data: input });
}

export function joinRoom(slug: string, input: JoinRoomRequest = {}) {
  return apiRequest<JoinRoomResponse>({
    url: `/rooms/${encodeURIComponent(slug)}/join`,
    method: 'POST',
    data: input,
    validateStatus: (status) => (status >= 200 && status < 300) || status === 403,
  });
}

export function resetRoomPassword(slug: string) {
  return apiRequest<ResetRoomPasswordResponse>({ url: `/rooms/${encodeURIComponent(slug)}/password`, method: 'POST', data: {} });
}

export function deleteRoom(slug: string) {
  return apiRequest<DeleteResponse>({ url: `/rooms/${encodeURIComponent(slug)}`, method: 'DELETE' });
}

export function listJoinRequests(slug: string) {
  return apiRequest<ListJoinRequestsResponse>({ url: `/rooms/${encodeURIComponent(slug)}/join-requests`, method: 'GET' });
}

export function resolveJoinRequest(slug: string, userId: string, decision: 'approve' | 'deny') {
  return apiRequest<ResolveJoinRequestResponse>({ url: `/rooms/${encodeURIComponent(slug)}/join-requests/${encodeURIComponent(userId)}/${decision}`, method: 'POST', data: {} });
}
