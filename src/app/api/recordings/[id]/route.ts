import { NextResponse } from 'next/server';
import { deleteRagieDocument } from '@/lib/ragie';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const ragieDocId = searchParams.get('ragieDocId');

    if (ragieDocId) {
      try {
        await deleteRagieDocument(ragieDocId);
      } catch (err) {
        console.warn('Failed to delete from Ragie:', err);
      }
    }

    return NextResponse.json({ success: true, recordingId: id });
  } catch (error: unknown) {
    console.error('Delete error:', error);
    const message = error instanceof Error ? error.message : 'Delete failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
