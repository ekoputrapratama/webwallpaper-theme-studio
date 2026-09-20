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
  donationLabel: string;
  zip: Buffer;
  thumbnail: Buffer;
};

export type PublishResult = { id: string; wallpaperUrl: string; thumbnailUrl: string };

function publicStorageUrl(bucket: string, storagePath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;
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

  const base = `themes/${input.uid}/${slugify(input.meta.name)}-${Date.now()}`;
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

  const ref = await db.collection('wallpapers').add({
    name: input.meta.name,
    description: input.meta.description,
    author: input.meta.author,
    uid: input.uid,
    thumbnail_url: publicStorageUrl(bucketName, thumbPath),
    wallpaper_url: publicStorageUrl(bucketName, zipPath),
    type: 'theme',
    tags: Array.isArray(input.tags) ? input.tags : [],
    donation_url: input.donationUrl || '',
    donation_label: input.donationLabel || '',
    downloads: 0,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  return {
    id: ref.id,
    wallpaperUrl: publicStorageUrl(bucketName, zipPath),
    thumbnailUrl: publicStorageUrl(bucketName, thumbPath),
  };
}