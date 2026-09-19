import { getRequestUser } from '@/lib/auth';
import { projectExists, readProject, updateMeta, writeTextFile } from '@/lib/persist';
import { META_KEYS, themeContent, videoIndexHtml, type ThemeMeta } from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, ctx: RouteContext<'/api/projects/[id]/meta'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    if (!(await projectExists(id))) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const { st } = await readProject(id, user.uid);
    if (!st) return Response.json({ error: 'Project not found' }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Partial<Record<(typeof META_KEYS)[number], string>>;

    for (const key of META_KEYS) {
      if (body[key] !== undefined) (st as Record<string, unknown>)[key] = String(body[key]);
    }
    if (st.type === 'video') {
      if (!st.version) st.version = '1.0';
      if (!st.entry) st.entry = 'index.html';
      if (!st.thumbnail) st.thumbnail = 'preview.gif';
    }

    const meta: ThemeMeta = {
      ...st,
      updatedAt: new Date().toISOString(),
    };

    if (meta.type === 'video') {
      await writeTextFile(id, user.uid, 'index.html', videoIndexHtml(meta.name, meta.video || `${id}.mp4`));
    }
    await writeTextFile(id, user.uid, `${id}.theme`, themeContent(meta));
    await updateMeta(id, user.uid, meta);

    return Response.json(meta);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}