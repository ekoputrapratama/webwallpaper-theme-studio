'use client';

import { uploadPresigned } from '@vercel/blob/client';

export type VideoUpload =
  | { kind: 'blob'; url: string }
  | { kind: 'multipart'; file: File };

export async function uploadVideoToStorage(
  file: File,
  onProgress: (percentage: number) => void,
  clientPayload?: string
): Promise<VideoUpload> {
  try {
    const blob = await uploadPresigned(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/uploads/video',
      clientPayload,
      onUploadProgress: (event) => onProgress(event.percentage),
    });
    return { kind: 'blob', url: blob.url };
  } catch (err) {
    console.warn('[upload] Vercel Blob upload unavailable, falling back to direct upload.', err);
    return { kind: 'multipart', file };
  }
}