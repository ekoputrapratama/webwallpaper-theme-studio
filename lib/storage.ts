import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { adminStorageBucketName, getAdminStorage, isFirebaseAdminConfigured } from './firebase-admin';

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.gif': 'image/gif',
  '.png': 'image/png',
};

export function isFirebaseStorageConfigured(): boolean {
  return isFirebaseAdminConfigured() && Boolean(adminStorageBucketName());
}

function bucket() {
  return getAdminStorage().bucket(adminStorageBucketName());
}

export function storagePathFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const m = pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
    if (!m) return null;
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export function tmpFileNameFromUrl(url: string, fallback = 'video.mp4'): string {
  const p = storagePathFromUrl(url);
  const name = p ? p.split('/').pop() : '';
  return name && name.trim() ? name : fallback;
}

export async function downloadUrlToFile(url: string, dest: string): Promise<void> {
  const storagePath = storagePathFromUrl(url);
  if (!storagePath) {
    throw new Error(`Failed to download uploaded video (url=${url}, not a Firebase Storage URL)`);
  }
  const file = bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`Failed to download uploaded video (path=${storagePath}, not found (404))`);
  }
  const tmp = `${dest}.part`;
  await pipeline(file.createReadStream(), createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

export interface StorageObject {
  pathname: string;
  size: number;
}

export async function storagePut(storagePath: string, data: Buffer): Promise<void> {
  const ext = storagePath.slice(storagePath.lastIndexOf('.')).toLowerCase();
  await bucket().file(storagePath).save(data, {
    resumable: false,
    metadata: { contentType: MIME_BY_EXT[ext] || 'application/octet-stream' },
  });
}

export async function storageList(prefix: string): Promise<StorageObject[]> {
  const [files] = await bucket().getFiles({ prefix });
  return files.map((f) => ({ pathname: f.name, size: Number(f.metadata?.size ?? 0) }));
}

export async function storageRead(
  storagePath: string
): Promise<{ stream: Readable; size: number } | null> {
  const file = bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  return { stream: file.createReadStream(), size: Number(meta.size ?? 0) };
}

export async function storageDelete(storagePath: string): Promise<void> {
  if (!storagePath) return;
  const file = bucket().file(storagePath);
  const [exists] = await file.exists();
  if (exists) await file.delete();
}