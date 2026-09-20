export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { isFirebaseAdminConfigured, adminStorageBucketName } from '@/lib/firebase-admin';
import { remoteEnabled } from '@/lib/persist';

export async function GET() {
  const onVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
  return Response.json({
    ok: true,
    storage: {
      mode: remoteEnabled() ? 'firestore+storage (durable)' : 'local /tmp (ephemeral)',
      onVercel,
      firebaseAdminConfigured: isFirebaseAdminConfigured(),
      storageBucketSet: Boolean(adminStorageBucketName()),
    },
  });
}