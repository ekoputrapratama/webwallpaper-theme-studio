import { getRequestUser } from '@/lib/auth';
import { deleteProjectFile, projectExists } from '@/lib/persist';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, ctx: RouteContext<'/api/projects/[id]/files/[name]'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, name } = await ctx.params;
    if (!(await projectExists(id))) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    if (name === 'index.html') {
      return Response.json({ error: 'index.html cannot be deleted' }, { status: 400 });
    }
    await deleteProjectFile(id, user.uid, name);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    if (err instanceof Error && err.message === 'File not found') {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}