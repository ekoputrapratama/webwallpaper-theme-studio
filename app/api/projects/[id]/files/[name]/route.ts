import fs from 'node:fs';
import path from 'node:path';
import { projectDir, safeRel } from '@/lib/themes';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, ctx: RouteContext<'/api/projects/[id]/files/[name]'>) {
  try {
    const { id, name } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    if (name === 'index.html') {
      return Response.json({ error: 'index.html cannot be deleted' }, { status: 400 });
    }
    const full = path.join(dir, safeRel(name));
    if (!fs.existsSync(full)) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    fs.rmSync(full);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}