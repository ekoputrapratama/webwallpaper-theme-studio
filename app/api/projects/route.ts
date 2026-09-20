import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_HTML_FILES, slugify, themeContent, type ThemeMeta } from '@/lib/themes';
import { createProjectFromDir, listProjects, scratchProjectDir, uniqueProjectId } from '@/lib/persist';
import { getRequestUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toSummary(p: ThemeMeta & { uid: string | null }) {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    author: p.author,
    version: p.version,
    thumbnail: p.thumbnail,
    entry: p.entry,
    video: p.video,
    preview: p.thumbnail ? `/p/${p.id}/${p.thumbnail}` : '',
    updatedAt: p.updatedAt,
  };
}

export async function GET() {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const projects = await listProjects(user.uid);
    return Response.json(projects.map(toSummary));
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to list projects' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    if (!name) return Response.json({ error: 'Project name is required' }, { status: 400 });

    const id = await uniqueProjectId(slugify(name));
    const dir = scratchProjectDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const meta: ThemeMeta = {
      id,
      type: 'html',
      name,
      description: String(body.description || '').trim(),
      author: String(body.author || '').trim(),
      version: String(body.version || '1.0').trim(),
      thumbnail: '',
      entry: 'index.html',
      video: null,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(dir, 'index.html'), DEFAULT_HTML_FILES['index.html']);
    fs.writeFileSync(path.join(dir, 'style.css'), DEFAULT_HTML_FILES['style.css']);
    fs.writeFileSync(path.join(dir, 'script.js'), DEFAULT_HTML_FILES['script.js']);
    fs.writeFileSync(path.join(dir, `${id}.theme`), themeContent(meta));
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(meta, null, 2) + '\n');

    await createProjectFromDir(id, user.uid, dir, meta);

    return Response.json(meta, { status: 201 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}