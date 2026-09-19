import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildVideoTheme, slugify, tmpVideoPath } from '@/lib/themes';
import { downloadBlobToFile, isBlobConfigured, tmpFileNameFromBlob } from '@/lib/blob';
import { createProjectFromDir, remoteEnabled, scratchProjectDir, uniqueProjectId } from '@/lib/persist';
import { getRequestUser } from '@/lib/auth';

export const runtime = 'nodejs';

type VideoForm = {
  name: string;
  description: string;
  author: string;
  version: string;
};

async function readForm(request: Request): Promise<{ meta: VideoForm; file: File | null }> {
  const form = await request.formData();
  const file = form.get('video');
  return {
    meta: {
      name: String(form.get('name') || '').trim(),
      description: String(form.get('description') || '').trim(),
      author: String(form.get('author') || '').trim(),
      version: String(form.get('version') || '1.0').trim(),
    },
    file: file instanceof File ? file : null,
  };
}

async function saveUpload(file: File, tmpPath: string): Promise<void> {
  await pipeline(
    Readable.fromWeb(file.stream() as never) as never,
    createWriteStream(tmpPath)
  );
}

export async function POST(request: Request) {
  let tmpPath: string | null = null;
  let blobUrl: string | null = null;
  let dir: string | null = null;
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const contentType = request.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    let meta: VideoForm;
    let fileName = 'video.mp4';

    if (isJson && isBlobConfigured()) {
      const body = (await request.json().catch(() => ({}))) as {
        videoUrl?: string;
        name?: string;
        description?: string;
        author?: string;
        version?: string;
      };
      if (!body.videoUrl) {
        return Response.json({ error: 'Please upload a video file' }, { status: 400 });
      }
      blobUrl = body.videoUrl;
      fileName = tmpFileNameFromBlob(blobUrl);
      meta = {
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        author: String(body.author || '').trim(),
        version: String(body.version || '1.0').trim(),
      };
      if (!meta.name) return Response.json({ error: 'Project name is required' }, { status: 400 });

      tmpPath = tmpVideoPath(fileName);
      await downloadBlobToFile(blobUrl, tmpPath);
    } else {
      const { meta: m, file } = await readForm(request);
      if (!m.name) return Response.json({ error: 'Project name is required' }, { status: 400 });
      if (!file) return Response.json({ error: 'Please upload a video file' }, { status: 400 });
      if (!file.type.startsWith('video/')) {
        return Response.json({ error: 'Only video files are allowed' }, { status: 400 });
      }
      meta = m;
      fileName = file.name;
      tmpPath = tmpVideoPath(fileName);
      await saveUpload(file, tmpPath);
    }

    const id = await uniqueProjectId(slugify(meta.name));
    dir = scratchProjectDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const created = await buildVideoTheme(id, dir, tmpPath, {
      name: meta.name,
      description: meta.description,
      author: meta.author,
      version: meta.version,
    });

    await createProjectFromDir(id, user.uid, dir, created);

    return Response.json(created, { status: 201 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to create video theme' }, { status: 500 });
  } finally {
    if (tmpPath) fs.rmSync(tmpPath, { force: true });
    if (dir && remoteEnabled()) fs.rmSync(dir, { recursive: true, force: true });
  }
}