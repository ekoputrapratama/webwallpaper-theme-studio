import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readProject } from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return Response.json({ error: 'Project not found' }, { status: 404 });
}

export async function GET(_req: Request, ctx: RouteContext<'/api/projects/[id]'>) {
  try {
    const { id } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) return notFound();

    const meta = readProject(id);
    const files = fs
      .readdirSync(dir)
      .filter((f) => fs.statSync(path.join(dir, f)).isFile())
      .filter((f) => f !== 'project.json')
      .sort();

    return Response.json({ meta, files });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/projects/[id]'>) {
  try {
    const { id } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) return notFound();
    fs.rmSync(dir, { recursive: true, force: true });
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}