import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECTS_DIR,
  DEFAULT_HTML_FILES,
  defaultThumbSvg,
  slugify,
  uniqueId,
  writeProject,
  writeThemeFile,
  type ThemeMeta,
  type ProjectSummary,
} from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function metaToSummary(entry: string, meta: ThemeMeta): ProjectSummary {
  const st = fs.statSync(path.join(PROJECTS_DIR, entry));
  return {
    id: meta.id || entry,
    type: meta.type || 'html',
    name: meta.name || entry,
    description: meta.description || '',
    author: meta.author || '',
    version: meta.version || '1.0',
    thumbnail: meta.thumbnail || '',
    entry: meta.entry || 'index.html',
    video: meta.video || null,
    preview: meta.thumbnail ? `/p/${entry}/${meta.thumbnail}` : '',
    updatedAt: meta.updatedAt || st.mtime.toISOString(),
  };
}

export async function GET() {
  const out: ProjectSummary[] = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    const pj = path.join(dir, 'project.json');
    if (!fs.existsSync(pj)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(pj, 'utf8')) as ThemeMeta;
      out.push(metaToSummary(entry, meta));
    } catch (err) {
      console.warn('Skipping unreadable project', entry, err);
    }
  }
  out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return Response.json(out);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return Response.json({ error: 'Project name is required' }, { status: 400 });

    const id = uniqueId(slugify(name));
    const dir = path.join(PROJECTS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });

    const meta: ThemeMeta = {
      id,
      type: 'html',
      name,
      description: String(body.description || '').trim(),
      author: String(body.author || '').trim(),
      version: String(body.version || '1.0').trim(),
      thumbnail: 'thumbnail.svg',
      entry: 'index.html',
      video: null,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(dir, 'index.html'), DEFAULT_HTML_FILES['index.html']);
    fs.writeFileSync(path.join(dir, 'style.css'), DEFAULT_HTML_FILES['style.css']);
    fs.writeFileSync(path.join(dir, 'script.js'), DEFAULT_HTML_FILES['script.js']);
    fs.writeFileSync(path.join(dir, 'thumbnail.svg'), defaultThumbSvg(meta.name));
    writeProject(id, meta);
    writeThemeFile(id, meta);

    return Response.json(meta, { status: 201 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}