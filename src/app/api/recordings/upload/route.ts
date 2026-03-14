import { NextRequest, NextResponse } from 'next/server';
import { getRagieClient, toRagiePartition } from '@/lib/ragie';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { storageUrl, fileName, recordingId, userId, description } = body;

    if (!storageUrl || !fileName || !recordingId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: storageUrl, fileName, recordingId, userId' },
        { status: 400 }
      );
    }

    const client = getRagieClient();
    const partition = toRagiePartition(userId);

    // Use URL-based upload — no file body through Vercel, no 4.5 MB limit
    const result = await client.documents.create({
      url: storageUrl,
      name: fileName,
      metadata: {
        recordingId,
        userId,
        fileName,
        description: description || '',
        uploadedAt: new Date().toISOString(),
      },
      mode: { video: 'audio_video' },
      partition,
    });

    return NextResponse.json({
      ragieDocumentId: result.id,
      status: result.status,
    });
  } catch (error: unknown) {
    console.error('Upload error:', error);
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
