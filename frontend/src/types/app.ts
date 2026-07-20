export type RoomRole = 'owner' | 'instructor' | 'viewer';
export type AccessMode = 'open' | 'approval-required' | 'password';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  onboardingComplete: boolean;
}

export interface Session {
  token: string;
  user: AuthUser;
}

export interface RoomMember {
  id: string;
  name: string;
  email: string;
  role: RoomRole;
  status: 'active' | 'pending' | 'banned';
}

export interface RoomInvite {
  id: string;
  url: string;
  revoked: boolean;
}

export interface RoomSummary {
  id: string;
  title: string;
  accessMode: AccessMode;
  maxAttendees: number;
  voiceEnabled: boolean;
  role: RoomRole;
  attendeeCount: number;
  updatedAt: string;
  inviteUrl?: string;
  members?: RoomMember[];
  invites?: RoomInvite[];
}

export interface CreateRoomInput {
  title: string;
  accessMode: AccessMode;
  maxAttendees: number;
  voiceEnabled: boolean;
  password?: string;
}

export interface JoinRoomResult {
  room: RoomSummary;
  status: 'joined' | 'waiting-approval' | 'password-required';
}
