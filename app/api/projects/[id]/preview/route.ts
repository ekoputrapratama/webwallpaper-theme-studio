import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpeg } from '@/lib/ffmpeg';
import { readProject, updateMeta, writeProjectBlob } from '@/lib/persist';
import { getRequestUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileP = promisify(execFile);
const DATA_URL_PREFIX = 'data:image/png;base64,';
const MAX_FRAMES = 48;
const MAX_FRAME_BYTES = 600 * 1024;

async function run(args: string[]): Promise<void> {
  await execFileP(resolveFfmpeg(), args, { timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
}

export async function POST(request: Request, ctx: RouteContext<'/api/projects/[id]/preview'>) {
  let framesDir: string | null = null;
  try {
    const user = await getRequestUser();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await ctx.params;
    const { st } = await readProject(id, user.uid);
    if (!st) return Response.json({ error: 'Project not found' }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { frames?: unknown; fps?: unknown };
    const frames = Array.isArray(body.frames)
      ? body.frames.filter(
          (x): x is string => typeof x === 'string' && x.startsWith(DATA_URL_PREFIX)
        )
      : [];

    if (frames.length < 2) {
      return Response.json({ error: 'Not enough frames captured (need at least 2)' }, { status: 400 });
    }
    if (frames.length > MAX_FRAMES) {
      return Response.json({ error: `Too many frames (max ${MAX_FRAMES})` }, { status: 400 });
    }

    const fps = Math.min(30, Math.max(1, Math.round(Number(body.fps) || 8)));

    framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwcap-'));
    for (let i = 0; i < frames.length; i++) {
      const buf = Buffer.from(frames[i].slice(DATA_URL_PREFIX.length), 'base64');
      if (buf.length < 20 || buf.length > MAX_FRAME_BYTES) {
        return Response.json({ error: 'Invalid frame data' }, { status: 400 });
      }
      fs.writeFileSync(path.join(framesDir, `frame_${String(i).padStart(3, '0')}.png`), buf);
    }

    const inputPattern = path.join(framesDir, 'frame_%03d.png');
    const gifPath = path.join(framesDir, 'preview.gif');
    const palette: string =
      'scale=320:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=sierra2_4a';
    const basic: string = 'scale=320:-2';
    try {
      await run(['-y', '-framerate', String(fps), '-i', inputPattern, '-vf', palette, gifPath]);
    } catch (err) {
      console.warn('Palette GIF failed, retrying with basic conversion:', err);
      await run(['-y', '-framerate', String(fps), '-i', inputPattern, '-vf', basic, gifPath]);
    }

    const gif = fs.readFileSync(gifPath);
    if (gif.length < 20) throw new Error('Failed to generate preview.gif');

    await writeProjectBlob(id, user.uid, 'preview.gif', gif);
    await updateMeta(id, user.uid, { thumbnail: 'preview.gif' });

    return Response.json({ ok: true, thumbnail: 'preview.gif', bytes: gif.length, frames: frames.length });
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to generate preview.gif' },
      { status: 500 }
    );
  } finally {
    if (framesDir) fs.rmSync(framesDir, { recursive: true, force: true });
  }
}