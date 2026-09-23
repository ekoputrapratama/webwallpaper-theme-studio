import { getRequestUser } from '@/lib/auth';
import { buildProjectZip, readProject, readProjectBlob, remoteEnabled, updateMeta } from '@/lib/persist';
import { publishTheme, WEBKIT_FIRESTORE_DB } from '@/lib/publish';
import { getFirestore } from 'firebase-admin/firestore';
import { getAdminApp } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getRequestUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return Response.json({ error: 'Project id is required' }, { status: 400 });

    const { st } = await readProject(id, user.uid);
    if (!st) return Response.json({ error: 'Project not found' }, { status: 404 });
    if (!st.publishedThemeId) {
      return Response.json({ publishedThemeId: null });
    }

    const doc = await getFirestore(getAdminApp(), WEBKIT_FIRESTORE_DB)
      .collection('wallpapers')
      .doc(st.publishedThemeId)
      .get();
    if (!doc.exists) return Response.json({ publishedThemeId: null });
    const d = doc.data() || {};
    return Response.json({
      publishedThemeId: st.publishedThemeId,
      tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t)) : [],
      donation_url: String(d.donation_url || ''),
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Failed to load published theme' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.uid === 'local' || !remoteEnabled()) {
      return Response.json(
        {
          error:
            'Publishing requires a signed-in Firebase user and Firebase Admin + Storage configured on the server (FIREBASE_SERVICE_ACCOUNT_JSON + NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).',
        },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      tags?: unknown;
      donation_url?: unknown;
    };
    if (!body.id) {
      return Response.json({ error: 'Project id is required' }, { status: 400 });
    }

    const tags = Array.isArray(body.tags)
      ? body.tags.map((t) => String(t).trim()).filter(Boolean)
      : typeof body.tags === 'string'
        ? body.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    const { st } = await readProject(body.id, user.uid);
    if (!st) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const [zip, thumbnail] = await Promise.all([
      buildProjectZip(body.id, user.uid),
      readProjectBlob(body.id, 'preview.gif'),
    ]);
    if (!thumbnail) {
      return Response.json(
        { error: 'This project has no preview.gif to publish. Regenerate the preview first.' },
        { status: 400 }
      );
    }

    const result = await publishTheme({
      uid: user.uid,
      meta: st,
      tags,
      donationUrl: String(body.donation_url || '').trim(),
      zip,
      thumbnail,
      themeId: st.publishedThemeId ?? null,
    });

    if (st.publishedThemeId !== result.id) {
      await updateMeta(body.id, user.uid, { publishedThemeId: result.id });
    }

    return Response.json({ ok: true, ...result, siteUrl: 'https://webkit-wallpaper.web.app' });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : 'Publish failed' }, { status: 500 });
  }
}