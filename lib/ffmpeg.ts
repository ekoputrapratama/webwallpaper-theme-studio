import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let cached: string | undefined;

const exeName = () => (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

function staticPaths(): string[] {
  return [
    // Derived from cwd so it survives Next.js bundling (bundlers rewrite
    // `__dirname`/`require` and would otherwise point at a missing binary).
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', exeName()),
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'bin', exeName()),
  ];
}

function envPaths(): string[] {
  const p = process.env.FFMPEG_PATH;
  return p && p.trim() ? [p.trim()] : [];
}

function systemPath(): string | undefined {
  const dirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, exeName());
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}

function firstExisting(paths: string[]): string | undefined {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

function runInstaller(): boolean {
  // ffmpeg-static ships an installer that downloads the right binary for this
  // platform. If npm blocked its install script (allowScripts / ignore-scripts)
  // during `npm install`, the binary is missing — run it here once.
  const installJs = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'install.js');
  if (!existsSync(installJs)) return false;
  const res = spawnSync(process.execPath, [installJs], { timeout: 300_000 });
  return res.status === 0;
}

export function resolveFfmpeg(): string {
  if (cached) return cached;

  const found = firstExisting([...staticPaths(), ...envPaths()]);
  if (found) {
    cached = found;
    return cached;
  }

  if (runInstaller()) {
    const installed = firstExisting([...staticPaths()]);
    if (installed) {
      cached = installed;
      return cached;
    }
  }

  const sys = systemPath();
  if (sys) {
    cached = sys;
    return cached;
  }

  throw new Error(
    'ffmpeg is not available. Install it so `npm install` can fetch the bundled binary ' +
      '(enable install scripts, or set `allowScripts` in .npmrc), set the FFMPEG_PATH env var, ' +
      'or install ffmpeg on the system PATH.'
  );
}