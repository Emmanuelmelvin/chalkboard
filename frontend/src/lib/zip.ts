export interface BrowserZipEntry {
  name: string;
  bytes: Uint8Array;
  size: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ZIP_ENTRIES = 200;
const MAX_UNCOMPRESSED_BYTES = 8_000_000;

function readUint16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function decodeName(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes).replaceAll('\\', '/');
}

function normalizeEntryName(name: string) {
  const normalized = name.replace(/^\.\//, '').replace(/\/+/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return null;
  return normalized;
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (readUint32(view, offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unpack deflated ZIP files.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipArchive(file: File): Promise<BrowserZipEntry[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const endOffset = findEndOfCentralDirectory(bytes);
  if (endOffset < 0) throw new Error('That file is not a readable ZIP archive.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = readUint16(view, endOffset + 10);
  const centralDirectorySize = readUint32(view, endOffset + 12);
  const centralDirectoryOffset = readUint32(view, endOffset + 16);
  if (entryCount > MAX_ZIP_ENTRIES || centralDirectoryOffset + centralDirectorySize > bytes.byteLength) {
    throw new Error('This ZIP archive contains too many files or an invalid directory.');
  }

  const entries: BrowserZipEntry[] = [];
  let cursor = centralDirectoryOffset;
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, cursor) !== CENTRAL_DIRECTORY_ENTRY) throw new Error('The ZIP directory is invalid.');
    const flags = readUint16(view, cursor + 8);
    const compressionMethod = readUint16(view, cursor + 10);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const fileNameLength = readUint16(view, cursor + 28);
    const extraLength = readUint16(view, cursor + 30);
    const commentLength = readUint16(view, cursor + 32);
    const localHeaderOffset = readUint32(view, cursor + 42);
    const rawName = bytes.slice(cursor + 46, cursor + 46 + fileNameLength);
    const name = normalizeEntryName(decodeName(rawName));
    cursor += 46 + fileNameLength + extraLength + commentLength;
    if (!name || name.endsWith('/')) continue;
    if ((flags & 0x1) !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('Encrypted or ZIP64 archives are not supported.');
    }
    totalSize += uncompressedSize;
    if (totalSize > MAX_UNCOMPRESSED_BYTES) throw new Error('The uncompressed ZIP contents are too large.');

    if (readUint32(view, localHeaderOffset) !== LOCAL_FILE_HEADER) throw new Error('The ZIP file header is invalid.');
    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let content: Uint8Array;
    if (compressionMethod === 0) content = compressed;
    else if (compressionMethod === 8) content = await inflateRaw(compressed);
    else throw new Error(`ZIP compression method ${compressionMethod} is not supported.`);
    if (content.byteLength !== uncompressedSize) throw new Error(`ZIP entry ${name} could not be unpacked.`);
    entries.push({ name, bytes: content, size: content.byteLength });
  }
  return entries;
}

export function zipEntryText(entry: BrowserZipEntry) {
  return new TextDecoder().decode(entry.bytes);
}

export function findZipEntry(entries: BrowserZipEntry[], filename: string) {
  return entries.find((entry) => entry.name === filename)
    || entries.find((entry) => entry.name.endsWith(`/${filename}`));
}

function resolveModuleName(fromName: string, requestedName: string, sources: Record<string, string>) {
  if (!requestedName.startsWith('.')) return null;
  const parts = fromName.split('/');
  parts.pop();
  requestedName.split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') parts.pop();
    else parts.push(part);
  });
  const base = parts.join('/');
  return [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`, `${base}/index.mjs`]
    .find((candidate) => candidate in sources) || null;
}

export function createBrowserModuleBundle(entries: BrowserZipEntry[], entryName: string) {
  const sourceEntries = entries.filter((entry) => /\.(?:js|mjs)$/i.test(entry.name));
  const sources = Object.fromEntries(sourceEntries.map((entry) => [entry.name, zipEntryText(entry)]));
  if (!sources[entryName]) throw new Error('The ZIP package must include index.js or index.mjs.');

  return `(() => {
  const sources = ${JSON.stringify(sources)};
  const entryName = ${JSON.stringify(entryName)};
  const cache = new Map();
  const building = new Set();
  const encode = (source) => {
    const bytes = new TextEncoder().encode(source);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return 'data:text/javascript;base64,' + btoa(binary);
  };
  const resolve = (fromName, requestedName) => {
    if (!requestedName.startsWith('.')) return requestedName;
    const parts = fromName.split('/');
    parts.pop();
    requestedName.split('/').forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop();
      else parts.push(part);
    });
    const base = parts.join('/');
    return [base, base + '.js', base + '.mjs', base + '/index.js', base + '/index.mjs'].find((candidate) => Object.prototype.hasOwnProperty.call(sources, candidate)) || null;
  };
  const moduleUrl = (name) => {
    if (cache.has(name)) return cache.get(name);
    if (building.has(name)) throw new Error('Circular relative imports are not supported in uploaded browser packages.');
    if (!Object.prototype.hasOwnProperty.call(sources, name)) throw new Error('Missing imported module: ' + name);
    building.add(name);
    const rewrite = (match, prefix, requestedName, suffix) => {
      const resolvedName = resolve(name, requestedName);
      if (!resolvedName) return match;
      return prefix + moduleUrl(resolvedName) + suffix;
    };
    const source = sources[name]
      .replace(/(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])/g, rewrite)
      .replace(/(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g, rewrite)
      .replace(/(\bimport\s*["'])(\.{1,2}\/[^"']+)(["'])/g, rewrite)
      .replace(/(\bexport\s*\*?\s*from\s*["'])(\.{1,2}\/[^"']+)(["'])/g, rewrite);
    building.delete(name);
    const url = encode(source);
    cache.set(name, url);
    return url;
  };
  import(moduleUrl(entryName)).catch((error) => window.parent.postMessage({ type: 'chalkboard:error', pluginId: ${JSON.stringify('PACKAGE_PLUGIN_ID')}, code: 'bundle_execution_failed', message: String(error && error.message || error) }, '*'));
})();`;
}
