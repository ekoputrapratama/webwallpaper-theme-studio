import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { projectDir } from '@/lib/themes';

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
    const { id, path: segs } = await ctx.params;
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) {
      return new Response('Project not found', { status: 404 });
    }

    const rel = segs?.length ? segs.join('/') : 'index.html';
    const parts = rel.split('/');
    if (parts.some((p) => !p || p === '.' || p === '..')) {
      return new Response('Forbidden', { status: 403 });
    }

    let full = path.join(dir, rel);
    if (!fs.existsSync(full)) {
      return new Response('Not found', { status: 404 });
    }
    if (fs.statSync(full).isDirectory()) {
      full = path.join(full, 'index.html');
      if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
    }

    const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    const size = fs.statSync(full).size;
    const stream = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream;

    return new Response(stream, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error(err);
    return new Response('Bad request', { status: 400 });
  }
}