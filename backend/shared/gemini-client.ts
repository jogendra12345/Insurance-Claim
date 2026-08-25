const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// "-latest" alias tracks Google's current default flash model, so this
// doesn't need a manual bump every time a dated model version is retired.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

interface InlinePart {
  inlineData: { mimeType: string; data: string };
}
interface TextPart {
  text: string;
}
type GeminiPart = InlinePart | TextPart;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

// One call per worker invocation — no conversation/session state kept here.
// promptText goes first as the instruction, followed by any document parts.
export async function generateContent(promptText: string, parts: GeminiPart[] = []): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set (see backend/workers/.env.example)");
  }

  const res = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: promptText }, ...parts] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    throw new Error(`Gemini API returned no text in response: ${JSON.stringify(data)}`);
  }
  return text;
}

// Fetches a document (from its public MinIO URL) and returns it as a Gemini
// inline_data part, so the model can read the actual file content.
export async function fetchAsInlinePart(fileUrl: string): Promise<InlinePart> {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch document at ${fileUrl}: ${res.status}`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { inlineData: { mimeType, data: buffer.toString("base64") } };
}

// Strips ```json fences models sometimes wrap structured output in, then parses.
export function parseJsonResponse<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return JSON.parse(cleaned) as T;
}
