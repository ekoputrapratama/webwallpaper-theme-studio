import { getRequestUser } from '@/lib/auth';
import { ASSET_EXTS } from '@/lib/mime';
import { readProject, updateMeta, writeProjectBlob } from '@/lib/persist';
import { safeRel } from '@/lib/themes';

export const runtime = 'nodejs';

export const MAX_ASSET_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request, ctx: RouteContext<'/api/projects/[id]/files/upload'>) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;
    const { st, files } = await readProject(id, user.uid);
    if (!st) return Response.json({ error: 'Project not found' }, { status: 404 });
    if (st.type !== 'html') {
      return Response.json(
        { error: 'File uploads (images, JS, CSS) are only available for HTML projects.' },
        { status: 400 }
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });

    const entries = form.getAll('files') as File[];
    if (!entries.length) return Response.json({ error: 'No files provided (field "files")' }, { status: 400 });

    const textFiles = new Set(Object.keys(files));

    const ops: { name: string; data: Buffer }[] = [];
    for (const file of entries) {
      if (!(file instanceof File)) continue;
      let name = String(file.name || '').replace(/\\/g, '/').split('/').pop() || '';
      name = name.trim();
      if (!name) {
        return Response.json({ error: 'A file had no name' }, { status: 400 });
      }
      try {
        safeRel(name);
      } catch {
        return Response.json({ error: `Invalid file name: ${name}` }, { status: 400 });
      }
      if (name === 'project.json' || name === 'index.html') {
        return Response.json({ error: `${name} is reserved` }, { status: 400 });
      }
      if (textFiles.has(name)) {
        return Response.json(
          { error: `${name} is already an editable file — edit it directly instead of uploading a copy.` },
          { status: 400 }
        );
      }
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (!ASSET_EXTS.has(ext)) {
        return Response.json(
          { error: `Unsupported file type (.${(ext || '?').slice(1)}). Upload images, JS, CSS, fonts, audio, or other web assets.` },
          { status: 400 }
        );
      }
      if (file.size > MAX_ASSET_BYTES) {
        return Response.json(
          { error: `${name} (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the ${MAX_ASSET_BYTES / (1024 * 1024)} MB upload limit.` },
          { status: 413 }
        );
      }
      ops.push({ name, data: Buffer.from(await file.arrayBuffer()) });
    }

    for (const op of ops) {
      await writeProjectBlob(id, user.uid, op.name, op.data);
    }
    await updateMeta(id, user.uid, { updatedAt: new Date().toISOString() });

    return Response.json({ uploaded: ops.map((o) => o.name) });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 });
  }
}