import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadPresignedBody;

  try {
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname, clientPayload) => {
        const payload =
          typeof clientPayload === 'string' && clientPayload
            ? (JSON.parse(clientPayload) as { projectId?: string; replace?: boolean })
            : null;

        if (payload?.replace && !payload.projectId) {
          throw new Error('A project id is required to replace a video');
        }

        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          allowedContentTypes: ['video/*'],
          validUntil: Date.now() + 60 * 60 * 1000,
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: ['video/*'],
            validUntil: Date.now() + 10 * 60 * 1000,
            addRandomSuffix: false,
            allowOverwrite: false,
            tokenPayload: JSON.stringify({ projectId: payload?.projectId ?? null }),
          },
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('[uploads/video] client upload completed', blob.pathname);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}