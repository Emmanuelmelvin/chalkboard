#!/usr/bin/env node
/**
 * Deploy Chalkboard to Aeroplane VPS.
 *
 * Reads AEROPLANE_URL and AEROPLANE_API_KEY from the environment and
 * backend/.env (and frontend/.env) for application secrets, then provisions/updates:
 *   - Project: "chalkboard"
 *   - Databases: Postgres + Redis (private internal services)
 *   - App Services:
 *       - web: static frontend built via Railpack and served directly by Caddy
 *       - api: backend HTTP server built via backend/Dockerfile
 *       - worker: background queue worker built via backend/Dockerfile
 *   - Domains: chalkboard.click on web, api.chalkboard.click on api
 *   - Deployments: triggers builds, polls status, streams logs on failure, verifies health
 *
 * SAFETY GUARANTEE: NEVER DELETES ANY RUNNING SERVICE IN AEROPLANE.
 *
 * Usage:
 *   node .github/deploy-aeroplane.mjs [--force]
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

// Helper to parse key-value env files
function parseEnvFile(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8');
    const out = {};
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

// Load env files in priority order: root .env < backend/.env < frontend/.env < process.env
const rootEnv = parseEnvFile(join(ROOT, '.env'));
const backendEnv = parseEnvFile(join(ROOT, 'backend', '.env'));
const frontendEnv = parseEnvFile(join(ROOT, 'frontend', '.env'));

for (const [k, v] of Object.entries(rootEnv)) {
  if (k === 'DATABASE_URL' || k === 'REDIS_URL') continue;
  if (process.env[k] === undefined && v !== '') process.env[k] = v;
}
for (const [k, v] of Object.entries(backendEnv)) {
  if (k === 'DATABASE_URL' || k === 'REDIS_URL') continue;
  if (process.env[k] === undefined && v !== '') process.env[k] = v;
}
for (const [k, v] of Object.entries(frontendEnv)) {
  if (process.env[k] === undefined && v !== '') process.env[k] = v;
}

const URL_BASE = process.env.AEROPLANE_URL?.replace(/\/+$/, '');
const API_KEY = process.env.AEROPLANE_API_KEY;

if (!URL_BASE || !API_KEY) {
  console.error('❌ Error: Set AEROPLANE_URL and AEROPLANE_API_KEY in process.env or .env');
  process.exit(1);
}

const APP_DOMAIN = process.env.APP_DOMAIN || 'chalkboard.click';
const API_DOMAIN = process.env.API_DOMAIN || `api.${APP_DOMAIN}`;
const REPO_URL = process.env.AEROPLANE_REPO_URL || 'https://github.com/Emmanuelmelvin/chalkboard.git';
const BRANCH = process.env.AEROPLANE_BRANCH || 'main';

const BACKEND_ENV_ALLOWLIST = [
  'GOOGLE_CLIENT_ID',
  'PG_POOL_SIZE',
  'AUTH_SESSION_SECRET',
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'SUPER_ADMIN_EMAIL',
  'R2_BUCKET_NAME',
  'R2_ACCOUNT_ID',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'PLUGIN_STORAGE_MODE',
  'SENTRY_DSN',
  'SENTRY_API_TOKEN',
  'SENTRY_API_BASE_URL',
  'SENTRY_ORG_ID',
  'SENTRY_PROJECT_ID',
  'BACHS_SANDBOX_API_KEY',
  'BACHS_SANDBOX_API_BASE_URL',
  'BACHS_LIVE_API_KEY',
  'BACHS_LIVE_API_BASE_URL',
  'BACHS_API_BASE_URL',
  'BACHS_API_KEY',
  'BACHS_WEBHOOK_SECRET',
  'BACHS_PRODUCT_PRO_MONTHLY',
  'BACHS_PRODUCT_PRO_ANNUAL',
  'BACHS_PRODUCT_TEAM_MONTHLY',
  'BACHS_PRODUCT_TEAM_ANNUAL',
  'BACHS_PRODUCT_TEAM_SEAT_MONTHLY',
  'BACHS_PRODUCT_TEAM_SEAT_ANNUAL',
  'SENDBYTE_API_KEY',
  'SENDBYTE_FROM_EMAIL',
  'SENDBYTE_FROM_NAME',
  'SENDBYTE_FROM_ADMIN_NAME',
  'TRUSTED_PROXY_HOP_COUNT',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${URL_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!res.ok) {
        const msg = data?.error || (typeof data === 'string' ? data : JSON.stringify(data)) || res.statusText;
        throw new Error(`${method} ${path} -> ${res.status}: ${String(msg).slice(0, 300)}`);
      }
      return data;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1500 * attempt);
    }
  }
}

async function findOrCreateProject() {
  const res = await api('GET', '/api/projects');
  const projects = Array.isArray(res) ? res : (res?.projects ?? []);

  const targetId = process.env.AEROPLANE_PROJECT_ID;
  const targetSlug = process.env.AEROPLANE_PROJECT_SLUG || 'chalkboard';

  const existing = projects.find((p) =>
    (targetId && p.id === targetId) ||
    p.slug === targetSlug ||
    p.name?.toLowerCase() === targetSlug.toLowerCase() ||
    p.slug?.toLowerCase() === targetSlug.toLowerCase()
  );

  if (existing) {
    console.log(`📦 Project: found ${existing.id} (${existing.slug || existing.name})`);
    return existing;
  }

  const created = await api('POST', '/api/projects', {
    name: 'Chalkboard',
    description: 'Chalkboard production deployment',
  });
  const project = created?.project ?? created;
  console.log(`📦 Project: created ${project.id} (${project.slug || project.name})`);
  return project;
}

async function existingServices(projectId) {
  try {
    const { projects } = await api('GET', '/api/projects');
    const project = projects?.find((p) => p.id === projectId);
    return project?.services ?? [];
  } catch {
    return [];
  }
}

async function setEnv(serviceId, serviceName, key, value) {
  try {
    await api('POST', `/api/services/${serviceId}/env`, { key, value });
    const masked = value.length > 40 ? `${value.slice(0, 25)}…` : value;
    console.log(`   └─ env: ${key}=${masked}`);
  } catch (e) {
    console.warn(`   └─ ⚠️ failed to set env ${key} on ${serviceName}: ${e.message}`);
  }
}

async function syncEnv(service, envList) {
  if (!envList || !Array.isArray(envList) || envList.length === 0) return;
  for (const { key, value } of envList) {
    if (value !== undefined && value !== null && value !== '') {
      await setEnv(service.id, service.name, key, String(value));
    }
  }
}

async function upsertService(projectId, payload, options = {}) {
  const currentList = await existingServices(projectId);
  const existing = currentList.find((s) => s.name === payload.name);

  if (existing) {
    // Check if configuration updates are required
    const patch = {};
    if (payload.rootDir !== undefined && existing.rootDir !== payload.rootDir) {
      patch.rootDir = payload.rootDir;
    }
    if (payload.buildMethod !== undefined && existing.buildMethod !== payload.buildMethod) {
      patch.buildMethod = payload.buildMethod;
    }
    if (payload.runtimeMode !== undefined && existing.runtimeMode !== payload.runtimeMode) {
      patch.runtimeMode = payload.runtimeMode;
    }
    if (payload.staticOutput !== undefined && existing.staticOutput !== payload.staticOutput) {
      patch.staticOutput = payload.staticOutput;
    }
    if (payload.installCommand !== undefined && existing.installCommand !== payload.installCommand) {
      patch.installCommand = payload.installCommand;
    }
    if (payload.buildCommand !== undefined && existing.buildCommand !== payload.buildCommand) {
      patch.buildCommand = payload.buildCommand;
    }
    if (payload.dockerfilePath !== undefined && existing.dockerfilePath !== payload.dockerfilePath) {
      patch.dockerfilePath = payload.dockerfilePath;
    }
    if (payload.internalPort !== undefined && existing.internalPort !== payload.internalPort) {
      patch.internalPort = payload.internalPort;
    }

    if (Object.keys(patch).length > 0) {
      console.log(`⚙️  Updating service ${existing.name} (${existing.id}):`, JSON.stringify(patch));
      try {
        await api('PATCH', `/api/services/${existing.id}`, patch);
        console.log(`   └─ Updated ${existing.name} successfully`);
      } catch (err) {
        console.warn(`   └─ ⚠️ Service update PATCH failed: ${err.message}`);
      }
    }

    // Sync environment variables (skip re-syncing generated database passwords)
    if (payload.env && !options.isDatabase) {
      await syncEnv(existing, payload.env);
    }

    console.log(`✓ Reusing service ${existing.name} (${existing.id}, ${existing.status})`);
    return existing;
  }

  // Create new service if it does not already exist
  const created = await api('POST', `/api/projects/${projectId}/services`, payload);
  const service = created?.service ?? created;
  console.log(`✨ Created service ${payload.name} -> ${service.id}`);

  if (payload.env) {
    await syncEnv(service, payload.env);
  }

  return service;
}

async function waitForService(service, label, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const overview = await api('GET', `/api/services/${service.id}/overview`);
      const s = overview?.service ?? overview;
      if (s?.status === 'active' || s?.status === 'running') {
        console.log(`✓ ${label}: active (hostPort: ${s.hostPort ?? 'n/a'})`);
        return s;
      }
    } catch {}
    await sleep(4000);
  }
  throw new Error(`${label} did not become active in time`);
}

async function deployAndWait(service, label, options = {}) {
  const { force, database } = options;
  const depRes = await api('GET', `/api/services/${service.id}/deployments`);
  const deployments = Array.isArray(depRes) ? depRes : (depRes?.deployments ?? []);

  const sorted = [...deployments].sort((a, b) => {
    const tA = new Date(a.createdAt || a.created_at || 0).getTime();
    const tB = new Date(b.createdAt || b.created_at || 0).getTime();
    return tB - tA;
  });

  const latest = sorted[0];
  const previousLatestId = latest?.id;

  const isBuilding = latest && ['queued', 'building', 'deploying', 'pending', 'preparing'].includes(latest.status);
  const isLive = latest && ['running', 'active', 'success', 'ready', 'completed', 'healthy'].includes(latest.status);

  let deploymentId = null;

  if (force) {
    if (isBuilding) {
      console.log(`⏳ ${label}: build already in progress on deployment ${latest.id} (${latest.status}), tracking it...`);
      deploymentId = latest.id;
    } else {
      const res = await api('POST', `/api/services/${service.id}/deployments`, {
        branch: BRANCH,
        force: true,
      });
      deploymentId = res?.deployment?.id ?? res?.id ?? res?.deploymentId ?? res?.data?.id;
      console.log(`🚀 ${label}: fresh deployment ${deploymentId ?? 'new'} queued (forced)`);
    }
  } else if (isBuilding) {
    console.log(`⏳ ${label}: tracking in-flight deployment ${latest.id} (${latest.status})`);
    deploymentId = latest.id;
  } else if (isLive) {
    console.log(`✓ ${label}: already deployed (${latest.status})`);
    return;
  } else {
    const res = await api('POST', `/api/services/${service.id}/deployments`, {
      branch: BRANCH,
    });
    deploymentId = res?.deployment?.id ?? res?.id ?? res?.deploymentId ?? res?.data?.id;
    console.log(`🚀 ${label}: deployment ${deploymentId ?? 'new'} queued`);
  }

  // Poll until deployment reaches terminal status
  const startTime = Date.now();
  let lastStatus = '';
  for (let i = 0; i < 150; i++) {
    await sleep(5000);
    const pollRes = await api('GET', `/api/services/${service.id}/deployments`);
    const list = Array.isArray(pollRes) ? pollRes : (pollRes?.deployments ?? []);

    const pollSorted = [...list].sort((a, b) => {
      const tA = new Date(a.createdAt || a.created_at || 0).getTime();
      const tB = new Date(b.createdAt || b.created_at || 0).getTime();
      return tB - tA;
    });

    const current = deploymentId
      ? pollSorted.find((d) => d.id === deploymentId)
      : pollSorted.find((d) => d.id !== previousLatestId) ?? pollSorted[0];

    if (current) {
      if (!deploymentId) deploymentId = current.id;
      const status = current.status;
      if (status !== lastStatus || i % 5 === 0) {
        lastStatus = status;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`   [${label}] deployment ${current.id} status: ${status} (${elapsed}s elapsed)`);
      }

      if (['running', 'active', 'success', 'ready', 'completed', 'healthy'].includes(status)) {
        console.log(`✅ ${label}: deployment ${current.id} finished successfully (${status})`);
        return;
      }

      if (['failed', 'error', 'aborted', 'cancelled', 'crashed'].includes(status)) {
        let logs = [];
        try {
          const logRes = await api('GET', `/api/deployments/${current.id}/logs`);
          logs = Array.isArray(logRes) ? logRes : (logRes?.logs ?? []);
        } catch {}
        console.error(`\n❌ ${label}: deployment ${current.id} FAILED (${status})`);
        console.error('--- Build Logs ---');
        for (const l of logs.slice(-35)) {
          console.error(`  [${l.stream || 'log'}] ${l.line || l.message || JSON.stringify(l)}`);
        }
        console.error('-------------------\n');
        throw new Error(`${label} deployment failed`);
      }
    }

    if (database) {
      try {
        const overviewRes = await api('GET', `/api/services/${service.id}/overview`);
        const dbService = overviewRes?.service ?? overviewRes;
        if (dbService?.status === 'active' || dbService?.status === 'running') {
          console.log(`✅ ${label}: database service is active`);
          return;
        }
      } catch {}
    }
  }

  throw new Error(`${label} deployment timed out after 12 minutes`);
}

async function ensureDomain(serviceId, hostname, label) {
  try {
    const overview = await api('GET', `/api/services/${serviceId}/overview`);
    const domains = overview?.domains || overview?.service?.domains || [];
    if (domains.some((d) => d.hostname === hostname)) {
      console.log(`✓ Domain ${hostname} already attached to ${label}`);
      return;
    }
    await api('POST', `/api/services/${serviceId}/domains`, { hostname });
    console.log(`🌐 Domain ${hostname} attached to ${label}`);
  } catch (e) {
    console.log(`ℹ️  Domain note (${hostname} on ${label}): ${e.message}`);
  }
}

async function main() {
  const force = process.argv.includes('--force');
  console.log(`\n🚀 Starting Chalkboard Aeroplane Deployment${force ? ' (forced rebuild)' : ''}`);
  console.log(`   Host: ${URL_BASE}`);
  console.log(`   Domain: ${APP_DOMAIN} (API: ${API_DOMAIN})`);
  console.log(`   Branch: ${BRANCH}\n`);

  const project = await findOrCreateProject();
  const projectId = project.id;

  // 1. Provision / Verify Databases
  console.log('\n📦 [1/4] Databases (PostgreSQL + Redis)');
  const dbPass = randomBytes(18).toString('base64url');
  const redisPass = randomBytes(18).toString('base64url');

  const postgres = await upsertService(projectId, {
    name: 'chalkboard-postgres',
    repoFullName: 'database:postgres',
    repoUrl: 'database',
    branch: 'main',
    internalPort: 5432,
    databasePublicEnabled: false,
    env: [
      { key: 'POSTGRES_DB', value: 'chalkboard' },
      { key: 'POSTGRES_USER', value: 'chalkboard' },
      { key: 'POSTGRES_PASSWORD', value: dbPass },
    ],
  }, { isDatabase: true });

  const redis = await upsertService(projectId, {
    name: 'chalkboard-redis',
    repoFullName: 'database:redis',
    repoUrl: 'database',
    branch: 'main',
    internalPort: 6379,
    databasePublicEnabled: false,
    env: [{ key: 'REDIS_PASSWORD', value: redisPass }],
  }, { isDatabase: true });

  await deployAndWait(postgres, 'postgres', { database: true });
  await deployAndWait(redis, 'redis', { database: true });
  await waitForService(postgres, 'postgres', 15);
  await waitForService(redis, 'redis', 15);

  // Retrieve internal connection strings
  const { suggestions = [] } = await api('GET', `/api/projects/${projectId}/database-variable-suggestions`);
  const pgVar = suggestions.find((s) => s.dbType === 'postgres');
  const rdVar = suggestions.find((s) => s.dbType === 'redis');

  if (!pgVar || !rdVar) {
    throw new Error(`Database connection strings missing from suggestions: ${JSON.stringify(suggestions)}`);
  }

  const databaseUrl = pgVar.value;
  const redisUrl = rdVar.value;
  console.log(`✓ Database connections linked successfully.`);

  // 2. Prepare Application Environments
  console.log('\n🔧 [2/4] Configuring Application Services');

  const backendEnvVars = [];
  for (const key of BACKEND_ENV_ALLOWLIST) {
    if (process.env[key]) {
      backendEnvVars.push({ key, value: process.env[key] });
    }
  }

  const commonApiEnv = [
    ...backendEnvVars,
    { key: 'DATABASE_URL', value: databaseUrl },
    { key: 'REDIS_URL', value: redisUrl },
    { key: 'NODE_ENV', value: 'production' },
    { key: 'CORS_ORIGIN', value: `https://${APP_DOMAIN}` },
    { key: 'APP_PUBLIC_URL', value: `https://${APP_DOMAIN}` },
  ];

  // Frontend environment:
  // - VITE_API_URL: set to 'api.chalkboard.click' for the server
  // - VITE_CLIENT_ID, VITE_USERJOT_PROJECT_ID, VITE_LIVEKIT_URL, VITE_SENTRY_*
  const webEnv = [
    { key: 'VITE_API_URL', value: API_DOMAIN },
    { key: 'APP_PUBLIC_URL', value: `https://${APP_DOMAIN}` },
    { key: 'VITE_CLIENT_ID', value: process.env.GOOGLE_CLIENT_ID || process.env.VITE_CLIENT_ID || '' },
    { key: 'VITE_LIVEKIT_URL', value: process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL || '' },
    { key: 'VITE_USERJOT_PROJECT_ID', value: process.env.VITE_USERJOT_PROJECT_ID || '' },
    { key: 'VITE_SENTRY_DSN', value: process.env.VITE_SENTRY_DSN || '' },
    { key: 'VITE_SENTRY_TRACES_SAMPLE_RATE', value: process.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1' },
    { key: 'VITE_SENTRY_RELEASE', value: process.env.VITE_SENTRY_RELEASE || '' },
  ].filter((item) => item.value !== '');

  // 3. Upsert Web, API, and Worker Services
  const web = await upsertService(projectId, {
    name: 'web',
    repoUrl: REPO_URL,
    branch: BRANCH,
    rootDir: 'frontend',
    buildMethod: 'railpack',
    runtimeMode: 'web',
    installCommand: 'NPM_CONFIG_PRODUCTION=false npm ci',
    buildCommand: 'npm run build',
    staticOutput: 'dist',
    internalPort: 80,
    env: webEnv,
  });

  const apiService = await upsertService(projectId, {
    name: 'api',
    repoUrl: REPO_URL,
    branch: BRANCH,
    rootDir: '',
    buildMethod: 'auto',
    dockerfilePath: 'backend/Dockerfile',
    runtimeMode: 'web',
    internalPort: 3001,
    env: commonApiEnv,
  });

  const worker = await upsertService(projectId, {
    name: 'worker',
    repoUrl: REPO_URL,
    branch: BRANCH,
    rootDir: '',
    buildMethod: 'auto',
    dockerfilePath: 'backend/Dockerfile',
    runtimeMode: 'worker',
    env: [...commonApiEnv, { key: 'PROCESS_TYPE', value: 'worker' }],
  });

  // Ensure domain attachments
  await ensureDomain(web.id, APP_DOMAIN, 'web');
  await ensureDomain(apiService.id, API_DOMAIN, 'api');

  // 4. Deploy Application Services
  console.log('\n🚢 [3/4] Deploying Services');
  await deployAndWait(apiService, 'api', { force });
  await deployAndWait(web, 'web', { force });
  await deployAndWait(worker, 'worker', { force });

  // 5. Verification
  console.log('\n🔍 [4/4] Verifying Live Deployment');

  // Verify backend health
  try {
    const healthRes = await fetch(`https://${API_DOMAIN}/api/health`);
    const healthJson = await healthRes.json();
    if (healthJson?.ok) {
      console.log(`✅ Backend Health Check: https://${API_DOMAIN}/api/health -> OK`);
    } else {
      console.warn(`⚠️ Backend Health Check returned unexpected response:`, healthJson);
    }
  } catch (e) {
    console.warn(`⚠️ Backend Health Check probe failed: ${e.message}`);
  }

  // Verify frontend static delivery
  try {
    const webRes = await fetch(`https://${APP_DOMAIN}`);
    if (webRes.ok) {
      console.log(`✅ Frontend Static Site: https://${APP_DOMAIN} -> HTTP ${webRes.status} (Served by Caddy)`);
    } else {
      console.warn(`⚠️ Frontend returned HTTP ${webRes.status}`);
    }
  } catch (e) {
    console.warn(`⚠️ Frontend probe failed: ${e.message}`);
  }

  console.log(`
🎉 Deployment Complete!
   • Frontend: https://${APP_DOMAIN} (Static site built via Railpack, served by Caddy)
   • Backend API: https://${API_DOMAIN} (Node.js/Hono Docker container)
   • Queue Worker: Active
   • Database: PostgreSQL + Redis private services
`);
}

main().catch((err) => {
  console.error(`\n💥 Deployment failed: ${err.message}`);
  process.exit(1);
});
