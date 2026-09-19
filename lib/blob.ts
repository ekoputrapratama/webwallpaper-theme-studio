import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { del } from '@vercel/blob';

export function isBlobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
  );
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

export async function downloadBlobToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download uploaded video (${res.status})`);
  }
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never) as never, createWriteStream(tmp));
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