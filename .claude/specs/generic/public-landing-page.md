> Inferred type: not inferred — given explicitly as **generic** (spans a new frontend route plus a behavior change to the existing `/` page; no single db/bpmn/dmn/worker/insurance-type/api section in SPEC.md covers it as one unit, the same reasoning `[[claimant-portal-ui]]` and `[[auth-role-based-access]]` used for themselves)

# generic/public-landing-page

**Status:** Draft

## Purpose

`[[claimant-portal-ui]]` (Locked) specced `/` as "Page 1 — Claims," and `[[auth-role-based-access]]` (Locked) later added auth on top without revisiting that page — `GET /api/claims`/`GET /api/policies` now both require a logged-in session (`401` otherwise), but `app/page.tsx` still unconditionally calls `fetchAllClaims()`/renders the policy filter on mount regardless of auth state. The result, confirmed live: an anonymous visitor (a bookmarked link, a shared URL, or simply not-yet-logged-in) hitting `/` today sees a broken page — "Couldn't load claims (401)" and "Couldn't load policies" rendered as error banners, with no explanation and no obvious next step besides noticing "Log in" in the top-right corner. This spec replaces that broken state with an actual public landing page: a short pitch for the product and a clear way to get to `/login` (and `/signup`), for anyone not yet authenticated.

## Scope

**In scope:**
- Public landing content shown at `/` to unauthenticated visitors — replaces today's error-state claims list, not a new route (see Design for why).
- Clear calls to action to `/login` and `/signup`.
- No data fetching, no API calls — this page must render correctly with zero backend dependency, which is exactly the property today's `/` lacks for a logged-out visitor.
- Authenticated behavior at `/` is unchanged: a logged-in user (any role) still sees today's Claims list immediately, no extra click or redirect hop.

**Out of scope:**
- Any marketing content beyond a short product pitch (testimonials, pricing, feature grids) — this is an internal test app (`[[project_demo_app_no_real_payments]]`), not a real product launch.
- Forcing a hard redirect to `/login` for anonymous visitors (e.g. a Next.js middleware redirect) — see Open Question 1 for why this spec doesn't default to that.
- Changing `/policies` or `/tasks`'s existing auth-guard patterns — both already redirect appropriately for their own audiences (claimant vs. staff) and aren't part of this problem.
- SEO/metadata work (Open Graph tags, etc.) — not relevant for a local dev/demo app with no public deployment (`SPEC.md` §14's cloud-hosting item is still unbuilt).

## Design

### Where the landing content lives

Not a new route (e.g. `/welcome`) with a redirect from `/` — that would introduce a redirect hop (and a flash of the wrong content) for the common case of a returning logged-in user landing on `/`, the app's actual home page per `[[claimant-portal-ui]]`. Instead, `app/page.tsx` branches on `useAuth()`'s `user`/`loading` state, the same pattern `app/policies/page.tsx` already uses to branch claimant vs. staff content at one URL:

- `loading` (auth check still in flight): render nothing / a skeleton, exactly as today — avoids a flash of landing content for an already-logged-in user whose session just hasn't resolved yet.
- `!user` (confirmed logged out): render the new landing content instead of calling `fetchAllClaims()`/`fetchActiveClaimsByPolicy()` at all. No 401, because no request is made.
- `user` (logged in): unchanged — today's Claims list, KPIs, filters, table.

This keeps `/` as a single URL serving both audiences, matching the existing `TopBar` logo link (`href="/"`) and bookmark/share expectations, and requires no new page route.

### Landing content

Reuses the visual language already established on this page (`hero` section styling, `HeroIllustrations` components) rather than introducing a new design language for a page that only a logged-out visitor ever sees:

- Headline + one-paragraph pitch: what ClaimFlow AI is (AI-assisted claims triage, human-in-the-loop decisions — the same framing `SPEC.md` §1 uses).
- Two calls to action: "Log in" (primary button, `href="/login"`) and "Sign up" (secondary/text link, `href="/signup"`) — mirrors the pairing already on `/login` itself ("Not a claimant yet? Sign up").
- No claim data, no KPI tiles, no table — those all require auth and have no meaning for a visitor who isn't logged in yet.

### Interaction with existing redirects

No change needed to `/policies`' claimant-redirect or `/tasks`' staff-only guard — both already assume a logged-in user reaching them (via nav, which itself requires being logged in to see those tabs meaningfully) or redirect an anonymous visitor to `/login` today. This spec only fixes `/`, the one page that didn't have an auth branch at all.

## Open Questions

1. **CTA-driven landing vs. hard redirect.** This spec keeps the anonymous visitor on `/` with buttons to click, rather than immediately redirecting them to `/login` (e.g. via Next.js middleware on every route). A hard redirect is simpler to reason about and closer to how `/tasks`/`/policies` already behave for their own guarded cases, but it removes the "landing page" the user explicitly asked for — a visitor would never see any ClaimFlow AI content before being bounced to a bare login form. Recommend keeping the CTA-driven landing (as designed above) unless there's a reason to prefer the redirect-everywhere pattern for consistency with the other two guards.

## Follow-up dependencies

- None known — this is a self-contained fix to `/`'s logged-out state; nothing else depends on it landing first.
