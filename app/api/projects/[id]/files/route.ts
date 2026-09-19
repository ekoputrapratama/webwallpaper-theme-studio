import { getRequestUser } from '@/lib/auth';
import { projectExists, readProject, updateMeta, writeTextFiles } from '@/lib/persist';
import { safeRel } from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/projects/[id]/files'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const { st, files } = await readProject(id, user.uid);
    if (!st) return Response.json({ error: 'Project not found' }, { status: 404 });
    return Response.json({ files });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}

export async function PUT(request: Request, ctx: RouteContext<'/api/projects/[id]/files'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    if (!(await projectExists(id))) return Response.json({ error: 'Project not found' }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { files?: Record<string, string> };
    const files = body.files;
    if (!files || typeof files !== 'object') {
      return Response.json({ error: 'Expected { files: {} }' }, { status: 400 });
    }

    for (const name of Object.keys(files)) {
      safeRel(name);
      if (name === 'project.json') {
        return Response.json({ error: 'project.json is reserved' }, { status: 400 });
      }
    }

    await writeTextFiles(id, user.uid, files);
    await updateMeta(id, user.uid, { updatedAt: new Date().toISOString() });
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}