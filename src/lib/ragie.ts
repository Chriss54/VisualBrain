import { Ragie } from 'ragie';

/**
 * Converts a Firebase UID (which may contain uppercase letters) into a
 * Ragie-compatible partition name. Ragie only allows [a-z0-9_-].
 */
export function toRagiePartition(userId: string): string {
  return `user_${userId.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
}

let ragieClient: Ragie | null = null;

export function getRagieClient(): Ragie {
  if (!ragieClient) {
    const apiKey = process.env.RAGIE_API_KEY;
    if (!apiKey) {
      throw new Error('RAGIE_API_KEY environment variable is not set');
    }
    ragieClient = new Ragie({ auth: apiKey });
  }
  return ragieClient;
}

export async function uploadToRagie(
  file: { rawBytes: Buffer; fileName: string },
  metadata: Record<string, string>,
  partition: string
) {
  const client = getRagieClient();

  const blob = new Blob([new Uint8Array(file.rawBytes)], { type: 'video/mp4' });
  const ragieFile = new File([blob], file.fileName, { type: 'video/mp4' });

  const result = await client.documents.create({
    file: ragieFile,
    metadata,
    mode: { video: 'audio_video' }, // Full audio + visual analysis for video files
    partition,
  });

  return result;
}

export async function getRagieDocumentStatus(documentId: string) {
  const client = getRagieClient();
  const doc = await client.documents.get({ documentId });
  return doc;
}

export async function queryRagie(
  query: string,
  partition: string,
  topK: number = 8,
) {
  const client = getRagieClient();

  const result = await client.retrievals.retrieve({
    query,
    partition,
    rerank: true,
    topK,
    maxChunksPerDocument: 3,
  });

  return result;
}

export async function deleteRagieDocument(documentId: string) {
  const client = getRagieClient();
  await client.documents.delete({ documentId });
}
