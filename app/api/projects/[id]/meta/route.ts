import fs from 'node:fs';
import path from 'node:path';
import {
  META_KEYS,
  projectDir,
  readProject,
  writeProject,
  writeThemeFile,
  videoIndexHtml,
} from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, ctx: RouteContext<'/api/projects/[id]/meta'>) {
  try {
    const { id } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const meta = readProject(id);
    const body = (await request.json().catch(() => ({}))) as Partial<Record<(typeof META_KEYS)[number], string>>;

    for (const key of META_KEYS) {
      if (body[key] !== undefined) (meta as Record<string, unknown>)[key] = String(body[key]);
    }
    if (meta.type === 'video') {
      if (!meta.version) meta.version = '1.0';
      if (!meta.entry) meta.entry = 'index.html';
      if (!meta.thumbnail) meta.thumbnail = 'preview.gif';
    }
    meta.updatedAt = new Date().toISOString();
    writeProject(id, meta);

    if (meta.type === 'video' && meta.name) {
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        videoIndexHtml(meta.name, meta.video || `${id}.mp4`)
      );
    }
    writeThemeFile(id, meta);
    return Response.json(meta);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}