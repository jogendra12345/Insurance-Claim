// WhatsApp Cloud API send wrapper, per the locked
// .claude/specs/generic/claims-assistant.md. Mirrors backend/shared/
// notification-provider.ts's mock-fallback pattern: no Meta Business Account
// exists yet (PREREQUISITES.md "still needed"), so every send logs instead
// of calling the Graph API until WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID
// are set — keeps routes/whatsapp.ts testable today against direct HTTP
// POSTs shaped like Meta's webhook payload, without failing on a missing
// credential.

const GRAPH_API_VERSION = "v20.0";

export interface MenuOption {
  id: string;
  title: string;
}

function graphApiConfigured(): boolean {
  return !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;
}

async function callGraphApi(body: Record<string, unknown>): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp Graph API send failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendText(to: string, text: string): Promise<void> {
  if (!graphApiConfigured()) {
    console.log(`[mockWhatsAppClient] to ${to}:\n${text}`);
    return;
  }
  await callGraphApi({ to, type: "text", text: { body: text } });
}

export async function sendMenu(to: string, bodyText: string, options: MenuOption[]): Promise<void> {
  if (!graphApiConfigured()) {
    console.log(
      `[mockWhatsAppClient] to ${to}:\n${bodyText}\n${options.map((o) => `- [${o.id}] ${o.title}`).join("\n")}`
    );
    return;
  }
  await callGraphApi({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: "Menu",
        sections: [{ title: "Options", rows: options.map((o) => ({ id: o.id, title: o.title })) }],
      },
    },
  });
}

// Downloads a WhatsApp-hosted media item by id — two calls per Meta's Media
// API: resolve the temporary URL, then fetch the bytes with the same bearer
// token (.claude/specs/generic/claims-assistant.md "Media handling"). Not
// mockable the way sends are (there's no media to download in a
// non-Meta-connected dev environment) — only called once a real media_id
// arrives from an actual Meta webhook.
export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    throw new Error(`Resolving WhatsApp media ${mediaId} failed (${metaRes.status})`);
  }
  const meta = (await metaRes.json()) as { url: string; mime_type: string };
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) {
    throw new Error(`Downloading WhatsApp media ${mediaId} failed (${fileRes.status})`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType: meta.mime_type };
}
