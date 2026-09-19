'use client';

import { getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { getClientApp, getClientAuth } from '@/lib/firebase';

export type VideoUpload =
  | { kind: 'blob'; url: string }
  | { kind: 'multipart'; file: File };

export async function uploadVideoToStorage(
  file: File,
  onProgress: (percentage: number) => void
): Promise<VideoUpload> {
  const app = getClientApp();
  const auth = getClientAuth();

  if (!app || !auth?.currentUser) {
    return { kind: 'multipart', file };
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
    console.warn('[upload] Firebase Storage upload unavailable, falling back to direct upload.', err);
    return { kind: 'multipart', file };
  }
}