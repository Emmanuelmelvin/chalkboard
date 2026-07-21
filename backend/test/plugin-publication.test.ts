import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, sql } from '@/db/client';
import { pluginVersions, plugins, users } from '@/db/schema';
import { getPluginDetail, publishPlugin } from '@/services/plugins';

type Fixture = {
  userIds: string[];
  pluginIds: string[];
};

let fixture: Fixture;

beforeEach(() => {
  fixture = { userIds: [], pluginIds: [] };
});

afterEach(async () => {
  if (fixture.pluginIds.length > 0) {
    await db.delete(pluginVersions).where(inArray(pluginVersions.pluginId, fixture.pluginIds));
    await db.delete(plugins).where(inArray(plugins.id, fixture.pluginIds));
  }
  if (fixture.userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, fixture.userIds));
  }
});

after(async () => {
  await sql.end({ timeout: 5 });
});

async function createUser() {
  const id = randomUUID();
  fixture.userIds.push(id);
  const [user] = await db.insert(users).values({
    id,
    googleSub: `test-plugin-${id}`,
    email: `${id}@example.test`,
    displayName: 'Plugin test author',
  }).returning();
  return user;
}

function manifest(pluginId: string, version: string) {
  return {
    id: pluginId,
    name: 'Publication test plugin',
    version,
    permissions: [],
    contributes: {},
  };
}

test('publishing selects the newest approved version and leaves a newer draft unpublished', async () => {
  const author = await createUser();
  const pluginId = `test-publication-${randomUUID()}`;
  const pluginDbId = randomUUID();
  fixture.pluginIds.push(pluginDbId);
  const now = Date.now();

  await db.insert(plugins).values({
    id: pluginDbId,
    pluginId,
    name: 'Publication test plugin',
    description: 'Exercises publication version selection.',
    authorId: author.id,
    status: 'approved',
    plan: 'free',
    createdAt: new Date(now - 3_000),
    updatedAt: new Date(now - 3_000),
  });
  await db.insert(pluginVersions).values([
    {
      id: randomUUID(),
      pluginId: pluginDbId,
      version: '1.0.0',
      manifest: manifest(pluginId, '1.0.0'),
      status: 'approved',
      createdById: author.id,
      createdAt: new Date(now - 2_000),
      updatedAt: new Date(now - 2_000),
    },
    {
      id: randomUUID(),
      pluginId: pluginDbId,
      version: '2.0.0',
      manifest: manifest(pluginId, '2.0.0'),
      status: 'draft',
      createdById: author.id,
      createdAt: new Date(now - 1_000),
      updatedAt: new Date(now - 1_000),
    },
  ]);

  const published = await publishPlugin(pluginId);
  assert.equal(published?.currentVersion, '1.0.0');
  assert.equal(published?.status, 'published');

  const detail = await getPluginDetail(pluginId);
  assert.ok(detail);
  const selected = detail.versions.find((version) => version.version === detail.currentVersion);
  const draft = detail.versions.find((version) => version.version === '2.0.0');
  assert.equal(selected?.status, 'published');
  assert.equal(draft?.status, 'draft');

  const [storedPlugin] = await db.select().from(plugins).where(eq(plugins.id, pluginDbId));
  const storedVersions = await db.select().from(pluginVersions)
    .where(and(eq(pluginVersions.pluginId, pluginDbId), eq(pluginVersions.status, 'published')));
  assert.equal(storedPlugin.currentVersion, '1.0.0');
  assert.deepEqual(storedVersions.map((version) => version.version), ['1.0.0']);
});

