import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildVideoTheme, tmpVideoPath, videoIndexHtml } from '@/lib/themes';
import { downloadBlobToFile, isBlobConfigured, tmpFileNameFromBlob } from '@/lib/blob';
import {
  createProjectFromDir,
  hydrateProjectDir,
  readProject,
  remoteEnabled,
  scratchProjectDir,
  updateMeta,
  writeTextFile,
} from '@/lib/persist';
import { getRequestUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request, ctx: RouteContext<'/api/projects/[id]/video'>) {
  let tmpPath: string | null = null;
  let blobUrl: string | null = null;
  let dir: string | null = null;
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const { st } = await readProject(id, user.uid);
    if (!st) return Response.json({ error: 'Project not found' }, { status: 404 });

    dir = scratchProjectDir(id);
    fs.mkdirSync(dir, { recursive: true });
    await hydrateProjectDir(id, dir);

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

    if (st.video) fs.rmSync(path.join(/*turbopackIgnore: true*/ dir, st.video), { force: true });

    const nextMeta = await buildVideoTheme(id, dir, tmpPath, {
      name: st.name,
      description: st.description,
      author: st.author,
      version: st.version,
    });

    await createProjectFromDir(id, user.uid, dir, nextMeta);
    await writeTextFile(id, user.uid, 'index.html', videoIndexHtml(nextMeta.name, nextMeta.video || `${id}.mp4`));
    await updateMeta(id, user.uid, nextMeta);

    return Response.json(nextMeta);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to replace video' }, { status: 500 });
  } finally {
    if (tmpPath) fs.rmSync(tmpPath, { force: true });
    if (dir && remoteEnabled()) fs.rmSync(dir, { recursive: true, force: true });
  }
}