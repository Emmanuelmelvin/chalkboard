import { env } from '@/config/env';
import { logger } from '@/utils/logger';

const AGENT_TIMEOUT_MS = 8000;

function agentBaseUrl() {
  return (env as any).AGENT_SERVICE_URL?.replace(/\/+$/, '') || 'http://localhost:8080';
}

async function proxyFetch(path: string, init: RequestInit) {
  const url = `${agentBaseUrl()}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { status: res.status, ok: res.ok, data };
  } catch (error: any) {
    logger.warn('Agent service proxy failed', {
      url,
      error: error?.message || String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function instructAgent(payload: {
  roomId: string;
  prompt: string;
  level?: string;
  style?: string;
  requestedBy: string;
}) {
  const result = await proxyFetch('/instruct', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return result;
}

export async function stopAgent(payload: { roomId: string }) {
  const result = await proxyFetch('/stop', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return result;
}

export async function getAgentHealth() {
  const result = await proxyFetch('/health', { method: 'GET' });
  return result;
}
