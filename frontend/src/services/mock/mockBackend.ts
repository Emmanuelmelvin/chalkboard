import type { CreateRoomInput, JoinRoomResult, RoomMember, RoomSummary, Session } from '@/types/app';
import { readStoredSession, storeSession } from '@/services/sessionStorage';

const MOCK_ROOMS_KEY = 'chalkboard.mockRooms';

function readMockRooms(): RoomSummary[] {
  const raw = localStorage.getItem(MOCK_ROOMS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as RoomSummary[]; } catch { return []; }
}

function writeMockRooms(rooms: RoomSummary[]) {
  localStorage.setItem(MOCK_ROOMS_KEY, JSON.stringify(rooms));
}

function mockInviteUrl(roomId: string) {
  return `${window.location.origin}/join/${roomId}`;
}

export const mockBackend = {
  beginGoogleSignIn() {
    const session: Session = {
      token: `mock-${crypto.randomUUID()}`,
      user: {
        id: 'mock-user',
        name: 'Chalkboard Teacher',
        email: 'teacher@example.com',
        onboardingComplete: false,
      },
    };
    storeSession(session);
  },

  getMe(): Session {
    const session = readStoredSession();
    if (!session) throw new Error('No saved session');
    return session;
  },

  completeOnboarding(): Session {
    const session = this.getMe();
    const next = { ...session, user: { ...session.user, onboardingComplete: true } };
    storeSession(next);
    return next;
  },

  listRooms(): RoomSummary[] {
    return readMockRooms();
  },

  createRoom(input: CreateRoomInput): RoomSummary {
    const id = crypto.randomUUID().slice(0, 8);
    const room: RoomSummary = {
      id,
      title: input.title,
      accessMode: input.accessMode,
      maxAttendees: input.maxAttendees,
      voiceEnabled: input.voiceEnabled,
      role: 'owner',
      attendeeCount: 0,
      updatedAt: new Date().toISOString(),
      inviteUrl: mockInviteUrl(id),
      members: [{ id: 'mock-user', name: 'Chalkboard Teacher', email: 'teacher@example.com', role: 'owner', status: 'active' }],
      invites: [{ id: 'primary', url: mockInviteUrl(id), revoked: false }],
    };
    writeMockRooms([room, ...readMockRooms()]);
    return room;
  },

  updateRoom(roomId: string, input: Partial<CreateRoomInput>): RoomSummary {
    const rooms = readMockRooms();
    const room = rooms.find((item) => item.id === roomId);
    if (!room) throw new Error('Room not found');
    Object.assign(room, input, { updatedAt: new Date().toISOString() });
    writeMockRooms(rooms);
    return room;
  },

  joinRoom(roomId: string, password?: string): JoinRoomResult {
    const room = readMockRooms().find((item) => item.id === roomId) ?? {
      id: roomId,
      title: `Room ${roomId}`,
      accessMode: 'open' as const,
      maxAttendees: 25,
      voiceEnabled: false,
      role: 'viewer' as const,
      attendeeCount: 1,
      updatedAt: new Date().toISOString(),
      inviteUrl: mockInviteUrl(roomId),
    };
    if (room.accessMode === 'approval-required') return { room, status: 'waiting-approval' };
    if (room.accessMode === 'password' && !password) return { room, status: 'password-required' };
    return { room, status: 'joined' };
  },

  updateMember(_roomId: string, _memberId: string, input: Partial<RoomMember>): RoomMember {
    return { id: _memberId, name: 'Mock Member', email: 'member@example.com', role: input.role ?? 'viewer', status: input.status ?? 'active' };
  },
};
