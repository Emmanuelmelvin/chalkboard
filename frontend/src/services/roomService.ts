import { isMockApi } from '@/config/apiMode';
import { httpClient } from '@/services/httpClient';
import { mockBackend } from '@/services/mock/mockBackend';
import type { CreateRoomInput, JoinRoomResult, RoomMember, RoomSummary } from '@/types/app';

export const roomService = {
  async listRooms(token: string): Promise<RoomSummary[]> {
    if (isMockApi) return mockBackend.listRooms();
    return httpClient.get<RoomSummary[]>('/api/rooms', token);
  },

  async createRoom(input: CreateRoomInput, token: string): Promise<RoomSummary> {
    if (isMockApi) return mockBackend.createRoom(input);
    return httpClient.post<RoomSummary, CreateRoomInput>('/api/rooms', input, token);
  },

  async updateRoom(roomId: string, input: Partial<CreateRoomInput>, token: string): Promise<RoomSummary> {
    if (isMockApi) return mockBackend.updateRoom(roomId, input);
    return httpClient.patch<RoomSummary, Partial<CreateRoomInput>>(`/api/rooms/${roomId}`, input, token);
  },

  async joinRoom(roomId: string, token: string | null, password?: string): Promise<JoinRoomResult> {
    if (isMockApi) return mockBackend.joinRoom(roomId, password);
    return httpClient.post<JoinRoomResult, { password?: string }>(`/api/rooms/${roomId}/join`, { password }, token);
  },

  async updateMember(roomId: string, memberId: string, input: Partial<RoomMember>, token: string): Promise<RoomMember> {
    if (isMockApi) return mockBackend.updateMember(roomId, memberId, input);
    return httpClient.patch<RoomMember, Partial<RoomMember>>(`/api/rooms/${roomId}/members/${memberId}`, input, token);
  },
};
