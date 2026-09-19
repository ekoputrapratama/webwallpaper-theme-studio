import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { del, get } from '@vercel/blob';

export function isBlobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
  );
}

export function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN;
}

export function tmpFileNameFromBlob(url: string, fallback = 'video.mp4'): string {
  try {
    const { pathname } = new URL(url);
    const name = pathname.split('/').pop();
    return name && name.trim() ? decodeURIComponent(name) : fallback;
  } catch {
    return fallback;
  }
}

export function blobAccessFromUrl(url: string): 'public' | 'private' {
  try {
    const { hostname } = new URL(url);
    return hostname.includes('.private.') ? 'private' : 'public';
  } catch {
    return 'public';
  }
}

export async function downloadBlobToFile(url: string, dest: string): Promise<void> {
  const access = blobAccessFromUrl(url);
  let result;
  try {
    result = await get(url, { access });
  } catch (err) {
    throw new Error(
      `Failed to download uploaded video (access=${access}, url=${url}): ${err instanceof Error ? err.message : err}`
    );
  }
  if (!result || result.statusCode !== 200 || !result.stream) {
    const detail = result ? `status=${result.statusCode}` : 'not found (404)';
    throw new Error(`Failed to download uploaded video (access=${access}, url=${url}, ${detail})`);
  }
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(result.stream as never) as never, createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

export async function deleteBlob(url: string): Promise<void> {
  if (!url) return;
  try {
    await del(url);
    console.log('[blob] deleted temporary upload', url);
  } catch (err) {
    console.warn('[blob] failed to delete temporary upload', url, err);
  }
}