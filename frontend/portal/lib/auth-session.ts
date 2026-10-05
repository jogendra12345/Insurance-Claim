import type { AuthUser } from "./types";

// Per-tab login: the bearer token and the user it belongs to live in this
// tab's sessionStorage — never localStorage or a cookie, both of which every
// tab shares (a second login in another tab used to replace the first).
// .claude/specs/generic/auth-role-based-access.md, addendum 2026-10-05.
//
// Accepted trade-offs: a new tab or pasted link starts logged out, closing
// the tab ends the login, and "Duplicate tab" copies the login.

export const TOKEN_KEY = "claimflow.auth.token";
export const USER_KEY = "claimflow.auth.user";
const AUTH_KEYS = [TOKEN_KEY, USER_KEY];

// Per-tab state that belongs to whoever is signed in, cleared with the login.
const PER_USER_TAB_KEYS = ["claimflow-assistant"];

// Auth keys an older build might have left in localStorage — removed once per
// load so a token can never be shared between tabs through it.
const LEGACY_LOCAL_KEYS = [...AUTH_KEYS, "claimflow_session", "token", "access_token", "user"];

export type SignOutReason = "changed" | "expired";

export const SIGN_OUT_MESSAGES: Record<SignOutReason, string> = {
  changed: "You were signed out because this tab's sign-in changed. Sign in again.",
  expired: "Your session has expired. Sign in again.",
};

// Every storage access is wrapped: storage can be blocked (privacy settings,
// some embedded contexts), and the app must still load — just logged out.
function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Blocked storage: the login works until the next page load.
  }
}

function remove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing stored to remove.
  }
}

export function getToken(): string | null {
  return read(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AuthUser): void {
  write(TOKEN_KEY, token);
  write(USER_KEY, JSON.stringify(user));
}

/** Logs this tab out: its token, user, and per-user tab state. Other tabs are untouched. */
export function clearSession(): void {
  [...AUTH_KEYS, ...PER_USER_TAB_KEYS].forEach(remove);
  ownerUserId = null;
}

export function purgeLegacyLocalStorage(): void {
  try {
    LEGACY_LOCAL_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage blocked — nothing could have been stored there either.
  }
}

export function isAuthKey(key: string | null): boolean {
  return key !== null && AUTH_KEYS.includes(key);
}

// ---------- Owner check ----------
// The auth context registers which user this tab is showing. If the stored
// user later differs (storage changed under the page), the tab is signed out
// before any request goes out as someone else.

let ownerUserId: string | null = null;

export function registerOwner(userId: string | null): void {
  ownerUserId = userId;
}

/** True when the stored login still belongs to the user this tab is showing (or no owner is registered yet). */
export function ownerMatches(): boolean {
  if (ownerUserId === null) return true;
  return getStoredUser()?.id === ownerUserId;
}

/** Clears this tab's login and sends it to the login page with an explanation. */
export function signOutTab(reason: SignOutReason): void {
  clearSession();
  try {
    window.location.assign(`/login?reason=${reason}`);
  } catch {
    // Non-browser environment (tests) — clearing the session is enough.
  }
}
