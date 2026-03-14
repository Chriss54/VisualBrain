import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

const SYSTEM_PROMPT = `You are VisualBrain — an AI assistant that answers questions about screen recordings from Google Meet sessions for a software development team.

You receive relevant chunks from video recordings that include both transcript (what was said) and visual analysis (what was shown on screen — code, UI elements, terminal output, diagrams, etc.).

Your job:
1. Answer the user's question accurately based on the provided video chunks.
2. Always reference the specific source recordings and timestamps where the information was found.
3. When describing code or technical content that was visible on screen, format it properly with code blocks.
4. Be concise but thorough. Developers value precision.
5. If the chunks don't contain enough information to fully answer, say so honestly and mention what WAS found.

Format your sources as [Source N] references inline, e.g. "The auth middleware was implemented using Express [Source 1]."
At the end, list the sources with recording names and timestamps.`;

export interface ChunkSource {
  documentId: string;
  documentName: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export async function generateAnswer(
  question: string,
  chunks: ChunkSource[],
  sourceDisplayNames?: Record<string, string>
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const contextParts = chunks.map((chunk, i) => {
    const meta = chunk.metadata || {};
    const timestamp = meta.timestamp || 'unknown';
    // Use smart title if available, otherwise fall back to raw documentName
    const displayName = sourceDisplayNames?.[chunk.documentId]
      || sourceDisplayNames?.[`fn:${chunk.documentName}`]
      || chunk.documentName;
    return `[Source ${i + 1}] Recording: "${displayName}" | Timestamp: ${timestamp} | Relevance: ${(chunk.score * 100).toFixed(0)}%\n---\n${chunk.text}`;
  });

  const prompt = `${SYSTEM_PROMPT}

Here are the relevant video chunks retrieved for the user's question:

${contextParts.join('\n\n')}

---

User question: ${question}

Please provide a comprehensive answer with source references.`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  return response.text();
}

