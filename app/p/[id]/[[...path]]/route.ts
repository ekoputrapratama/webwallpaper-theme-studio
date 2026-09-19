import path from 'node:path';
import { getRequestUser } from '@/lib/auth';
import { readProjectFile } from '@/lib/persist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.md': 'text/plain',
  '.theme': 'text/plain',
  '.glsl': 'text/plain',
  '.vert': 'text/plain',
  '.frag': 'text/plain',
  '.vs': 'text/plain',
  '.fs': 'text/plain',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
};

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
      'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream',
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