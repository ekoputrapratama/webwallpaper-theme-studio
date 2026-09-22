import { getRequestUser } from '@/lib/auth';
import { mimeFor } from '@/lib/mime';
import { readProjectFile } from '@/lib/persist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/p/[id]/[[...path]]'>) {
  try {
    const user = await getRequestUser();
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { id, path: segs } = await ctx.params;
    const rel = segs?.length ? segs.join('/') : 'index.html';
    const parts = rel.split('/');
    if (parts.some((p) => !p || p === '.' || p === '..')) {
      return new Response('Forbidden', { status: 403 });
    }

    const payload = await readProjectFile(id, rel);
    if (!payload) return new Response('Not found', { status: 404 });

    const headers: Record<string, string> = {
      'Content-Type': mimeFor(rel) || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': String(payload.size),
    };

    if (payload.kind === 'text') {
      return new Response(payload.content, { headers });
    }
    return new Response(payload.stream, { headers });
  } catch (err) {
    console.error(err);
    return new Response('Bad request', { status: 400 });
  }
}