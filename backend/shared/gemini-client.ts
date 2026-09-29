const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// "-latest" alias tracks Google's current default flash model, so this
// doesn't need a manual bump every time a dated model version is retired.
// The primary model. For the audit trail (NAIC-style AI-decision
// traceability) callers log the model generateContent() returns instead,
// since a fallback model may have answered.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

// Tried in order after GEMINI_MODEL when Google reports a capacity or
// availability problem (SPEC.md §12 "Gemini model fallback").
export const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter((m) => m && m !== GEMINI_MODEL);

const FALLBACK_STATUSES = new Set([429, 500, 502, 503, 504]);

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
// Returns the model that actually answered, so callers log it in audit_log.
export async function generateContent(
  promptText: string,
  parts: GeminiPart[] = []
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set (see backend/workers/.env.example)");
  }

  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  const failures: string[] = [];
  for (const model of models) {
    const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }, ...parts] }],
        // Low, fixed temperature — these calls feed fraud/risk decisions that
        // need to be as consistent as possible for the same input, not
        // creative. 0 isn't guaranteed fully deterministic on Gemini, but
        // minimizes run-to-run drift versus the provider default.
        generationConfig: { temperature: 0 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (FALLBACK_STATUSES.has(res.status) && model !== models[models.length - 1]) {
        console.warn(`Gemini model ${model} returned ${res.status}; falling back to the next model`);
        failures.push(`${model}: ${res.status}`);
        continue;
      }
      const tried = failures.length ? ` (after ${failures.join(", ")})` : "";
      throw new Error(`Gemini API error ${res.status} from ${model}${tried}: ${body}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      throw new Error(`Gemini API returned no text in response from ${model}: ${JSON.stringify(data)}`);
    }
    return { text, model };
  }
  throw new Error("No Gemini model configured");
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
