import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PROJECTS_DIR, buildVideoTheme, slugify, uniqueId, tmpVideoPath } from '@/lib/themes';

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
  try {
    const { meta, file } = await readForm(request);
    if (!meta.name) return Response.json({ error: 'Project name is required' }, { status: 400 });
    if (!file) return Response.json({ error: 'Please upload a video file' }, { status: 400 });
    if (!file.type.startsWith('video/')) {
      return Response.json({ error: 'Only video files are allowed' }, { status: 400 });
    }

    tmpPath = tmpVideoPath(file.name);
    await saveUpload(file, tmpPath);

    const id = uniqueId(slugify(meta.name));
    const dir = path.join(PROJECTS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });

    const created = await buildVideoTheme(id, dir, tmpPath, {
      name: meta.name,
      description: meta.description,
      author: meta.author,
      version: meta.version,
    });

    return Response.json(created, { status: 201 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to create video theme' }, { status: 500 });
  } finally {
    if (tmpPath) fs.rmSync(tmpPath, { force: true });
  }
}