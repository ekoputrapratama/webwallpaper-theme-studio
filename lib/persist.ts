import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { PROJECTS_DIR, TEXT_EXTS, projectDir, safeRel, type ThemeMeta } from './themes';
import { isFirebaseStorageConfigured, storageDelete, storageList, storagePut, storageRead } from './storage';
import { getDb, isFirebaseAdminConfigured } from './firebase-admin';

export type StoredProject = ThemeMeta & { uid: string | null };

export type ProjectFilePayload =
  | { kind: 'text'; content: string; size: number }
  | { kind: 'stream'; stream: ReadableStream; size: number };

export function remoteEnabled(): boolean {
  return isFirebaseAdminConfigured() && isFirebaseStorageConfigured();
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function scratchProjectDir(id: string): string {
  return isRemote() ? path.join(os.tmpdir(), 'webwallpaper-studio-scratch', id) : projectDir(id);
}

const remote = remoteEnabled();

const onVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);

if (onVercel && !remote) {
  console.error(
    '[persist] DURABLE STORAGE IS OFF ON A VERCEL DEPLOYMENT. Projects are written to the ephemeral ' +
      '/tmp filesystem and WILL BE LOST between function invocations. Set on Vercel (Production + ' +
      'Preview): FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + ' +
      'FIREBASE_PRIVATE_KEY) and NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, then redeploy.'
  );
}

export function assertDurableStorage(): void {
  if (onVercel && !remote) {
    throw new Error(
      'Durable storage (Firestore + Storage) is not configured on this deployment. Set ' +
        'FIREBASE_SERVICE_ACCOUNT_JSON and NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET on Vercel, then redeploy.'
    );
  }
}

function projectPrefix(id: string): string {
  return `projects/${id}/`;
}

function blobKey(id: string, name: string): string {
  return `projects/${id}/${name}`;
}

function isRemote(): boolean {
  return remote;
}

function shapeMeta(id: string, d: Record<string, unknown>): ThemeMeta {
  return {
    id,
    type: d.type === 'video' ? 'video' : 'html',
    name: String(d.name || id),
    description: String(d.description || ''),
    author: String(d.author || ''),
    version: String(d.version || '1.0'),
    thumbnail: String(d.thumbnail || ''),
    entry: String(d.entry || 'index.html'),
    video: d.video ? String(d.video) : null,
    updatedAt: String(d.updatedAt || ''),
  };
}

async function readDoc(id: string): Promise<Record<string, unknown> | null> {
  if (!isRemote()) return null;
  const doc = await getDb().collection('projects').doc(id).get();
  if (!doc.exists) return null;
  return (doc.data() || {}) as Record<string, unknown>;
}

function filesFromDoc(d: Record<string, unknown>): Record<string, string> {
  const raw = d.files;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export async function projectExists(id: string): Promise<boolean> {
  if (isRemote()) {
    const doc = await getDb().collection('projects').doc(id).get();
    return doc.exists;
  }
  return fs.existsSync(projectDir(id));
}

export async function uniqueProjectId(slug: string): Promise<string> {
  let id = slug;
  let n = 2;
  while (await projectExists(id)) {
    id = `${slug}-${n}`;
    n += 1;
  }
  return id;
}

export async function listProjects(uid: string | null): Promise<StoredProject[]> {
  if (isRemote()) {
    const snap = await getDb()
      .collection('projects')
      .where('uid', '==', uid)
      .get();
    const out: StoredProject[] = [];
    for (const doc of snap.docs) {
      const d = (doc.data() || {}) as Record<string, unknown>;
      out.push({ ...shapeMeta(doc.id, d), uid: String(d.uid || '') });
    }
    out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return out;
  }

  const out: StoredProject[] = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    const pj = path.join(dir, 'project.json');
    if (!fs.existsSync(pj)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(pj, 'utf8')) as ThemeMeta;
      out.push({ ...meta, uid: null });
    } catch (err) {
      console.warn('Skipping unreadable project', entry, err);
    }
  }
  out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return out;
}

export async function readProject(
  id: string,
  uid: string | null
): Promise<{ st: StoredProject | null; files: Record<string, string> }> {
  assertDurableStorage();

  if (isRemote()) {
    const d = await readDoc(id);
    if (!d) return { st: null, files: {} };
    if (uid && String(d.uid || '') !== uid) return { st: null, files: {} };
    return {
      st: { ...shapeMeta(id, d), uid: String(d.uid || '') },
      files: filesFromDoc(d),
    };
  }

  const dir = projectDir(id);
  if (!fs.existsSync(path.join(dir, 'project.json'))) return { st: null, files: {} };
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) as ThemeMeta;
  const files: Record<string, string> = {};
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    if (f === 'project.json') continue;
    if (!TEXT_EXTS.has(path.extname(f).toLowerCase())) continue;
    files[f] = fs.readFileSync(full, 'utf8');
  }
  return { st: { ...meta, uid: null }, files };
}

export async function listProjectFiles(id: string, uid: string | null): Promise<string[]> {
  if (isRemote()) {
    const d = await readDoc(id);
    if (!d || (uid && String(d.uid || '') !== uid)) return [];
    const names = new Set<string>(Object.keys(filesFromDoc(d)));
    const objects = await storageList(projectPrefix(id));
    for (const b of objects) {
      const name = b.pathname.slice(projectPrefix(id).length);
      if (name) names.add(name);
    }
    return Array.from(names).sort();
  }

  const { st } = await readProject(id, uid);
  if (!st) return [];
  const dir = projectDir(id);
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .filter((f) => f !== 'project.json')
    .sort();
}

export async function writeProject(
  id: string,
  uid: string | null,
  meta: ThemeMeta
): Promise<void> {
  assertDurableStorage();
  if (isRemote()) {
    const d = await readDoc(id);
    const files = d ? filesFromDoc(d) : {};
    const patch: Record<string, unknown> = { uid, ...meta, files };
    await getDb().collection('projects').doc(id).set(patch, { merge: true });
    return;
  }
  fs.writeFileSync(path.join(projectDir(id), 'project.json'), JSON.stringify(meta, null, 2) + '\n');
}

export async function createProjectFromDir(
  id: string,
  uid: string | null,
  dir: string,
  meta: ThemeMeta
): Promise<void> {
  assertDurableStorage();
  if (!isRemote()) return;

  const files: Record<string, string> = {};
  const blobs: { name: string; data: Buffer }[] = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    if (f === 'project.json') continue;
    const ext = path.extname(f).toLowerCase();
    if (TEXT_EXTS.has(ext)) {
      files[f] = fs.readFileSync(full, 'utf8');
    } else {
      blobs.push({ name: f, data: fs.readFileSync(full) });
    }
  }
  for (const b of blobs) {
    await storagePut(blobKey(id, b.name), b.data);
  }
  await getDb().collection('projects').doc(id).set({ uid, ...meta, files });
}

export async function hydrateProjectDir(id: string, dir: string): Promise<void> {
  if (!isRemote()) return;
  const d = await readDoc(id);
  if (!d) throw new Error('Project not found');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(filesFromDoc(d))) {
    fs.writeFileSync(path.join(dir, safeRel(name)), content);
  }
  const objects = await storageList(projectPrefix(id));
  for (const b of objects) {
    const name = b.pathname.slice(projectPrefix(id).length);
    if (!name) continue;
    const got = await storageRead(b.pathname);
    if (!got) continue;
    const tmp = `${path.join(dir, name)}.part`;
    await pipeline(got.stream, createWriteStream(tmp));
    fs.renameSync(tmp, path.join(dir, name));
  }
}

export async function updateMeta(
  id: string,
  uid: string | null,
  patch: Partial<ThemeMeta>
): Promise<void> {
  if (isRemote()) {
    const d = await readDoc(id);
    if (!d || (uid && String(d.uid || '') !== uid)) throw new Error('Project not found');
    const meta = { ...shapeMeta(id, d), ...patch, updatedAt: new Date().toISOString() };
    await getDb().collection('projects').doc(id).update(meta);
    return;
  }
  const dir = projectDir(id);
  const pj = path.join(dir, 'project.json');
  if (!fs.existsSync(pj)) throw new Error('Project not found');
  const meta = { ...(JSON.parse(fs.readFileSync(pj, 'utf8')) as ThemeMeta), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(pj, JSON.stringify(meta, null, 2) + '\n');
}

export async function writeTextFiles(
  id: string,
  uid: string | null,
  files: Record<string, string>
): Promise<void> {
  if (isRemote()) {
    const d = await readDoc(id);
    if (!d || (uid && String(d.uid || '') !== uid)) throw new Error('Project not found');
    const merged = { ...filesFromDoc(d), ...files };
    await getDb().collection('projects').doc(id).set({ files: merged }, { merge: true });
    return;
  }
  const dir = projectDir(id);
  if (!fs.existsSync(dir)) throw new Error('Project not found');
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, safeRel(name)), content);
  }
}

export async function writeTextFile(
  id: string,
  uid: string | null,
  name: string,
  content: string
): Promise<void> {
  await writeTextFiles(id, uid, { [name]: content });
}

export async function deleteProjectFile(
  id: string,
  uid: string | null,
  name: string
): Promise<void> {
  if (isRemote()) {
    const d = await readDoc(id);
    if (!d || (uid && String(d.uid || '') !== uid)) throw new Error('Project not found');
    const files = filesFromDoc(d);
    if (name in files) {
      delete files[name];
      await getDb().collection('projects').doc(id).set({ files }, { merge: true });
      return;
    }
    await storageDelete(blobKey(id, name));
    return;
  }
  const full = path.join(projectDir(id), safeRel(name));
  if (!fs.existsSync(full)) throw new Error('File not found');
  fs.rmSync(full);
}

export async function deleteProject(id: string, uid: string | null): Promise<void> {
  if (isRemote()) {
    const d = await readDoc(id);
    if (!d || (uid && String(d.uid || '') !== uid)) throw new Error('Project not found');
    const objects = await storageList(projectPrefix(id));
    for (const b of objects) {
      await storageDelete(b.pathname);
    }
    await getDb().collection('projects').doc(id).delete();
    return;
  }
  const dir = projectDir(id);
  if (!fs.existsSync(dir)) throw new Error('Project not found');
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function readProjectFile(
  id: string,
  rel: string
): Promise<ProjectFilePayload | null> {
  const name = safeRel(rel);

  if (isRemote()) {
    const d = await readDoc(id);
    if (!d) return null;
    const files = filesFromDoc(d);
    if (name in files) {
      const content = files[name];
      return { kind: 'text', content, size: Buffer.byteLength(content, 'utf8') };
    }
    const got = await storageRead(blobKey(id, name));
    if (!got) return null;
    return {
      kind: 'stream',
      stream: Readable.toWeb(got.stream) as ReadableStream,
      size: got.size,
    };
  }

  const full = path.join(projectDir(id), name);
  if (!fs.existsSync(full)) return null;
  const st = fs.statSync(full);
  const ext = path.extname(full).toLowerCase();
  if (TEXT_EXTS.has(ext)) {
    const content = fs.readFileSync(full, 'utf8');
    return { kind: 'text', content, size: Buffer.byteLength(content, 'utf8') };
  }
  return { kind: 'stream', stream: Readable.toWeb(createReadStream(full)) as ReadableStream, size: st.size };
}

export async function buildProjectZip(id: string, uid: string | null): Promise<Buffer> {
  const zip = new JSZip();

  if (isRemote()) {
    const d = await readDoc(id);
    if (!d || (uid && String(d.uid || '') !== uid)) throw new Error('Project not found');
    zip.file('project.json', JSON.stringify(shapeMeta(id, d), null, 2) + '\n');
    for (const [name, content] of Object.entries(filesFromDoc(d))) {
      zip.file(name, content);
    }
    const objects = await storageList(projectPrefix(id));
    for (const b of objects) {
      const name = b.pathname.slice(projectPrefix(id).length);
      if (!name) continue;
      const got = await storageRead(b.pathname);
      if (!got) continue;
      zip.file(name, new Uint8Array(await streamToBuffer(got.stream)));
    }
  } else {
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) throw new Error('Project not found');
    const pj = path.join(dir, 'project.json');
    if (fs.existsSync(pj)) zip.file('project.json', fs.readFileSync(pj));
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
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}