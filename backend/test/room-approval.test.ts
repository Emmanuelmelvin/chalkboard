import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '@/db/client';
import { joinRequests, roomMembers, rooms, users } from '@/db/schema';
import { approveJoinRequest, assertRoomJoinAllowed, denyJoinRequest } from '@/services/rooms';
import { createRoomSchema } from '@/validators/roomValidators';

type Fixture = {
  userIds: string[];
  roomIds: string[];
};

let fixture: Fixture;

beforeEach(() => {
  fixture = { userIds: [], roomIds: [] };
});

afterEach(async () => {
  if (fixture.roomIds.length > 0) {
    await db.delete(joinRequests).where(inArray(joinRequests.roomId, fixture.roomIds));
    await db.delete(roomMembers).where(inArray(roomMembers.roomId, fixture.roomIds));
    await db.delete(rooms).where(inArray(rooms.id, fixture.roomIds));
  }
  if (fixture.userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, fixture.userIds));
  }
});

after(async () => {
  await sql.end({ timeout: 5 });
});

async function createUser(label: string) {
  const id = randomUUID();
  fixture.userIds.push(id);
  const [user] = await db.insert(users).values({
    id,
    googleSub: `test-room-${label}-${id}`,
    email: `${id}@example.test`,
    displayName: `Room test ${label}`,
  }).returning();
  return user;
}

async function createApprovalRoom(ownerId: string) {
  const id = randomUUID();
  const slug = `test-approval-${randomUUID()}`;
  const now = new Date();
  fixture.roomIds.push(id);
  await db.insert(rooms).values({
    id,
    slug,
    title: 'Approval room test fixture',
    description: null,
    ownerId,
    accessMode: 'approval_required',
    theme: 'classroom',
    defaultRole: 'viewer',
    passwordHash: null,
    passwordCiphertext: null,
    maxAttendees: null,
    voiceEnabled: false,
    status: 'open',
    lastActivityAt: now,
    peakAttendeeCount: 0,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(roomMembers).values({ roomId: id, userId: ownerId, role: 'owner' });
  return { id, slug };
}

test('room validation accepts approval_required and rejects unknown access modes', () => {
  const parsed = createRoomSchema.parse({
    title: 'Approval room',
    slug: 'approval-room',
    accessMode: 'approval_required',
  });
  assert.equal(parsed.accessMode, 'approval_required');
  assert.throws(() => createRoomSchema.parse({
    title: 'Invalid room',
    slug: 'invalid-room',
    accessMode: 'admin_approval',
  }));
});

test('approval-required joins create one pending request and only succeed after approval', async () => {
  const owner = await createUser('owner');
  const requester = await createUser('requester');
  const room = await createApprovalRoom(owner.id);

  const firstAttempt = await assertRoomJoinAllowed({ roomSlug: room.slug, userId: requester.id });
  assert.equal(firstAttempt.ok, false);
  assert.equal(firstAttempt.error, 'approval_required');
  assert.equal(firstAttempt.roomId, room.id);
  assert.equal(firstAttempt.requestStatus, 'pending');
  assert.equal(firstAttempt.requestCreated, true);
  assert.match(firstAttempt.requestId || '', /^[0-9a-f-]{36}$/i);

  const retryAttempt = await assertRoomJoinAllowed({ roomSlug: room.slug, userId: requester.id });
  assert.deepEqual(retryAttempt, {
    ok: false,
    error: 'approval_required',
    roomId: room.id,
    requestStatus: 'pending',
  });

  const pending = await db.select().from(joinRequests).where(eq(joinRequests.roomId, room.id));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'pending');

  const approval = await approveJoinRequest({
    roomSlug: room.slug,
    targetUserId: requester.id,
    decidedById: owner.id,
  });
  assert.equal(approval.ok, true);

  const accepted = await assertRoomJoinAllowed({ roomSlug: room.slug, userId: requester.id });
  assert.deepEqual(accepted, { ok: true, roomId: room.id, role: 'viewer' });
  const [membership] = await db.select().from(roomMembers)
    .where(eq(roomMembers.roomId, room.id));
  assert.ok(membership);
});

test('a denied approval request cannot be used to join later', async () => {
  const owner = await createUser('deny-owner');
  const requester = await createUser('deny-requester');
  const room = await createApprovalRoom(owner.id);

  const requested = await assertRoomJoinAllowed({ roomSlug: room.slug, userId: requester.id });
  assert.equal(requested.ok, false);
  assert.equal(requested.error, 'approval_required');

  const denial = await denyJoinRequest({
    roomSlug: room.slug,
    targetUserId: requester.id,
    decidedById: owner.id,
  });
  assert.equal(denial.ok, true);

  const afterDenial = await assertRoomJoinAllowed({ roomSlug: room.slug, userId: requester.id });
  assert.deepEqual(afterDenial, {
    ok: false,
    error: 'join_denied',
    roomId: room.id,
    requestStatus: 'denied',
  });
});
