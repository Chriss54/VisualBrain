import { NextRequest, NextResponse } from 'next/server';
import { uploadToRagie, toRagiePartition } from '@/lib/ragie';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const recordingId = formData.get('recordingId') as string;
    const userId = formData.get('userId') as string;
    const description = formData.get('description') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!recordingId || !userId) {
      return NextResponse.json({ error: 'Missing recordingId or userId' }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Ragie
    const result = await uploadToRagie(
      {
        rawBytes: buffer,
        fileName: file.name,
      },
      {
        recordingId,
        userId,
        fileName: file.name,        // ← stored so Ask can show the filename
        description: description || '',
        uploadedAt: new Date().toISOString(),
      },
      toRagiePartition(userId)
    );

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
