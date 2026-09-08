import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryDynamicImport } from './retryDynamicImport';

const CHUNK_RETRY_KEY = 'chalkboard:chunk-import-retry';

function chunkError(url = 'https://www.chalkboard.click/assets/Dashboard-XYZ.js'): TypeError {
  return new TypeError(`Failed to fetch dynamically imported module: ${url}`);
}

// jsdom's Location#reload is non-configurable, so swap the whole location object.
const originalLocation = window.location;
const reloadMock = vi.fn();

describe('retryDynamicImport', () => {
  beforeEach(() => {
    sessionStorage.clear();
    reloadMock.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    sessionStorage.clear();
  });

  it('resolves the loaded module on success and clears the retry flag', async () => {
    sessionStorage.setItem(CHUNK_RETRY_KEY, '1');
    const result = await retryDynamicImport(async () => ({ default: 42 }));
    expect(result).toEqual({ default: 42 });
    expect(sessionStorage.getItem(CHUNK_RETRY_KEY)).toBeNull();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('rethrows non-chunk errors without reloading', async () => {
    const boom = new Error('network error');
    await expect(retryDynamicImport(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('reloads the page on the first stale-chunk failure', async () => {
    const pending = retryDynamicImport(() => Promise.reject(chunkError()));
    await new Promise((r) => setTimeout(r, 20));
    expect(reloadMock).toHaveBeenCalledTimes(1);
    // The returned promise never settles because the reload replaces the page.
    expect(sessionStorage.getItem(CHUNK_RETRY_KEY)).toBe('1');
    expect(pending).toBeInstanceOf(Promise);
  });

  it('surfaces the error after the reload attempt did not help', async () => {
    sessionStorage.setItem(CHUNK_RETRY_KEY, '1');
    const stale = chunkError();
    await expect(retryDynamicImport(() => Promise.reject(stale))).rejects.toBe(stale);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHUNK_RETRY_KEY)).toBeNull();
  });
});