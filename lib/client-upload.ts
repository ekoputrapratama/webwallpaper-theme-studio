'use client';

import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getClientApp, getClientAuth } from '@/lib/firebase';

export type VideoUpload =
  | { kind: 'blob'; url: string }
  | { kind: 'multipart'; file: File; reason?: string };

export const MULTIPART_SAFE_LIMIT = 4 * 1024 * 1024;

function errCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code || 'unknown')
    : 'unknown';
}

export async function uploadVideoToStorage(
  file: File,
  onProgress: (percentage: number) => void
): Promise<VideoUpload> {
  const app = getClientApp();
  if (!app) {
    return {
      kind: 'multipart',
      file,
      reason:
        'Firebase Storage is not configured in this build (missing NEXT_PUBLIC_FIREBASE_* env vars). Set them and redeploy so videos upload straight to storage.',
    };
  }

  const auth = getClientAuth();
  if (!auth) {
    return { kind: 'multipart', file, reason: 'Firebase client SDK could not be initialized.' };
  }

  if (!auth.currentUser) {
    try {
      await auth.authStateReady();
    } catch {
      // ignore — authStateReady has no meaningful failure; currentUser is authoritative
    }
  }

  if (!auth.currentUser) {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      const code = errCode(err);
      const reason =
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? 'Sign-in was cancelled, so the video cannot be uploaded to cloud storage.'
          : code === 'auth/unauthorized-domain'
            ? `Firebase sign-in failed (auth/unauthorized-domain): this page (${window.location.origin}) is not in Firebase Auth → Settings → Authorized domains. Add it there, then retry.`
            : `Firebase sign-in failed (${code}). Check that the Auth providers are enabled and that the auth domain is set.`;
      return { kind: 'multipart', file, reason };
    }
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { kind: 'multipart', file, reason: 'Firebase sign-in did not complete.' };
  }

  try {
    const storage = getStorage(app);
    const uid = currentUser.uid;
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
    const code = errCode(err);
    console.warn(`[upload] Firebase Storage upload failed (${code}), falling back to direct upload.`, err);
    return {
      kind: 'multipart',
      file,
      reason: `Firebase Storage upload failed (${code}). Check the storage rules (uploads/** must allow signed-in writes) and that the bucket in NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET exists.`,
    };
  }
}