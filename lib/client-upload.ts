'use client';

import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { getClientApp, getClientAuth } from '@/lib/firebase';

export type VideoUpload =
  | { kind: 'blob'; url: string }
  | { kind: 'multipart'; file: File; reason?: string };

export const MULTIPART_SAFE_LIMIT = 4 * 1024 * 1024;

export async function uploadVideoToStorage(
  file: File,
  onProgress: (percentage: number) => void
): Promise<VideoUpload> {
  const app = getClientApp();
  const auth = getClientAuth();

  if (!app || !auth?.currentUser) {
    const reason = !app
      ? 'Firebase Storage is not configured in this build (missing NEXT_PUBLIC_FIREBASE_* env vars). Set them and redeploy so videos upload straight to storage.'
      : 'You are not signed in to Firebase on this device. Refresh the page and sign in again.';
    return { kind: 'multipart', file, reason };
  }

  try {
    const storage = getStorage(app);
    const uid = auth.currentUser.uid;
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '.mp4';
    const storagePath = `uploads/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;

    const task = uploadBytesResumable(ref(storage, storagePath), file, {
      contentType: file.type || 'video/mp4',
    });
    task.on('state_changed', (snap) => {
      onProgress(Math.round((snap.bytesTransferred / Math.max(snap.totalBytes, 1)) * 100));
    });

    await task;
    const url = await getDownloadURL(ref(storage, storagePath));
    return { kind: 'blob', url };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code || 'unknown';
    console.warn(`[upload] Firebase Storage upload failed (${code}), falling back to direct upload.`, err);
    return {
      kind: 'multipart',
      file,
      reason: `Firebase Storage upload failed (${code}). Check the storage rules (uploads/** must allow signed-in writes) and that the bucket in NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET exists.`,
    };
  }
}