/**
 * Authoritative plan limits — single source of truth.
 *
 * Both `backend/src/services/billing/entitlements.service.ts` and
 * `frontend/src/constants/plans.ts` import from this file. Never duplicate
 * the literal table: edit only here, and the two consumers (enforcement on
 * the server, presentation on the client) stay in sync by construction.
 * `backend/test/entitlements.test.ts` also asserts parity as a second line
 * of defence.
 */

export type PlanId = 'free' | 'pro' | 'team';

/** Sentinel for a limit that is not capped on a given plan. */
export const UNLIMITED = -1;

export interface PlanLimits {
  /** Concurrent open rooms an owner may hold. */
  activeRooms: number;
  /** Maximum simultaneous participants in one room. */
  attendeesPerRoom: number;
  /** Days a board is kept after its last activity. */
  retentionDays: number;
  /** LiveKit voice minutes included each billing period. */
  voiceMinutesPerMonth: number;
  /** Seats included in the subscription. */
  seats: number;
  /** Access to plugins published on the `pro` plugin plan. */
  proPlugins: boolean;
  /** Permission to publish plugins to the catalogue. */
  publishPlugins: boolean;
  /** Board export to PNG, SVG, and PDF. */
  boardExport: boolean;
  /** Room logo and colour customisation. */
  customBranding: boolean;
  /** Shared workspace, org billing, and member administration. */
  workspaceAdmin: boolean;
  /** Prioritised support queue. */
  prioritySupport: boolean;
}

export const planLimits: Record<PlanId, PlanLimits> = {
  free: {
    activeRooms: 5,
    attendeesPerRoom: 25,
    retentionDays: 7,
    voiceMinutesPerMonth: 200,
    seats: 1,
    proPlugins: false,
    publishPlugins: false,
    boardExport: false,
    customBranding: false,
    workspaceAdmin: false,
    prioritySupport: false,
  },
  pro: {
    activeRooms: UNLIMITED,
    attendeesPerRoom: 100,
    retentionDays: UNLIMITED,
    voiceMinutesPerMonth: 1500,
    seats: 1,
    proPlugins: true,
    publishPlugins: true,
    boardExport: true,
    customBranding: true,
    workspaceAdmin: false,
    prioritySupport: false,
  },
  team: {
    activeRooms: UNLIMITED,
    attendeesPerRoom: 300,
    retentionDays: UNLIMITED,
    voiceMinutesPerMonth: 10000,
    seats: 10,
    proPlugins: true,
    publishPlugins: true,
    boardExport: true,
    customBranding: true,
    workspaceAdmin: true,
    prioritySupport: true,
  },
};

export const defaultPlanId: PlanId = 'free';
