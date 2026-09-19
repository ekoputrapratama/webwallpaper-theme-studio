import { getRequestUser } from '@/lib/auth';
import { buildProjectZip, projectExists } from '@/lib/persist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/projects/[id]/export'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    if (!(await projectExists(id))) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const buf = await buildProjectZip(id, user.uid);

    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${id}.zip"`,
        'Content-Length': String(buf.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Export failed' }, { status: 500 });
  }
}