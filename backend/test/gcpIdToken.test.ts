import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getGoogleTokenHeader,
  type GoogleAuthLike,
  type IdTokenHeaderProvider,
} from '../src/services/rooms/gcpIdToken';

/**
 * The agent-service Cloud Run deployment is `--no-allow-unauthenticated`, so
 * the backend must attach a Google IAM OIDC token in the Authorization header
 * or Cloud Run rejects the request before it reaches the container with
 * "Empty Authorization header value". These tests pin the header logic without
 * importing the env module (which validates at import time and is deliberately
 * avoided by the rest of the test suite).
 */

const CLOUD_RUN_URL = 'https://chalkboard-agent-service-abcdef1234-uc.a.run.app';

function fakeAuth(provider: IdTokenHeaderProvider): GoogleAuthLike {
  return { getIdTokenClient: async () => provider };
}

describe('getGoogleTokenHeader', () => {
  it('skips plain-http development URLs without touching the provider', async () => {
    let called = false;
    const auth: GoogleAuthLike = {
      getIdTokenClient: async () => {
        called = true;
        return {} as IdTokenHeaderProvider;
      },
    };
    const result = await getGoogleTokenHeader('http://localhost:8080', auth);
    assert.deepEqual(result, {});
    assert.equal(called, false);
  });

  it('uses the normalized HTTPS URL (minus trailing slash) as the token audience', async () => {
    const audiences: string[] = [];
    const auth: GoogleAuthLike = {
      getIdTokenClient: async (targetUrl) => {
        audiences.push(targetUrl);
        return { getRequestHeaders: async () => ({ Authorization: 'Bearer token-aud' }) };
      },
    };
    const result = await getGoogleTokenHeader(`${CLOUD_RUN_URL}/`, auth);
    assert.deepEqual(audiences, [CLOUD_RUN_URL]);
    assert.deepEqual(result, { authorization: 'Bearer token-aud' });
  });

  it('attaches the IAM bearer header for an HTTPS Cloud Run URL', async () => {
    const provider: IdTokenHeaderProvider = {
      getRequestHeaders: async () => ({ Authorization: 'Bearer token-1' }),
    };
    const result = await getGoogleTokenHeader(CLOUD_RUN_URL, fakeAuth(provider));
    assert.deepEqual(result, { authorization: 'Bearer token-1' });
  });

  it('also accepts a lowercase authorization header', async () => {
    const provider: IdTokenHeaderProvider = {
      getRequestHeaders: async () => ({ authorization: 'Bearer token-lower' }),
    };
    const result = await getGoogleTokenHeader(CLOUD_RUN_URL, fakeAuth(provider));
    assert.deepEqual(result, { authorization: 'Bearer token-lower' });
  });

  it('returns {} when the provider sends no authorization header', async () => {
    const provider: IdTokenHeaderProvider = { getRequestHeaders: async () => ({}) };
    const result = await getGoogleTokenHeader(CLOUD_RUN_URL, fakeAuth(provider));
    assert.deepEqual(result, {});
  });

  it('reports an error instead of throwing when the token fetch fails', async () => {
    const provider: IdTokenHeaderProvider = {
      getRequestHeaders: async () => { throw new Error('metadata hiccup'); },
    };
    const result = await getGoogleTokenHeader(CLOUD_RUN_URL, fakeAuth(provider));
    assert.ok(result.error);
    assert.equal(result.authorization, undefined);
  });

  it('self-heals: a failed attempt is not cached, so the next call retries', async () => {
    let attempts = 0;
    const provider: IdTokenHeaderProvider = {
      getRequestHeaders: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient failure');
        return { Authorization: 'Bearer retried-token' };
      },
    };
    const auth = fakeAuth(provider);

    const first = await getGoogleTokenHeader(CLOUD_RUN_URL, auth);
    assert.ok(first.error);
    assert.equal(first.authorization, undefined);

    const second = await getGoogleTokenHeader(CLOUD_RUN_URL, auth);
    assert.deepEqual(second, { authorization: 'Bearer retried-token' });
  });
});