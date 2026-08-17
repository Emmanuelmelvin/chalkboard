#!/usr/bin/env node
/**
 * Deploy Chalkboard to Aeroplane.
 *
 * Reads AEROPLANE_URL and AEROPLANE_API_KEY from the environment and
 * backend/.env for application secrets, then provisions:
 *   - a "chalkboard" project
 *   - Postgres + Redis database services (private)
 *   - web (frontend static site), api (backend), worker services
 *   - the chalkboard.click domain on the web service
 *   - deployments for every service, waiting for each to finish
 *
 * Usage: AEROPLANE_URL=https://pilot.orafi.app AEROPLANE_API_KEY=ap_... node deploy-aeroplane.mjs
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL_BASE = process.env.AEROPLANE_URL?.replace(/\/$/, '');
const API_KEY = process.env.AEROPLANE_API_KEY;
if (!URL_BASE || !API_KEY) {
  console.error('Set AEROPLANE_URL and AEROPLANE_API_KEY.');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const APP_DOMAIN = 'chalkboard.click';
const REPO = 'Emmanuelmelvin/chalkboard';
const BRANCH = 'main';

const ENV_ALLOWLIST = new Set([
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

function loadEnvFile() {
  const text = readFileSync(join(ROOT, 'backend', '.env'), 'utf8');
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!ENV_ALLOWLIST.has(key)) continue;
    out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

async function api(method, path, body) {
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
    throw new Error(`${method} ${path} -> ${res.status}: ${data?.error ?? text.slice(0, 300)}`);
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findOrCreateProject() {
  const { projects } = await api('GET', '/api/projects');
  const existing = projects.find((p) => p.slug === 'chalkboard');
  if (existing) {
    console.log(`Project: found ${existing.id} (${existing.slug})`);
    return existing;
  }
  const { project } = await api('POST', '/api/projects', { name: 'Chalkboard', description: 'Chalkboard beta' });
  console.log(`Project: created ${project.id} (${project.slug})`);
  return project;
}

async function existingServices(projectId) {
  const { projects } = await api('GET', '/api/projects');
  const fresh = projects.find((p) => p.id === projectId);
  return fresh?.services ?? [];
}

async function createService(projectId, payload) {
  const existing = (await existingServices(projectId)).find((s) => s.name === payload.name);
  if (existing) {
    console.log(`Service: reused ${existing.name} -> ${existing.id} (${existing.status})`);
    return existing;
  }
  const { service } = await api('POST', `/api/projects/${projectId}/services`, payload);
  console.log(`Service: created ${payload.name} -> ${service.id} (${service.runtimeMode}, ${service.repoFullName ?? ''})`);
  return service;
}

async function waitForService(service, label, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    const { service: s } = await api('GET', `/api/services/${service.id}/overview`);
    if (s.status === 'active') {
      console.log(`${label}: active (hostPort ${s.hostPort ?? 'n/a'})`);
      return s;
    }
    await sleep(5000);
  }
  throw new Error(`${label} did not become active in time`);
}

async function deployAndWait(service, label) {
  const { deployments } = await api('GET', `/api/services/${service.id}/deployments`);
  const latest = deployments[0];
  let deploymentId = latest?.id;
  if (latest && ['queued', 'running', 'building'].includes(latest.status)) {
    console.log(`${label}: reusing in-flight deployment ${latest.id} (${latest.status})`);
  } else if (latest && ['success', 'active'].includes(latest.status)) {
    console.log(`${label}: already deployed (${latest.status})`);
    return;
  } else {
    const res = await api('POST', `/api/services/${service.id}/deployments`);
    deploymentId = res.deployment.id;
    console.log(`${label}: deployment ${deploymentId} queued`);
  }
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const { deployments: list } = await api('GET', `/api/services/${service.id}/deployments`);
    const current = list[0];
    const { service: currentService } = await api('GET', `/api/services/${service.id}/overview`);
    // Database services keep their deployment record in "running" while the
    // service itself becomes active, so the service status is the source of
    // truth for readiness.
    if (currentService.status === 'active') {
      console.log(`${label}: deployed (service active)`);
      return;
    }
    if (current.id !== deploymentId) continue;
    if (current.status === 'failed' || current.status === 'error' || current.status === 'aborted') {
      const { logs } = await api('GET', `/api/deployments/${deploymentId}/logs`);
      console.error(`${label}: deployment FAILED (${current.status})`);
      for (const l of logs.slice(-25)) console.error(`  [${l.stream}] ${l.line}`);
      throw new Error(`${label} deployment failed`);
    }
  }
  throw new Error(`${label} deployment timed out`);
}

async function setEnv(service, key, value) {
  await api('POST', `/api/services/${service.id}/env`, { key, value });
  console.log(`  env: ${key}=${value.length > 40 ? value.slice(0, 30) + '…' : value}`);
}

async function main() {
  const secrets = loadEnvFile();
  console.log('Loaded backend/.env\n');

  const project = await findOrCreateProject();
  const projectId = project.id;

  const dbPass = randomBytes(18).toString('base64url');
  const redisPass = randomBytes(18).toString('base64url');

  console.log('\n— Creating databases —');
  const postgres = await createService(projectId, {
    name: 'chalkboard-postgres', repoFullName: 'database:postgres', repoUrl: 'database',
    branch: 'main', internalPort: 5432, databasePublicEnabled: false,
    env: [
      { key: 'POSTGRES_DB', value: 'chalkboard' },
      { key: 'POSTGRES_USER', value: 'chalkboard' },
      { key: 'POSTGRES_PASSWORD', value: dbPass },
    ],
  });
  const redis = await createService(projectId, {
    name: 'chalkboard-redis', repoFullName: 'database:redis', repoUrl: 'database',
    branch: 'main', internalPort: 6379, databasePublicEnabled: false,
    env: [{ key: 'REDIS_PASSWORD', value: redisPass }],
  });

  console.log('\n— Deploying databases —');
  await deployAndWait(postgres, 'postgres');
  await deployAndWait(redis, 'redis');
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
  console.log(`DB links: ${pgVar.key} / ${rdVar.key}\n`);

  const commonEnv = [
    ...Object.entries(secrets).map(([key, value]) => ({ key, value })),
    { key: 'DATABASE_URL', value: databaseUrl },
    { key: 'REDIS_URL', value: redisUrl },
    { key: 'NODE_ENV', value: 'production' },
    { key: 'CORS_ORIGIN', value: `https://${APP_DOMAIN}` },
    { key: 'APP_PUBLIC_URL', value: `https://${APP_DOMAIN}` },
  ];

  console.log('— Creating app services —');
  const web = await createService(projectId, {
    name: 'web', repoUrl: 'https://github.com/Emmanuelmelvin/chalkboard.git', branch: BRANCH, rootDir: 'frontend',
    buildMethod: 'auto', runtimeMode: 'web', internalPort: 80, staticOutput: 'dist',
  });
  const apiService = await createService(projectId, {
    name: 'api', repoUrl: 'https://github.com/Emmanuelmelvin/chalkboard.git', branch: BRANCH, rootDir: 'backend',
    buildMethod: 'auto', runtimeMode: 'web', internalPort: 3001, env: commonEnv,
  });
  const worker = await createService(projectId, {
    name: 'worker', repoUrl: 'https://github.com/Emmanuelmelvin/chalkboard.git', branch: BRANCH, rootDir: 'backend',
    buildMethod: 'auto', runtimeMode: 'worker',
    env: [...commonEnv, { key: 'PROCESS_TYPE', value: 'worker' }],
  });

  console.log('\n— Deploying app services —');
  await deployAndWait(apiService, 'api');
  await deployAndWait(web, 'web');
  await deployAndWait(worker, 'worker');

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
  console.log(`
Done. Backend hostPort on the VPS: ${apiOverview.service.hostPort ?? 'n/a'}

To route /api and /socket.io from ${APP_DOMAIN} to the backend, add to the
Caddyfile on the VPS (/opt/aeroplane/data/Caddyfile):

    handle /api/*       { reverse_proxy 127.0.0.1:${apiOverview.service.hostPort} }
    handle /socket.io/* { reverse_proxy 127.0.0.1:${apiOverview.service.hostPort} }

(merge into the generated site block for ${APP_DOMAIN}; Caddy reloads automatically)
`);
}

main().catch((e) => { console.error(`\nDeploy aborted: ${e.message}`); process.exit(1); });
