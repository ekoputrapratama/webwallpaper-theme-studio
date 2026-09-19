import fs from 'node:fs';
import path from 'node:path';
import { TEXT_EXTS, projectDir, readProject, safeRel, writeProject } from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return Response.json({ error: 'Project not found' }, { status: 404 });
}

export async function GET(_req: Request, ctx: RouteContext<'/api/projects/[id]/files'>) {
  try {
    const { id } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) return notFound();

    const files: Record<string, string> = {};
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (!fs.statSync(full).isFile()) continue;
      if (f === 'project.json') continue;
      if (!TEXT_EXTS.has(path.extname(f).toLowerCase())) continue;
      files[f] = fs.readFileSync(full, 'utf8');
    }
    return Response.json({ files });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}

export async function PUT(request: Request, ctx: RouteContext<'/api/projects/[id]/files'>) {
  try {
    const { id } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) return notFound();

    const body = (await request.json().catch(() => ({}))) as { files?: Record<string, string> };
    const files = body.files;
    if (!files || typeof files !== 'object') {
      return Response.json({ error: 'Expected { files: {} }' }, { status: 400 });
    }

    for (const [name, content] of Object.entries(files)) {
      const rel = safeRel(name);
      if (name === 'project.json') {
        return Response.json({ error: 'project.json is reserved' }, { status: 400 });
      }
      fs.writeFileSync(path.join(dir, rel), String(content));
    }

    const meta = readProject(id);
    meta.updatedAt = new Date().toISOString();
    writeProject(id, meta);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}