# Integrate WhatsApp: Adding a WhatsApp Bot to Your App

You can connect any backend to WhatsApp with Meta's **WhatsApp Cloud API**. Meta POSTs each incoming message to a webhook URL you own, and your app replies by calling Meta's Graph API. These steps were used to add a menu-driven WhatsApp assistant to a Node/Express app, and they work for any language or framework.

> **In this repo:** the webhook is `backend/api/src/routes/whatsapp.ts`, outbound sends and media downloads are in `backend/api/src/whatsapp-client.ts`, and the session table is created by `backend/db/migrations/0016_add_whatsapp_sessions.sql`.

## At a glance

```
 Phone (WhatsApp)
      │  user sends a message
      ▼
 Meta WhatsApp Cloud API
      │  POST /api/whatsapp/webhook   (signed with your App Secret)
      ▼
 Your backend  ──►  your DB / storage
      │  POST graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/messages   (Bearer access token)
      ▼
 Meta WhatsApp Cloud API  ──►  Phone (reply)
```

Your app never talks to the phone directly. Meta delivers inbound messages to your webhook and signs each one with your App Secret. Your app replies by calling Meta's `/messages` endpoint with your access token.

## What you need before starting

- A Facebook account and a free **Meta for Developers** account.
- A backend that can expose one HTTP route (GET + POST) and make outbound HTTPS calls.
- A public HTTPS URL for that route. Meta can't reach `localhost`, so when developing locally use a tunnel such as Cloudflare Tunnel (`cloudflared`) or ngrok.
- A phone with WhatsApp to test from.

You don't need your own phone number to start. Meta gives every new app a free **test number** that can message up to 5 pre-approved recipients.

---

## Step 1: Create the Meta app and collect four credentials

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**, choose the **Business** type, then add the **WhatsApp** product. Meta creates a test WhatsApp Business Account (WABA) and a test phone number.
2. Collect the four values below and put them in your backend's `.env` file. **Never commit that file.**

| Env var | What it is | Where to find it |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | ID of the number you send from. This is not the phone number itself. | WhatsApp → API Setup, under the *From* number |
| `WHATSAPP_ACCESS_TOKEN` | Bearer token for sending messages and downloading media | Business Settings → Users → System users → add one → Generate token, expiry **Never**, scopes `whatsapp_business_messaging` + `whatsapp_business_management` |
| `WHATSAPP_APP_SECRET` | Key used to verify that webhook calls really come from Meta | App settings → Basic → App secret |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Any random string you make up | You choose it, then enter the same value in Meta in Step 5 |

> ⚠️ **Use a system-user token, not the one on the API Setup page.** The "Generate access token" button on that page creates a token that expires after about 24 hours. When it expires, your bot stops replying and shows no error.

## Step 2: Build the webhook

A single URL (e.g. `/api/whatsapp/webhook`) handles two methods: **GET** for Meta's one-time verification and **POST** for every incoming message.

### a. GET: the verification handshake

When you save the webhook in Meta, Meta calls your URL with `hub.mode`, `hub.verify_token` and `hub.challenge`. If the token matches yours, send the challenge back:

```ts
router.get("/webhook", (req, res) => {
  const ok = req.query["hub.mode"] === "subscribe"
    && req.query["hub.verify_token"] === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  ok ? res.status(200).send(req.query["hub.challenge"]) : res.sendStatus(403);
});
```

### b. Keep the raw request body

Meta signs the exact bytes it sent. Capture them before JSON parsing reformats anything. In Express:

```ts
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
```

### c. Verify the signature

Each POST carries `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body, keyed with the App Secret>`. Reject any request whose signature doesn't match. Without this check, anyone who finds your URL can send fake messages.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function hasValidSignature(req): boolean {
  const header = req.get("x-hub-signature-256");
  if (!header?.startsWith("sha256=") || !req.rawBody) return false;
  const expected = Buffer.from(
    createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(req.rawBody).digest("hex"));
  const received = Buffer.from(header.slice(7));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
```

### d. POST: acknowledge first, then process

Respond with 200 right away, because Meta retries webhooks that answer slowly and then sends to them less often. Many events aren't messages (delivery and read receipts, for example), so ignore any event that has no message instead of throwing an error.

```ts
router.post("/webhook", async (req, res) => {
  if (!hasValidSignature(req)) return res.sendStatus(401);
  res.sendStatus(200);
  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;          // a status update, not a message
  const from = msg.from;     // sender, digits only with country code, e.g. "919876543210"
  // msg.type "text"             -> msg.text.body
  // msg.type "interactive"      -> msg.interactive.list_reply.id or .button_reply.id
  // msg.type "image"/"document" -> msg.image.id / msg.document.id (a media id)
  await handleMessage(from, msg);
});
```

## Step 3: Send replies through the Graph API

Each outbound message is one POST to `https://graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/messages`, authenticated with your access token:

```ts
async function callGraphApi(body) {
  const res = await fetch(
    `https://graph.facebook.com/v26.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
}

// Plain text
callGraphApi({ to, type: "text", text: { body: "Hello!" } });
```

Most bots need only three message types. When a user taps an option, it comes back to your webhook as the `id` you assigned, so choose ids your code can route on.

| Type | Use it for | Meta's limits |
|---|---|---|
| `text` | Answers, prompts, confirmations | 4,096 characters |
| `interactive` → `list` | A menu of choices behind a "Menu" button | Up to 10 rows; row title ≤ 24 chars, description ≤ 72 |
| `interactive` → `button` | Quick replies under a message | Up to 3 buttons; title ≤ 20 chars, body ≤ 1,024 |

- **Truncate titles yourself.** If a single title is too long, Meta rejects the entire message.
- WhatsApp formatting uses `*bold*` and `_italic_`, not Markdown.

> 💡 **Tip:** if the credentials are unset, have your send functions `console.log` the message instead of calling Meta. That lets you build and test the whole conversation locally before you have a Meta account.

## Step 4: Keep conversation state and handle photos/PDFs

Each webhook call carries a single message and nothing about earlier ones, so you need to store a session per phone number. One table is enough:

```sql
CREATE TABLE whatsapp_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     text UNIQUE NOT NULL,
  mode             text NOT NULL DEFAULT 'menu',   -- which flow the user is in
  collected_fields jsonb NOT NULL DEFAULT '{}',    -- answers gathered so far
  documents        jsonb NOT NULL DEFAULT '[]',    -- files received so far
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

On every message, load or create the session (`INSERT … ON CONFLICT (phone_number) DO UPDATE`), route on `mode`, then save the new state.

These patterns worked well:

- `hi`, `hello` or `menu` returns the user to the top-level menu at any point, and `cancel` abandons the current flow.
- For a multi-field form, keep an ordered list of steps (key, prompt, validator). The next step is the first key that isn't yet in `collected_fields`. On bad input, send the error together with the same prompt again.
- Identify users by `msg.from`. Store phone numbers in the format WhatsApp sends them: digits with country code, no `+` or spaces.

**Receiving files** takes two calls, both using the same bearer token:

1. `GET https://graph.facebook.com/v26.0/<media_id>` returns a temporary `url` and the `mime_type`.
2. `GET` that `url` returns the bytes.

Save the file to your own storage (S3, MinIO, disk) immediately, because Meta's URL expires.

## Step 5: Expose the webhook and connect it in Meta

1. Start your backend, then open a tunnel to it (port 4000 here). Cloudflare's quick tunnels don't need an account:

   ```bash
   cloudflared tunnel --no-autoupdate --url http://localhost:4000
   ```

   To install it, run `winget install Cloudflare.cloudflared` on Windows or `brew install cloudflared` on Mac. The command prints a `https://<random>.trycloudflare.com` URL. That URL **changes every time cloudflared restarts**, and you then have to update it in Meta.
2. In Meta, go to **WhatsApp → Configuration → Edit**. Set the **Callback URL** to `https://<tunnel>/api/whatsapp/webhook` and the **Verify token** to your `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, then click **Verify and save**. Meta calls your GET handler at this point.
3. On the same page, under **Webhook fields**, click **Manage** and subscribe to **`messages`**. If you skip this, verification succeeds but no messages arrive.
4. In **WhatsApp → API Setup → To**, add your own phone number and confirm it with the code WhatsApp sends you. The test number can only message numbers listed here (maximum 5).

## Step 6: Test end to end

1. **Before involving Meta:** leave `WHATSAPP_APP_SECRET` and the token unset, then POST a fake payload shaped like Meta's to your webhook. The replies print to your console.

   ```bash
   curl -X POST http://localhost:4000/api/whatsapp/webhook -H "Content-Type: application/json" \
     -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"15551234567","type":"text","text":{"body":"hi"}}]}}]}]}'
   ```

2. **With Meta:** set all four env vars, restart the backend, and send `hi` from your phone to the test number. The bot should reply within a second or two.
3. **Try every path:** each menu option, bad input on a form step, `cancel` partway through a flow, and a photo or PDF upload.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Verify and save" worked, but messages never reach your server | The app isn't subscribed to the WhatsApp Business Account. The dashboard doesn't always subscribe it for you. | `GET https://graph.facebook.com/v26.0/<WABA_ID>/subscribed_apps` with your bearer token. If your app isn't listed, `POST` to the same URL to subscribe it. |
| Worked yesterday, silent today | The tunnel restarted with a new URL, or you used the 24-hour token | Update the Callback URL in Meta and switch to a system-user token. To see the saved URL, call `GET https://graph.facebook.com/v26.0/<APP_ID>/subscriptions` with header `Authorization: Bearer <APP_ID>\|<APP_SECRET>`. |
| Every webhook POST gets 401 | The signature check fails | This is expected for hand-made curl requests. For real Meta calls, check the App Secret, and make sure you hash the raw body rather than re-serialized JSON. |
| Bot replies, but doesn't recognise the user | Phone format mismatch | Store numbers as digits with country code, no `+` (e.g. `919876543210`). |
| Send fails with a recipient error | Number not on the test allow-list | Add it under API Setup → To (maximum 5). |
| Can't message a user first | WhatsApp only allows free-form replies within 24 hours of the user's last message | Messages that you send first need a pre-approved message template. |

## Going to production

The test setup above only reaches 5 approved numbers. To serve real users you need:

- **Business verification** in Meta Business Settings. This can take several days.
- **Your own phone number**, registered to the WhatsApp Business Account. It can't be active in the regular WhatsApp app at the same time.
- **A permanent webhook URL.** Host the backend on a real domain, or run a named Cloudflare tunnel or ngrok's free static domain as a background service. Then you only set the Callback URL once.
- **Message templates** for anything your app sends first (status updates, reminders), approved in WhatsApp Manager.
- Keep the **signature check** turned on, and keep all four secrets out of source control.
