import { NextRequest, NextResponse } from 'next/server';
import { toRagiePartition } from '@/lib/ragie';

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

    const apiKey = process.env.RAGIE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'RAGIE_API_KEY not configured' }, { status: 500 });
    }

    const partition = toRagiePartition(userId);

    // Use Ragie REST API directly — bypasses SDK TypeScript issues entirely
    // POST https://api.ragie.ai/documents/url
    const ragieResponse = await fetch('https://api.ragie.ai/documents/url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: storageUrl,
        name: fileName,
        partition,
        mode: { video: 'audio_video' },
        metadata: {
          recordingId,
          userId,
          fileName,
          description: description || '',
          uploadedAt: new Date().toISOString(),
        },
      }),
    });

    if (!ragieResponse.ok) {
      const errText = await ragieResponse.text();
      console.error('Ragie API error:', errText);
      return NextResponse.json(
        { error: `Ragie error: ${ragieResponse.status} ${errText}` },
        { status: 500 }
      );
    }

    const result = await ragieResponse.json();

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
