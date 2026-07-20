import { create } from 'zustand';
import { roomService } from '@/services/roomService';
import type { CreateRoomInput, JoinRoomResult, RoomSummary } from '@/types/app';

interface RoomsState {
  rooms: RoomSummary[];
  activeRoom: RoomSummary | null;
  joinStatus: JoinRoomResult['status'] | null;
  loading: boolean;
  error: string | null;
  loadRooms: (token: string) => Promise<void>;
  createRoom: (input: CreateRoomInput, token: string) => Promise<RoomSummary>;
  updateRoom: (roomId: string, input: Partial<CreateRoomInput>, token: string) => Promise<RoomSummary>;
  joinRoom: (roomId: string, token: string | null, password?: string) => Promise<JoinRoomResult>;
}

export const useRoomsStore = create<RoomsState>((set) => ({
  rooms: [],
  activeRoom: null,
  joinStatus: null,
  loading: false,
  error: null,

  loadRooms: async (token) => {
    set({ loading: true, error: null });
    try {
      const rooms = await roomService.listRooms(token);
      set({ rooms, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Unable to load rooms' });
    }
  },

  createRoom: async (input, token) => {
    const room = await roomService.createRoom(input, token);
    set((state) => ({ rooms: [room, ...state.rooms.filter((item) => item.id !== room.id)] }));
    return room;
  },

  updateRoom: async (roomId, input, token) => {
    const room = await roomService.updateRoom(roomId, input, token);
    set((state) => ({ rooms: state.rooms.map((item) => item.id === room.id ? room : item), activeRoom: room }));
    return room;
  },

  joinRoom: async (roomId, token, password) => {
    const result = await roomService.joinRoom(roomId, token, password);
    set({ activeRoom: result.room, joinStatus: result.status });
    return result;
  },
}));
