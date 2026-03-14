/**
 * Smart Title Generation for VisualBrain
 * Parses raw filenames (UUIDs, Google Meet conventions) into human-readable titles.
 */

/**
 * Generate a human-readable title from a video filename and optional metadata.
 *
 * Supported patterns:
 * - Google Meet: "GMT20260314-143022 - Sprint Planning.mp4" → "Sprint Planning — Mar 14, 2026"
 * - Google Meet (no title): "GMT20260314-143022.mp4" → "Meeting — Mar 14, 2026 at 2:30 PM"
 * - UUID: "be67728c-3b72-4023-8024-cd83f1b0884c.MP4" → uses description or "Recording — [date]"
 * - Normal: "sprint-review-march.mp4" → "Sprint Review March"
 */
export function generateSmartTitle(
  fileName: string,
  createdAt?: string,
  description?: string,
): string {
  // 1. Try Google Meet format: GMT<YYYYMMDD>-<HHMMSS> - <Title>.<ext>
  const gmtMatch = fileName.match(
    /^GMT(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\s*-?\s*(.*?)\.[\w]+$/i
  );
  if (gmtMatch) {
    const [, year, month, day, hour, minute, , meetTitle] = gmtMatch;
    const date = new Date(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute)
    );
    const dateStr = formatDate(date);

    if (meetTitle && meetTitle.trim()) {
      return `${meetTitle.trim()} — ${dateStr}`;
    }
    const timeStr = formatTime(date);
    return `Meeting — ${dateStr} at ${timeStr}`;
  }

  // 2. Check if it's a UUID filename
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[\w]+$/i;
  if (uuidPattern.test(fileName)) {
    const dateStr = createdAt ? formatDate(new Date(createdAt)) : 'Unknown Date';
    const timeStr = createdAt ? formatTime(new Date(createdAt)) : '';

    if (description && description.trim()) {
      return `${description.trim()} — ${dateStr}`;
    }
    return `Recording — ${dateStr}${timeStr ? ` at ${timeStr}` : ''}`;
  }

  // 3. Normal filename: strip extension, clean up
  const nameOnly = fileName.replace(/\.[\w]+$/, '');
  // Replace dashes and underscores with spaces, capitalize words
  const cleaned = nameOnly
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  if (cleaned.length > 0) {
    const dateStr = createdAt ? ` — ${formatDate(new Date(createdAt))}` : '';
    return `${cleaned}${dateStr}`;
  }

  // 4. Fallback
  const dateStr = createdAt ? formatDate(new Date(createdAt)) : 'Unknown Date';
  return `Recording — ${dateStr}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
