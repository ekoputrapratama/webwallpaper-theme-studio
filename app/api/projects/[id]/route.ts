import { getRequestUser } from '@/lib/auth';
import { deleteProject, listProjectFiles, projectExists, readProject } from '@/lib/persist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/projects/[id]'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const { st } = await readProject(id, user.uid);
    if (!st) return Response.json({ error: 'Project not found' }, { status: 404 });

    const fileNames = await listProjectFiles(id, user.uid);
    return Response.json({ meta: st, files: fileNames });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/projects/[id]'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    if (!(await projectExists(id))) return Response.json({ error: 'Project not found' }, { status: 404 });
    await deleteProject(id, user.uid);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}