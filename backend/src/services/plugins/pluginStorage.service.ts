import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/config/env';
import { APIError } from '@/utils/error';

export type PluginAssetKind = 'logo' | 'bundle' | 'archive';

export interface StoredPluginAsset {
  key: string;
  contentType: string;
  size: number;
  sha256: string;
}

const r2Configured = env.PLUGIN_STORAGE_MODE === 'r2';
const r2Values = [env.R2_ENDPOINT, env.R2_BUCKET_NAME, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY];
if (r2Configured && r2Values.some((value) => !value)) {
  throw new Error('R2 plugin storage requires R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
}

const r2 = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    })
  : null;

const storageRoot = resolve(process.cwd(), env.PLUGIN_STORAGE_DIR);

function safeKey(key: string) {
  const normalized = key.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new APIError('invalid_plugin_asset_key', 400);
  }
  return normalized;
}

function localPath(key: string) {
  const normalized = safeKey(key);
  const target = resolve(storageRoot, normalized);
  const pathRelativeToRoot = relative(storageRoot, target);
  if (pathRelativeToRoot.startsWith('..') || isAbsolute(pathRelativeToRoot)) {
    throw new APIError('invalid_plugin_asset_key', 400);
  }
  return target;
}

async function toBuffer(body: unknown): Promise<Buffer> {
  if (!body) throw new APIError('plugin_asset_missing', 502);
  if (body instanceof Buffer) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === 'function') {
    return Buffer.from(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function pluginAssetKey(pluginId: string, version: string, kind: PluginAssetKind, extension: string) {
  return `plugins/${pluginId}/${version}/${kind}.${extension}`;
}

export function decodeBase64DataUrl(value: string, expectedType?: string) {
  const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new APIError('invalid_plugin_asset', 400);
  const [, contentType, encoded] = match;
  if (expectedType && contentType !== expectedType) throw new APIError('invalid_plugin_asset_type', 400);
  const body = Buffer.from(encoded, 'base64');
  if (body.length === 0) throw new APIError('invalid_plugin_asset', 400);
  return { body, contentType };
}

export async function putPluginAsset(key: string, body: Buffer, contentType: string): Promise<StoredPluginAsset> {
  const normalizedKey = safeKey(key);
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (r2) {
    await r2.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME!,
      Key: normalizedKey,
      Body: body,
      ContentType: contentType,
      CacheControl: 'private, max-age=0, no-cache',
      Metadata: { sha256 },
    }));
  } else {
    const target = localPath(normalizedKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  return { key: normalizedKey, contentType, size: body.length, sha256 };
}

export async function getPluginAsset(key: string): Promise<Buffer> {
  const normalizedKey = safeKey(key);
  if (r2) {
    const result = await r2.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME!, Key: normalizedKey }));
    return toBuffer(result.Body);
  }
  try {
    return await readFile(localPath(normalizedKey));
  } catch {
    throw new APIError('plugin_asset_not_found', 404);
  }
}

export async function deletePluginAsset(key: string) {
  const normalizedKey = safeKey(key);
  if (r2) {
    await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME!, Key: normalizedKey }));
    return;
  }
  try {
    await unlink(localPath(normalizedKey));
  } catch {
    // Cleanup is best-effort when a database write fails after an upload.
  }
}

export async function getPluginAssetReadUrl(key: string) {
  const normalizedKey = safeKey(key);
  if (!r2) return null;
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME!, Key: normalizedKey }), { expiresIn: env.R2_SIGNED_URL_TTL_SECONDS });
}

export async function getPluginAssetDataUrl(key: string, contentType: string) {
  const body = await getPluginAsset(key);
  return `data:${contentType};base64,${body.toString('base64')}`;
}

export function getPluginStorageMode() {
  return env.PLUGIN_STORAGE_MODE;
}
