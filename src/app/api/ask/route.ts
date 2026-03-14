import { NextRequest, NextResponse } from 'next/server';
import { queryRagie, toRagiePartition } from '@/lib/ragie';
import { generateAnswer, ChunkSource } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, userId, recordingsMap } = body;

    if (!question || !userId) {
      return NextResponse.json(
        { error: 'Missing question or userId' },
        { status: 400 }
      );
    }

    // Retrieve relevant chunks from Ragie
    const partition = toRagiePartition(userId);
    const retrievalResult = await queryRagie(question, partition, 8);

    if (!retrievalResult.scoredChunks || retrievalResult.scoredChunks.length === 0) {
      return NextResponse.json({
        answer: "I couldn't find any relevant information in your recordings. Make sure you have uploaded and processed at least one video recording.",
        sources: [],
      });
    }

    // Map chunks for Gemini
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: ChunkSource[] = retrievalResult.scoredChunks.map((chunk: any) => ({
      documentId: chunk.documentId || '',
      documentName:
        (chunk.documentMetadata?.fileName as string) ||
        (chunk.documentMetadata?.document_name as string) ||
        (chunk.documentMetadata?.name as string) ||
        chunk.documentName ||
        'Unknown Recording',
      text: chunk.text,
      score: chunk.score,
      metadata: chunk.documentMetadata as Record<string, unknown> || {},
    }));

    // Build display name map for Gemini (smart titles instead of UUID filenames)
    const recMap = (recordingsMap || {}) as Record<string, { title?: string; storageUrl?: string; thumbnailUrl?: string }>;
    const sourceDisplayNames: Record<string, string> = {};
    for (const chunk of chunks) {
      const match = recMap[chunk.documentId] || recMap[`fn:${chunk.documentName}`];
      if (match?.title) {
        sourceDisplayNames[chunk.documentId] = match.title;
        sourceDisplayNames[`fn:${chunk.documentName}`] = match.title;
      }
    }

    // Generate answer with Gemini (passing smart titles for clean source references)
    const answer = await generateAnswer(question, chunks, sourceDisplayNames);

    // Build source references for the frontend
    const sources = chunks.map((chunk) => ({
      documentName: chunk.documentName,
      documentId: chunk.documentId,
      timestamp: (chunk.metadata?.timestamp as string) || '',
      score: chunk.score,
      text: chunk.text.slice(0, 500), // Truncate for frontend
    }));

    // Deduplicate sources by documentId
    const uniqueSources = sources.filter(
      (src, i, arr) => arr.findIndex((s) => s.documentId === src.documentId) === i
    );

    // Enrich sources with recording data from the already-built recMap

    const enrichedSources = uniqueSources.map((src) => {
      // Try matching by ragieDocumentId first, then by fileName
      const match = recMap[src.documentId] || recMap[`fn:${src.documentName}`];
      return {
        ...src,
        title: match?.title || src.documentName,
        storageUrl: match?.storageUrl || null,
        thumbnailUrl: match?.thumbnailUrl || null,
        timestampSeconds: parseTimestamp(src.timestamp),
      };
    });

    return NextResponse.json({
      answer,
      sources: enrichedSources,
    });
  } catch (error: unknown) {
    console.error('Ask error full details:', error);
    // Extract as much detail as possible for debugging
    let message = 'Failed to process question';
    if (error instanceof Error) {
      message = error.message;
      if ((error as { status?: number }).status) {
        message += ` (status: ${(error as { status?: number }).status})`;
      }
    } else if (typeof error === 'object' && error !== null) {
      message = JSON.stringify(error);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Parse a timestamp string (e.g., "14:32", "1:23:45", "872s") into seconds.
 * Returns null if unparseable.
 */
function parseTimestamp(ts: string | undefined | null): number | null {
  if (!ts) return null;
  const trimmed = ts.trim();

  // Format: "123s" or "123.4s"
  const secsMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/);
  if (secsMatch) return Math.round(Number(secsMatch[1]));

  // Format: "MM:SS" or "H:MM:SS"
  const parts = trimmed.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];

  // Try plain number (seconds)
  const num = Number(trimmed);
  if (!isNaN(num)) return Math.round(num);

  return null;
}

