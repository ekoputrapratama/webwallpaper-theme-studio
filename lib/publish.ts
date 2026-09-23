import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { adminStorageBucketName, getAdminApp, isFirebaseAdminConfigured } from './firebase-admin';
import { slugify, type ThemeMeta } from './themes';

export const WEBKIT_FIRESTORE_DB = 'webkit-wallpaper';

export type PublishInput = {
  uid: string;
  meta: ThemeMeta;
  tags: string[];
  donationUrl: string;
  zip: Buffer;
  thumbnail: Buffer;
  themeId?: string | null;
};

export type PublishResult = { id: string; wallpaperUrl: string; thumbnailUrl: string };

function publicStorageUrl(bucket: string, storagePath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

function storagePathFromUrl(url: string): string | null {
  const m = /\/o\/([^?]+)/.exec(url || '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export async function publishTheme(input: PublishInput): Promise<PublishResult> {
  if (!isFirebaseAdminConfigured()) {
    throw new Error('Publishing requires the Firebase Admin SDK to be configured on the server.');
  }
  const bucketName = adminStorageBucketName();
  if (!bucketName) {
    throw new Error('Publishing requires NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET to be set.');
  }

  const app = getAdminApp();
  const db = getFirestore(app, WEBKIT_FIRESTORE_DB);
  const bucket = getStorage(app).bucket(bucketName);

  let existingDocData: Record<string, unknown> | null = null;
  if (input.themeId) {
    const doc = await db.collection('wallpapers').doc(input.themeId).get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (data.uid && String(data.uid) !== input.uid) {
        throw new Error('This published theme belongs to another account and cannot be updated.');
      }
      existingDocData = data;
    }
  }

  const defaultBase = `themes/${input.uid}/${slugify(input.meta.name)}-${Date.now()}`;
  let base = defaultBase;

  if (existingDocData) {
    const thumbPath = storagePathFromUrl(String(existingDocData.thumbnail_url || ''));
    if (thumbPath) {
      const slash = thumbPath.lastIndexOf('/');
      if (slash > 0) base = thumbPath.slice(0, slash);
    }
  }

  const thumbPath = `${base}/thumbnail.gif`;
  const zipPath = `${base}/wallpaper.zip`;

  await bucket.file(thumbPath).save(input.thumbnail, {
    resumable: false,
    contentType: 'image/gif',
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await bucket.file(zipPath).save(input.zip, {
    resumable: false,
    contentType: 'application/zip',
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  const themeData = {
    name: input.meta.name,
    description: input.meta.description,
    author: input.meta.author,
    uid: input.uid,
    thumbnail_url: publicStorageUrl(bucketName, thumbPath),
    wallpaper_url: publicStorageUrl(bucketName, zipPath),
    type: 'theme',
    tags: Array.isArray(input.tags) ? input.tags : [],
    donation_url: input.donationUrl || '',
    updated_at: FieldValue.serverTimestamp(),
  };

  let id: string;
  if (existingDocData && input.themeId) {
    await db.collection('wallpapers').doc(input.themeId).set(themeData, { merge: true });
    id = input.themeId;
  } else {
    const added = await db.collection('wallpapers').add({
      ...themeData,
      downloads: 0,
      created_at: FieldValue.serverTimestamp(),
    });
    id = added.id;
  }

  return {
    id,
    wallpaperUrl: publicStorageUrl(bucketName, zipPath),
    thumbnailUrl: publicStorageUrl(bucketName, thumbPath),
  };
}