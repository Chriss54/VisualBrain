import { NextRequest, NextResponse } from 'next/server';
import { getRagieClient, toRagiePartition } from '@/lib/ragie';

// Ragie statuses that mean the document is queryable
const QUERYABLE_STATUSES = ['indexed', 'summary_indexed', 'keyword_indexed', 'ready'];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const partition = toRagiePartition(userId);
    const client = getRagieClient();

    // Use the Ragie SDK PageIterator to collect all docs in this partition
    const allDocs: Array<{ id: string; status: string; metadata: Record<string, unknown> }> = [];

    const pageIterator = await client.documents.list({ partition, pageSize: 100 });

    for await (const page of pageIterator) {
      // Each page is a ListDocumentsResponse with result.documents
      const docs = (page as { result?: { documents?: unknown[] } }).result?.documents ?? [];
      for (const d of docs) {
        const doc = d as { id: string; status: string; metadata?: Record<string, unknown> };
        allDocs.push({ id: doc.id, status: doc.status, metadata: doc.metadata ?? {} });
      }
    }

    console.log(`Sync: found ${allDocs.length} Ragie docs in partition ${partition}`);

    // Build a map: recordingId → { ragieDocumentId, ragieStatus, appStatus }
    const recordingMap: Record<string, { ragieDocumentId: string; ragieStatus: string; appStatus: string }> = {};

    for (const doc of allDocs) {
      const recordingId = doc.metadata?.recordingId as string | undefined;
      const ragieStatus = doc.status;
      const appStatus = QUERYABLE_STATUSES.includes(ragieStatus)
        ? 'ready'
        : ragieStatus === 'failed'
        ? 'error'
        : 'processing';

      if (recordingId) {
        const existing = recordingMap[recordingId];
        // Prefer the most-ready status if multiple docs share a recordingId
        if (!existing || appStatus === 'ready') {
          recordingMap[recordingId] = { ragieDocumentId: doc.id, ragieStatus, appStatus };
        }
      }
    }

    return NextResponse.json({ recordingMap, totalDocs: allDocs.length });
  } catch (error: unknown) {
    console.error('Sync error:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
