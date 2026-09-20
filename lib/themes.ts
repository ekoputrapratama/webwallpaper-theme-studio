import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpeg } from './ffmpeg';

const execFileP = promisify(execFile);

export const PROJECTS_DIR = process.env.WWC_PROJECTS
  ? path.resolve(process.env.WWC_PROJECTS)
  : path.join(os.tmpdir(), 'webwallpaper-studio-projects');

const UPLOADS_DIR = path.join(os.tmpdir(), 'webwallpaper-studio-uploads');
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const META_KEYS = ['name', 'description', 'author', 'version', 'thumbnail', 'entry'];

export const VIDEO_EXTS: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mkv': 'video/x-matroska',
};

export const TEXT_EXTS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt',
  '.theme', '.glsl', '.vert', '.frag', '.vs', '.fs', '.xml', '.md', '.ts',
]);

export type ThemeMeta = {
  id: string;
  type: 'html' | 'video';
  name: string;
  description: string;
  author: string;
  version: string;
  thumbnail: string;
  entry: string;
  video: string | null;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  type: 'html' | 'video';
  name: string;
  description: string;
  author: string;
  version: string;
  thumbnail: string;
  entry: string;
  video: string | null;
  preview: string;
  updatedAt: string;
};

/* ------------------------------- helpers ------------------------------- */

export function slugify(name: string): string {
  const s = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'theme';
}

export function uniqueId(slug: string): string {
  let id = slug;
  let n = 2;
  while (fs.existsSync(path.join(PROJECTS_DIR, id))) {
    id = `${slug}-${n}`;
    n += 1;
  }
  return id;
}

export function projectDir(id: string): string {
  if (!ID_RE.test(id)) throw new Error('Invalid project id');
  return path.join(PROJECTS_DIR, id);
}

export function escHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function safeRel(name: string): string {
  const n = String(name || '').replace(/\\/g, '/');
  if (!n || n.startsWith('/') || n.includes('..') || n.includes('\0')) {
    throw new Error('Invalid file name');
  }
  return n;
}

export function readProject(id: string): ThemeMeta {
  const dir = projectDir(id);
  const raw = fs.readFileSync(path.join(dir, 'project.json'), 'utf8');
  return JSON.parse(raw);
}

export function writeProject(id: string, meta: ThemeMeta): void {
  const dir = projectDir(id);
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(meta, null, 2) + '\n');
}

export function themeContent(meta: Pick<ThemeMeta, 'name' | 'description' | 'author' | 'version' | 'thumbnail' | 'entry'>): string {
  const lines = ['[Theme]'];
  lines.push(`name=${meta.name || 'Untitled Theme'}`);
  if (meta.description) lines.push(`description=${meta.description}`);
  if (meta.author) lines.push(`author=${meta.author}`);
  if (meta.version) lines.push(`version=${meta.version}`);
  lines.push(`thumbnail=${meta.thumbnail || ''}`);
  lines.push(`entry=${meta.entry || 'index.html'}`);
  return lines.join('\n') + '\n';
}

export function writeThemeFile(id: string, meta: ThemeMeta): string {
  const dir = projectDir(id);
  const tfile = `${id}.theme`;
  fs.writeFileSync(path.join(dir, tfile), themeContent(meta));
  return tfile;
}

/* ------------------------------ templates ------------------------------ */

export function defaultThumbSvg(name: string): string {
  const safe = escHtml(name || 'Untitled Theme');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="0.5" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="320" height="180" fill="url(#g)"/>
  <circle cx="248" cy="56" r="42" fill="#ffffff22"/>
  <circle cx="84" cy="146" r="36" fill="#ffffff22"/>
  <rect x="40" y="96" width="16" height="3" rx="1.5" fill="#ffffff66"/>
  <rect x="64" y="104" width="8" height="3" rx="1.5" fill="#ffffff44"/>
  <text x="160" y="80" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="#ffffff">${safe}</text>
  <text x="160" y="104" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#ffffffcc">WebWallpaper Theme</text>
</svg>
`;
}

export const DEFAULT_HTML_FILES: Record<string, string> = {
  'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="style.css">
</head>
<body>
<canvas id="canvas"></canvas>
<script src="script.js"></script>
</body>
</html>
`,
  'style.css': `html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
#canvas {
  display: block;
  width: 100vw;
  height: 100vh;
}
`,
  'script.js': `// WebWallpaper WebGL starter theme.
// Edit FRAG below - the live preview on the right updates as you type.

const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;padding:2em">WebGL is not supported on this device.</p>';
  throw new Error('WebGL not supported');
}

const FRAG = \`
precision highp float;

uniform vec2  u_resolution;
uniform float u_time;
uniform vec2  u_mouse;

vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;

  float t = u_time;
  float waves = sin(p.x * 3.0 + t) * cos(p.y * 4.0 - t * 0.7);
  float glow = length(p + vec2(0.0, 0.2)) + waves * 0.2;

  vec3 col = pal(glow * 0.8, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
  col += 0.06 * sin(uv.xyx * 40.0 + t * 4.0);

  gl_FragColor = vec4(col, 1.0);
}
\`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function resize() {
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);

function init() {
  canvas.width = window.innerWidth || 1;
  canvas.height = window.innerHeight || 1;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER,
    'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'
  ));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {
    u_resolution: gl.getUniformLocation(program, 'u_resolution'),
    u_time: gl.getUniformLocation(program, 'u_time'),
    u_mouse: gl.getUniformLocation(program, 'u_mouse'),
  };

  function frame(now) {
    gl.uniform2f(U.u_resolution, canvas.width, canvas.height);
    gl.uniform1f(U.u_time, now * 0.001);
    gl.uniform2f(U.u_mouse, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
init();
`,
};

export function videoIndexHtml(name: string, videoFile: string): string {
  const mime = VIDEO_EXTS[path.extname(videoFile).toLowerCase()] || 'video/mp4';
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escHtml(name)}</title>
    <style>
        body,
        html {
            margin: 0;
            padding: 0;
            overflow: hidden;
            background: #000;
        }
        .bg {
            width: 100vw;
            height: 100vh;
            object-fit: cover;
        }
    </style>
</head>
<body>
    <video class="bg" preload="auto" src="${escHtml(videoFile)}" autoplay loop muted playsinline>
        <source src="${escHtml(videoFile)}" type="${mime}"/>
    </video>
</body>
</html>
`;
}

/* -------------------------------- ffmpeg -------------------------------- */

async function run(args: string[]): Promise<void> {
  await execFileP(resolveFfmpeg(), args, { timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
}

async function makeGif(videoPath: string, gifPath: string): Promise<void> {
  const filter =
    'fps=10,scale=240:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=sierra2_4a';
  try {
    await run(['-y', '-i', videoPath, '-vf', filter, gifPath]);
  } catch (err) {
    console.warn('Palette GIF failed, retrying with basic conversion:', err);
    await run(['-y', '-i', videoPath, '-vf', 'fps=10,scale=240:-2', gifPath]);
  }
  if (!fs.existsSync(gifPath) || fs.statSync(gifPath).size < 10) {
    throw new Error('Failed to generate preview.gif from the video');
  }
}

/* ----------------------------- video themes ----------------------------- */

export async function buildVideoTheme(
  id: string,
  dir: string,
  videoPath: string,
  metadata: Pick<ThemeMeta, 'name' | 'description' | 'author' | 'version'>
): Promise<ThemeMeta> {
  const videoName = `${id}${path.extname(videoPath).toLowerCase()}`;
  const targetVideo = path.join(dir, videoName);
  fs.copyFileSync(videoPath, targetVideo);

  await makeGif(targetVideo, path.join(dir, 'preview.gif'));

  const meta: ThemeMeta = {
    id,
    type: 'video',
    name: metadata.name || id,
    description: metadata.description || '',
    author: metadata.author || '',
    version: metadata.version || '1.0',
    thumbnail: 'preview.gif',
    entry: 'index.html',
    video: videoName,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(dir, 'index.html'), videoIndexHtml(meta.name, videoName));
  fs.writeFileSync(
    path.join(dir, `${id}.theme`),
    themeContent({
      name: meta.name,
      description: meta.description,
      author: meta.author,
      version: meta.version,
      thumbnail: meta.thumbnail,
      entry: meta.entry,
    })
  );
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

/* ----------------------------- upload temp ------------------------------ */

export function tmpVideoPath(originalName: string): string {
  const ext = path.extname(originalName || '').toLowerCase() || '.mp4';
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  return path.join(UPLOADS_DIR, name);
}