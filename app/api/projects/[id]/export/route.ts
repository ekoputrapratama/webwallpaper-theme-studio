import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { projectDir } from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/projects/[id]/export'>) {
  try {
    const { id } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const zip = new JSZip();
    const walk = (rel: string) => {
      const abs = path.join(dir, rel);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        for (const child of fs.readdirSync(abs)) walk(rel ? path.join(rel, child) : child);
      } else if (st.isFile() && rel !== 'project.json') {
        zip.file(rel, fs.readFileSync(abs));
      }
    };
    walk('');

    const buf = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

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