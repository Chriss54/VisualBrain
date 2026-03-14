import { NextRequest, NextResponse } from 'next/server';
import { toRagiePartition } from '@/lib/ragie';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const ragieDocId = searchParams.get('ragieDocId');

    if (!ragieDocId) {
      return NextResponse.json({ error: 'Missing ragieDocId' }, { status: 400 });
    }

    const apiKey = process.env.RAGIE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'RAGIE_API_KEY not configured' }, { status: 500 });
    }

    // Use Ragie REST API directly — same as upload route
    const ragieResponse = await fetch(`https://api.ragie.ai/documents/${ragieDocId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!ragieResponse.ok) {
      const errText = await ragieResponse.text();
      console.error('Ragie status check error:', errText);
      return NextResponse.json({ error: `Ragie error: ${ragieResponse.status}` }, { status: 500 });
    }

    const doc = await ragieResponse.json();

    // Ragie processes through: pending → partitioning → partitioned → refined →
    // chunked → indexed → summary_indexed → keyword_indexed → ready → failed
    // Documents are queryable from "indexed" onwards — treat all of these as ready
    const queryableStatuses = ['indexed', 'summary_indexed', 'keyword_indexed', 'ready'];

    let status = 'processing';
    if (queryableStatuses.includes(doc.status)) {
      status = 'ready';
    } else if (doc.status === 'failed') {
      status = 'error';
    }

    return NextResponse.json({
      recordingId: id,
      ragieDocumentId: ragieDocId,
      status,
      ragieStatus: doc.status,
    });
  } catch (error: unknown) {
    console.error('Status check error:', error);
    const message = error instanceof Error ? error.message : 'Status check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
