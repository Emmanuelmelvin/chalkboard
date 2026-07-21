import type { RoomTheme } from '@/constants/roomThemes';

export interface ApiErrorResponse {
  error?: string;
  message?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  platformRole: 'user' | 'admin' | 'super_admin';
}

export interface AuthMeResponse {
  user: UserProfile;
}

export interface GoogleConfigResponse {
  clientId: string;
}

export interface GoogleSignInRequest {
  idToken: string;
}

export interface GoogleSignInResponse {
  user: UserProfile;
}

export interface LogoutResponse {
  ok: true;
}

export type RoomAccessMode = 'open' | 'approval_required' | 'password_protected';
export type RoomRole = 'owner' | 'instructor' | 'viewer';

export interface RoomMember {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  role: RoomRole;
  createdAt?: string;
  online?: boolean;
}

export interface RoomRecord {
  id?: string;
  ownerId?: string;
  slug: string;
  title: string;
  description: string | null;
  status: 'open' | 'closed';
  accessMode: RoomAccessMode;
  theme: RoomTheme;
  voiceEnabled: boolean;
  lastActivityAt: string;
  createdAt: string;
  updatedAt?: string;
  role?: RoomRole | null;
  password?: string | null;
  peakAttendeeCount?: number;
}

export interface RoomSummary extends RoomRecord {
  role: RoomRole | null;
  password: string | null;
  members: RoomMember[];
  peakAttendeeCount: number;
}

export interface RoomDetailsResponse {
  room: RoomRecord;
  members: RoomMember[];
}

export interface ListRoomsResponse {
  rooms: RoomSummary[];
}

export interface CreateRoomRequest {
  title: string;
  slug: string;
  description?: string;
  accessMode: RoomAccessMode;
  defaultRole: Exclude<RoomRole, 'owner'>;
  theme: RoomTheme;
  voiceEnabled: boolean;
}

export interface CreateRoomResponse {
  room: RoomRecord;
  password?: string;
}

export interface JoinRoomRequest {
  password?: string;
}

export interface JoinRoomSuccessResponse {
  ok: true;
  roomId: string;
  role: RoomRole;
}

export interface JoinRoomPendingResponse {
  ok: false;
  error: 'approval_required';
  roomId?: string;
  requestStatus: 'pending';
  requestCreated?: boolean;
  requestId?: string;
}

export interface JoinRoomDeniedResponse {
  ok: false;
  error: 'join_denied';
  roomId?: string;
  requestStatus: 'denied';
}

export interface JoinRoomErrorResponse {
  ok?: false;
  error: string;
  roomId?: string;
  requestStatus?: JoinRoomPendingResponse['requestStatus'] | JoinRoomDeniedResponse['requestStatus'];
}

export type JoinRoomResponse = JoinRoomSuccessResponse | JoinRoomPendingResponse | JoinRoomDeniedResponse | JoinRoomErrorResponse;

export interface ResetRoomPasswordResponse {
  password: string;
}

export interface DeleteResponse {
  ok: true;
}

export interface JoinRequest {
  id: string;
  userId: string;
  status: 'pending';
  createdAt: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}

export interface ListJoinRequestsResponse {
  requests: JoinRequest[];
}

export interface ResolveJoinRequestResponse {
  ok: true;
  request: JoinRequest;
  member?: RoomMember;
}

export type ManagedPluginStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'rejected' | 'suspended';
export type ManagedPluginPlan = 'free' | 'pro';
export type ManagedPluginVersionStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'rejected';

export interface ManagedPluginVersion {
  id: string;
  version: string;
  manifest: Record<string, unknown>;
  changelog: string | null;
  entryUrl: string | null;
  entryCode: string | null;
  bundleArchiveDataUrl: string | null;
  bundleUrl?: string | null;
  bundleArchiveUrl?: string | null;
  hasBundleArchive?: boolean;
  status: ManagedPluginVersionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedPlugin {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  logoDataUrl: string | null;
  logoUrl?: string | null;
  authorId: string;
  status: ManagedPluginStatus;
  plan: ManagedPluginPlan;
  currentVersion: string | null;
  createdAt: string;
  updatedAt: string;
  versions: ManagedPluginVersion[];
  author?: { id: string; displayName: string; email: string } | null;
}

export interface PluginListResponse {
  plugins: ManagedPlugin[];
}

export interface CreatePluginRequest {
  pluginId: string;
  name: string;
  description: string;
  logoDataUrl?: string;
  plan: ManagedPluginPlan;
  version: string;
  manifest: Record<string, unknown>;
  changelog?: string;
  entryUrl?: string;
  entryCode?: string;
  bundleArchiveDataUrl?: string;
}

export interface CreatePluginVersionRequest {
  version: string;
  manifest: Record<string, unknown>;
  changelog?: string;
  entryUrl?: string;
  entryCode?: string;
  bundleArchiveDataUrl?: string;
}

export interface PluginMutationResponse {
  plugin: ManagedPlugin;
}

export interface AdminSession {
  user: { id: string; email: string; displayName: string; avatarUrl: string | null; platformRole: 'admin' | 'super_admin' };
  twoFactorEnabled: boolean;
  twoFactorVerified: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  platformRole: 'admin' | 'super_admin';
  createdAt: string;
}

export interface AdminPlugin extends ManagedPlugin {
  author: { id: string; displayName: string; email: string } | null;
}

export interface AdminSetupResponse {
  secret: string;
  otpauthUri: string;
}

export interface VerifyAdminTwoFactorRequest {
  code: string;
}

export interface VerifyAdminTwoFactorResponse {
  ok: true;
  recoveryCodes: string[];
}

export interface AdminPluginListResponse {
  plugins: AdminPlugin[];
}

export interface AdminPluginReviewRequest {
  decision: 'approved' | 'rejected' | 'suspended';
  notes: string;
}

export interface AdminPluginResponse {
  plugin: AdminPlugin;
}

export interface AdminListResponse {
  admins: AdminUser[];
}

export interface AddAdminRequest {
  email: string;
  role: 'admin' | 'super_admin';
}

export interface AddAdminResponse {
  admin: AdminUser;
}

export interface OkResponse {
  ok: true;
}
