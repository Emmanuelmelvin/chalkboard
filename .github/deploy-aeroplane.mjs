#!/usr/bin/env node
/**
 * Deploy Chalkboard to Aeroplane.
 *
 * Reads AEROPLANE_URL and AEROPLANE_API_KEY from the environment and
 * backend/.env (and frontend/.env) for application secrets, then provisions:
 *   - a "chalkboard" project
 *   - Postgres + Redis database services (private)
 *   - web (frontend static site), api (backend), worker services
 *   - the chalkboard.click domain on the web service
 *   - deployments for every service, waiting for each to finish
 *
 * Usage: AEROPLANE_URL=https://pilot.orafi.app AEROPLANE_API_KEY=ap_... node .github/deploy-aeroplane.mjs [--force]
 *
 * Without --force, services whose latest deployment already succeeded are
 * skipped. Pass --force to rebuild everything — this is what the GitHub
 * Actions deploy workflow (push to main) uses.
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Since this script is located in .github/, the project root is one level up
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

function parseAllEnv(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8');
    const out = {};
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

// Load root .env and backend/.env into process.env if not already set (skip local dev database URLs)
const rootEnv = parseAllEnv(join(ROOT, '.env'));
for (const [k, v] of Object.entries(rootEnv)) {
  if (k === 'DATABASE_URL' || k === 'REDIS_URL') continue;
  if (process.env[k] === undefined && v !== '') process.env[k] = v;
}
const backendEnvRaw = parseAllEnv(join(ROOT, 'backend', '.env'));
for (const [k, v] of Object.entries(backendEnvRaw)) {
  if (k === 'DATABASE_URL' || k === 'REDIS_URL') continue;
  if (process.env[k] === undefined && v !== '') process.env[k] = v;
}

const URL_BASE = process.env.AEROPLANE_URL?.replace(/\/$/, '');
const API_KEY = process.env.AEROPLANE_API_KEY;
if (!URL_BASE || !API_KEY) {
  console.error('Set AEROPLANE_URL and AEROPLANE_API_KEY in process.env or .env');
  process.exit(1);
}

const APP_DOMAIN = process.env.APP_DOMAIN || 'chalkboard.click';
const REPO = 'Emmanuelmelvin/chalkboard';
const BRANCH = process.env.AEROPLANE_BRANCH || 'main';

const BACKEND_ENV_ALLOWLIST = new Set([
  'GOOGLE_CLIENT_ID', 'PG_POOL_SIZE', 'AUTH_SESSION_SECRET',
  'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET',
  'SUPER_ADMIN_EMAIL',
  'R2_BUCKET_NAME', 'R2_ACCOUNT_ID', 'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'PLUGIN_STORAGE_MODE',
  'SENTRY_DSN', 'SENTRY_API_TOKEN', 'SENTRY_API_BASE_URL',
  'SENTRY_ORG_ID', 'SENTRY_PROJECT_ID',
  'BACHS_API_BASE_URL', 'BACHS_API_KEY', 'BACHS_WEBHOOK_SECRET',
  'BACHS_PRODUCT_PRO_MONTHLY', 'BACHS_PRODUCT_PRO_ANNUAL',
  'BACHS_PRODUCT_TEAM_MONTHLY', 'BACHS_PRODUCT_TEAM_ANNUAL',
  'BACHS_PRODUCT_TEAM_SEAT_MONTHLY', 'BACHS_PRODUCT_TEAM_SEAT_ANNUAL',
  'SENDBYTE_API_KEY', 'SENDBYTE_FROM_EMAIL', 'SENDBYTE_FROM_NAME',
  'SENDBYTE_FROM_ADMIN_NAME',
]);

const FRONTEND_ENV_ALLOWLIST = new Set([
  'VITE_USERJOT_PROJECT_ID',
  'VITE_GOOGLE_CLIENT_ID',
  'VITE_LIVEKIT_URL',
  'VITE_APP_URL',
  'VITE_BACKEND_URL',
  'VITE_API_URL',
  'VITE_API_BASE_URL',
  'BACKEND_URL',
]);

function parseEnvFile(filePath, allowlist) {
  let text = '';
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (allowlist.has(key)) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

function loadBackendEnv() {
  const parsed = parseEnvFile(join(ROOT, 'backend', '.env'), BACKEND_ENV_ALLOWLIST);
  for (const key of BACKEND_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      parsed[key] = process.env[key];
    }
  }
  return parsed;
}

function loadFrontendEnv() {
  const parsed = parseEnvFile(join(ROOT, 'frontend', '.env'), FRONTEND_ENV_ALLOWLIST);
  for (const key of FRONTEND_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      parsed[key] = process.env[key];
    }
  }
  return parsed;
}

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
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    console.log(`Project: found ${existing.id} (${existing.slug || existing.name})`);
    return existing;
  }
  const created = await api('POST', '/api/projects', { name: 'Chalkboard', description: 'Chalkboard beta' });
  const project = created?.project ?? created;
  console.log(`Project: created ${project.id} (${project.slug || project.name})`);
  return project;
}

async function existingServices(projectId) {
  try {
    const projectRes = await api('GET', `/api/projects/${projectId}`);
    if (projectRes?.services && Array.isArray(projectRes.services)) return projectRes.services;
    if (projectRes?.project?.services && Array.isArray(projectRes.project.services)) return projectRes.project.services;
  } catch {}

  const { projects } = await api('GET', '/api/projects');
  const fresh = projects?.find((p) => p.id === projectId);
  return fresh?.services ?? [];
}

async function setEnv(service, key, value) {
  await api('POST', `/api/services/${service.id}/env`, { key, value });
  console.log(`  env: ${key}=${value.length > 40 ? value.slice(0, 30) + '…' : value}`);
}

async function syncEnv(service, envList) {
  if (!envList || !Array.isArray(envList) || envList.length === 0) return;
  for (const { key, value } of envList) {
    if (value !== undefined && value !== null) {
      try {
        await setEnv(service, key, String(value));
      } catch (e) {
        console.warn(`  Warning: failed to set env ${key} on ${service.name}: ${e.message}`);
      }
    }
  }
}

async function createService(projectId, payload, options = {}) {
  const existingList = await existingServices(projectId);
  const existing = existingList.find((s) => s.name === payload.name);
  if (existing) {
    // Sync env for app services
    if (payload.env && !options.isDatabase) {
      await syncEnv(existing, payload.env);
    }
    // Auto-migrate monorepo services from sub-dir context (rootDir: 'backend'/'frontend')
    // to repo-root context so `shared/` is included in the Docker build.
    const needsUpdate =
      (payload.rootDir !== undefined && (existing.rootDir ?? '') !== (payload.rootDir ?? '')) ||
      (payload.dockerfile !== undefined && (existing.dockerfile ?? '') !== (payload.dockerfile ?? '')) ||
      (payload.dockerfilePath !== undefined && (existing.dockerfilePath ?? '') !== (payload.dockerfilePath ?? '')) ||
      (payload.staticOutput !== undefined && existing.staticOutput !== payload.staticOutput) ||
      (payload.installCommand !== undefined && existing.installCommand !== payload.installCommand) ||
      (payload.buildCommand !== undefined && existing.buildCommand !== payload.buildCommand);
    if (needsUpdate) {
      const updatePayload = {};
      if (payload.rootDir !== undefined) updatePayload.rootDir = payload.rootDir;
      if (payload.dockerfile !== undefined) updatePayload.dockerfile = payload.dockerfile;
      if (payload.dockerfilePath !== undefined) updatePayload.dockerfilePath = payload.dockerfilePath;
      if (payload.staticOutput !== undefined) updatePayload.staticOutput = payload.staticOutput;
      if (payload.installCommand !== undefined) updatePayload.installCommand = payload.installCommand;
      if (payload.buildCommand !== undefined) updatePayload.buildCommand = payload.buildCommand;
      // Aeroplane has used both `dockerfile` and `dockerfilePath` across versions — send both
      if (payload.dockerfile && !updatePayload.dockerfilePath) updatePayload.dockerfilePath = payload.dockerfile;
      if (payload.dockerfilePath && !updatePayload.dockerfile) updatePayload.dockerfile = payload.dockerfilePath;
      console.log(`Service: updating ${existing.name} ${JSON.stringify({ from: { rootDir: existing.rootDir, dockerfile: existing.dockerfile || existing.dockerfilePath }, to: updatePayload })}`);
      let updated = null;
      for (const method of ['PATCH', 'PUT', 'POST']) {
        for (const path of [`/api/services/${existing.id}`, `/api/services/${existing.id}/config`, `/api/projects/${projectId}/services/${existing.id}`]) {
          try {
            updated = await api(method, path, updatePayload);
            console.log(`  -> updated via ${method} ${path}`);
            break;
          } catch {}
        }
        if (updated) break;
      }
      if (!updated) {
        console.warn(`  Warning: could not update ${existing.name} via API — if deploy still uses old rootDir, delete/recreate the service in the Aeroplane dashboard (rootDir should be '' and dockerfile backend/Dockerfile or frontend/Dockerfile).`);
      } else {
        // Refresh service record
        try {
          const overview = await api('GET', `/api/services/${existing.id}/overview`);
          return overview?.service ?? overview ?? existing;
        } catch {}
      }
    }
    console.log(`Service: reused ${existing.name} -> ${existing.id} (${existing.status})`);
    return existing;
  }
  const created = await api('POST', `/api/projects/${projectId}/services`, payload);
  const service = created?.service ?? created;
  console.log(`Service: created ${payload.name} -> ${service.id} (${service.runtimeMode || ''}, ${service.repoFullName ?? ''})`);
  return service;
}

async function waitForService(service, label, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    const overview = await api('GET', `/api/services/${service.id}/overview`);
    const s = overview?.service ?? overview;
    if (s?.status === 'active') {
      console.log(`${label}: active (hostPort ${s.hostPort ?? 'n/a'})`);
      return s;
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not become active in time`);
}

async function deployAndWait(service, label, options = {}) {
  const { force, database } = options;
  const depRes = await api('GET', `/api/services/${service.id}/deployments`);
  const deployments = Array.isArray(depRes) ? depRes : (depRes?.deployments ?? []);

  // Sort deployments newest first
  const sorted = [...deployments].sort((a, b) => {
    const tA = new Date(a.createdAt || a.created_at || 0).getTime();
    const tB = new Date(b.createdAt || b.created_at || 0).getTime();
    return tB - tA;
  });

  const latest = sorted[0];
  const previousLatestId = latest?.id;

  // In Aeroplane, 'running', 'active', 'success' means the deployment has finished and is serving.
  // 'building', 'queued', 'deploying', 'pending' means a build/deploy is actively in progress.
  const isBuilding = latest && ['queued', 'building', 'deploying', 'pending', 'preparing'].includes(latest.status);
  const isLive = latest && ['running', 'active', 'success', 'ready', 'completed', 'healthy'].includes(latest.status);

  let deploymentId = null;

  if (force) {
    if (isBuilding) {
      console.log(`${label}: build already in progress on deployment ${latest.id} (${latest.status}), tracking it...`);
      deploymentId = latest.id;
    } else {
      const res = await api('POST', `/api/services/${service.id}/deployments`, {
        branch: BRANCH,
        force: true,
      });
      deploymentId = res?.deployment?.id ?? res?.id ?? res?.deploymentId ?? res?.data?.id;
      console.log(`${label}: fresh deployment ${deploymentId ?? 'new'} queued (forced)`);
    }
  } else if (isBuilding) {
    console.log(`${label}: tracking in-flight deployment ${latest.id} (${latest.status})`);
    deploymentId = latest.id;
  } else if (isLive) {
    console.log(`${label}: already deployed (${latest.status})`);
    return;
  } else {
    const res = await api('POST', `/api/services/${service.id}/deployments`, {
      branch: BRANCH,
    });
    deploymentId = res?.deployment?.id ?? res?.id ?? res?.deploymentId ?? res?.data?.id;
    console.log(`${label}: deployment ${deploymentId ?? 'new'} queued`);
  }

  // Poll until the new deployment reaches a terminal status
  const startTime = Date.now();
  let lastStatus = '';
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const pollRes = await api('GET', `/api/services/${service.id}/deployments`);
    const list = Array.isArray(pollRes) ? pollRes : (pollRes?.deployments ?? []);
    
    // Sort poll list newest first
    const pollSorted = [...list].sort((a, b) => {
      const tA = new Date(a.createdAt || a.created_at || 0).getTime();
      const tB = new Date(b.createdAt || b.created_at || 0).getTime();
      return tB - tA;
    });

    // Find the tracked deployment. If deploymentId wasn't returned in the POST response,
    // look for a new deployment whose ID is not previousLatestId, or fallback to the newest item.
    let current = deploymentId
      ? pollSorted.find((d) => d.id === deploymentId)
      : pollSorted.find((d) => d.id !== previousLatestId) ?? pollSorted[0];

    if (current) {
      if (!deploymentId) {
        deploymentId = current.id;
      }

      const status = current.status;
      if (status !== lastStatus || i % 4 === 0) {
        lastStatus = status;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  ${label}: deployment ${current.id} is ${status} (${elapsed}s elapsed)`);
      }

      // Live / ready states indicating deployment completion
      if (['running', 'active', 'success', 'ready', 'completed', 'healthy'].includes(status)) {
        console.log(`${label}: deployment ${current.id} finished successfully (${status})`);
        return;
      }
      if (['failed', 'error', 'aborted', 'cancelled', 'crashed'].includes(status)) {
        let logs = [];
        try {
          const logRes = await api('GET', `/api/deployments/${current.id}/logs`);
          logs = Array.isArray(logRes) ? logRes : (logRes?.logs ?? []);
        } catch {}
        console.error(`${label}: deployment ${current.id} FAILED (${status})`);
        for (const l of logs.slice(-25)) {
          console.error(`  [${l.stream || 'log'}] ${l.line || l.message || JSON.stringify(l)}`);
        }
        throw new Error(`${label} deployment failed`);
      }
    }

    // Database services keep their deployment record in "running" while the
    // service itself becomes active, so for those the service status is the
    // source of truth for readiness.
    if (database) {
      try {
        const overviewRes = await api('GET', `/api/services/${service.id}/overview`);
        const dbService = overviewRes?.service ?? overviewRes;
        if (dbService?.status === 'active' || dbService?.status === 'running') {
          console.log(`${label}: deployed (service active)`);
          return;
        }
      } catch {}
    }
  }
  throw new Error(`${label} deployment timed out after 10 minutes`);
}

async function main() {
  const force = process.argv.includes('--force');
  const backendSecrets = loadBackendEnv();
  const frontendSecrets = loadFrontendEnv();
  console.log(`Loaded backend/.env (${Object.keys(backendSecrets).length} allowlisted keys)${force ? ', forcing fresh deployments' : ''}\n`);

  const project = await findOrCreateProject();
  const projectId = project.id;

  const dbPass = randomBytes(18).toString('base64url');
  const redisPass = randomBytes(18).toString('base64url');

  console.log('\n— Creating / verifying databases —');
  const postgres = await createService(projectId, {
    name: 'chalkboard-postgres', repoFullName: 'database:postgres', repoUrl: 'database',
    branch: 'main', internalPort: 5432, databasePublicEnabled: false,
    env: [
      { key: 'POSTGRES_DB', value: 'chalkboard' },
      { key: 'POSTGRES_USER', value: 'chalkboard' },
      { key: 'POSTGRES_PASSWORD', value: dbPass },
    ],
  }, { isDatabase: true });
  const redis = await createService(projectId, {
    name: 'chalkboard-redis', repoFullName: 'database:redis', repoUrl: 'database',
    branch: 'main', internalPort: 6379, databasePublicEnabled: false,
    env: [{ key: 'REDIS_PASSWORD', value: redisPass }],
  }, { isDatabase: true });

  console.log('\n— Deploying databases —');
  await deployAndWait(postgres, 'postgres', { database: true });
  await deployAndWait(redis, 'redis', { database: true });
  await waitForService(postgres, 'postgres', 24);
  await waitForService(redis, 'redis', 24);

  const { suggestions: pgSuggestion } = await api('GET', `/api/projects/${projectId}/database-variable-suggestions`);
  const pgVar = pgSuggestion.find((s) => s.dbType === 'postgres');
  const rdVar = pgSuggestion.find((s) => s.dbType === 'redis');
  if (!pgVar || !rdVar) {
    console.log('Suggestions:', JSON.stringify(pgSuggestion));
    throw new Error('Could not find database variable suggestions');
  }
  const databaseUrl = pgVar.value;
  const redisUrl = rdVar.value;
  console.log(`DB links: ${databaseUrl ? 'configured' : 'missing'} / ${redisUrl ? 'configured' : 'missing'}\n`);

  const commonEnv = [
    ...Object.entries(backendSecrets).map(([key, value]) => ({ key, value })),
    { key: 'DATABASE_URL', value: databaseUrl },
    { key: 'REDIS_URL', value: redisUrl },
    { key: 'NODE_ENV', value: 'production' },
    { key: 'CORS_ORIGIN', value: `https://${APP_DOMAIN}` },
    { key: 'APP_PUBLIC_URL', value: `https://${APP_DOMAIN}` },
  ];

  // Frontend is static hosting via Caddy — no Dockerfile, just `npm run build` in `frontend/`
  // and serve `dist/`. This keeps the build fast and lets us point the API at
  // https://api.chalkboard.click directly (no Caddy proxy for /api needed).
  const backendOrigin = `https://api.${APP_DOMAIN}`;
  const webEnv = [
    ...Object.entries(frontendSecrets).map(([key, value]) => ({ key, value })),
    { key: 'APP_PUBLIC_URL', value: `https://${APP_DOMAIN}` },
    { key: 'VITE_BACKEND_URL', value: backendOrigin },
    { key: 'VITE_API_URL', value: backendOrigin },
    { key: 'BACKEND_URL', value: backendOrigin },
  ];

  console.log('— Creating / updating app services —');
  const web = await createService(projectId, {
    name: 'web', repoUrl: 'https://github.com/Emmanuelmelvin/chalkboard.git', branch: BRANCH, rootDir: '',
    dockerfile: '', dockerfilePath: '',
    installCommand: 'npm ci --prefix frontend',
    buildCommand: 'npm run build --prefix frontend',
    buildMethod: 'auto', runtimeMode: 'web', internalPort: 80, staticOutput: 'frontend/dist', env: webEnv,
  });
  const apiService = await createService(projectId, {
    name: 'api', repoUrl: 'https://github.com/Emmanuelmelvin/chalkboard.git', branch: BRANCH, rootDir: '',
    dockerfile: 'backend/Dockerfile', dockerfilePath: 'backend/Dockerfile',
    buildMethod: 'auto', runtimeMode: 'web', internalPort: 3001, env: commonEnv,
  });
  const worker = await createService(projectId, {
    name: 'worker', repoUrl: 'https://github.com/Emmanuelmelvin/chalkboard.git', branch: BRANCH, rootDir: '',
    dockerfile: 'backend/Dockerfile', dockerfilePath: 'backend/Dockerfile',
    buildMethod: 'auto', runtimeMode: 'worker',
    env: [...commonEnv, { key: 'PROCESS_TYPE', value: 'worker' }],
  });

  console.log('\n— Deploying app services —');
  await deployAndWait(apiService, 'api', { force });
  await deployAndWait(web, 'web', { force });
  await deployAndWait(worker, 'worker', { force });

  console.log('\n— Domain —');
  try {
    const { domain } = await api('POST', `/api/services/${web.id}/domains`, { hostname: APP_DOMAIN });
    console.log(`Domain: ${domain.hostname} added to web service`);
    try {
      const dns = await api('POST', `/api/services/${web.id}/domains/${domain.id}/dns-records`, { providerId: 'cloudflare' });
      console.log(`DNS: ${dns.result?.action ?? 'ok'} ${dns.result?.recordType ?? ''} record for ${APP_DOMAIN}`);
    } catch (e) {
      console.log(`DNS: auto record failed (${e.message}) — point ${APP_DOMAIN} A/AAAA at the VPS manually`);
    }
  } catch (e) {
    console.log(`Domain: could not add via API (${e.message}) — add chalkboard.click in the dashboard or Caddyfile`);
  }

  const apiOverview = await api('GET', `/api/services/${apiService.id}/overview`);

  console.log('\n— Verifying live frontend —');
  try {
    const page = await (await fetch(`https://${APP_DOMAIN}`)).text();
    const placeholder = page.includes('VITE_USERJOT_PROJECT_ID');
    const hasUserJot = page.includes('cdn.userjot.com');
    if (placeholder) {
      console.log(`  ⚠ ${APP_DOMAIN} still contains the VITE_USERJOT_PROJECT_ID placeholder — the build did`);
      console.log('    not receive frontend env vars (expected until the runtime config endpoint lands).');
    } else if (hasUserJot) {
      console.log(`  ✓ ${APP_DOMAIN} serves a UserJot-enabled build`);
    } else {
      console.log(`  ✓ ${APP_DOMAIN} serves the new build (UserJot disabled by config)`);
    }
  } catch (e) {
    console.log(`  ? could not verify ${APP_DOMAIN}: ${e.message}`);
  }

  console.log(`
Done. Frontend at https://${APP_DOMAIN} is static (Caddy) and talks directly to https://api.${APP_DOMAIN}
Backend hostPort on the VPS: ${apiOverview.service.hostPort ?? 'n/a'} (only needed if you proxy /api via Caddy)
Caddy on the VPS already serves the static site from /opt/aeroplane/data/static-sites/; no extra
handle for /api is required when VITE_BACKEND_URL=https://api.${APP_DOMAIN} is set (direct CORS).
If you prefer same-origin /api, add to /opt/aeroplane/data/Caddyfile:

    handle /api/*       { reverse_proxy 127.0.0.1:${apiOverview.service.hostPort} }
    handle /socket.io/* { reverse_proxy 127.0.0.1:${apiOverview.service.hostPort} }

(merge into the generated site block for ${APP_DOMAIN}; Caddy reloads automatically)
`);
}

main().catch((e) => { console.error(`\nDeploy aborted: ${e.message}`); process.exit(1); });
