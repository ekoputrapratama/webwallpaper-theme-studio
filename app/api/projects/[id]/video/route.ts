import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildVideoTheme, projectDir, readProject, tmpVideoPath } from '@/lib/themes';
import { downloadBlobToFile, isBlobConfigured, tmpFileNameFromBlob, deleteBlob } from '@/lib/blob';

export const runtime = 'nodejs';

export async function POST(request: Request, ctx: RouteContext<'/api/projects/[id]/video'>) {
  let tmpPath: string | null = null;
  let blobUrl: string | null = null;
  try {
    const { id } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const contentType = request.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (isJson && isBlobConfigured()) {
      const body = (await request.json().catch(() => ({}))) as { videoUrl?: string };
      if (!body.videoUrl) {
        return Response.json({ error: 'Please upload a video file' }, { status: 400 });
      }
      blobUrl = body.videoUrl;
      const fileName = tmpFileNameFromBlob(blobUrl);
      tmpPath = tmpVideoPath(fileName);
      await downloadBlobToFile(blobUrl, tmpPath);
    } else {
      const form = await request.formData();
      const file = form.get('video');
      if (!(file instanceof File)) {
        return Response.json({ error: 'Please upload a video file' }, { status: 400 });
      }
      if (!file.type.startsWith('video/')) {
        return Response.json({ error: 'Only video files are allowed' }, { status: 400 });
      }
      tmpPath = tmpVideoPath(file.name);
      await pipeline(Readable.fromWeb(file.stream() as never) as never, createWriteStream(tmpPath));
    }

    const meta = readProject(id);
    if (meta.video) fs.rmSync(path.join(dir, meta.video), { force: true });

    const nextMeta = await buildVideoTheme(id, dir, tmpPath, {
      name: meta.name,
      description: meta.description,
      author: meta.author,
      version: meta.version,
    });

    return Response.json(nextMeta);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to replace video' }, { status: 500 });
  } finally {
    if (tmpPath) fs.rmSync(tmpPath, { force: true });
    if (blobUrl) await deleteBlob(blobUrl);
  }
}