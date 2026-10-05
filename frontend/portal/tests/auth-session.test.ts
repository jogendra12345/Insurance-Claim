// Per-tab login in the portal — .claude/specs/generic/auth-role-based-access.md,
// addendum 2026-10-05. fetch is mocked; nothing here talks to the real API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchAllClaims, login } from "@/lib/api";
import {
  clearSession,
  getStoredUser,
  getToken,
  purgeLegacyLocalStorage,
  registerOwner,
  saveSession,
  SIGN_OUT_MESSAGES,
  TOKEN_KEY,
  USER_KEY,
} from "@/lib/auth-session";
import type { AuthUser } from "@/lib/types";

const alice: AuthUser = { id: "user-a", email: "alice@claimflow.test", role: "claimant" };
const bob: AuthUser = { id: "user-b", email: "bob@claimflow.test", role: "adjuster" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // jsdom can't navigate; signOutTab's redirect to /login is checked manually.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
  clearSession();
  registerOwner(null);
  window.localStorage.clear();
});

describe("login", () => {
  it("keeps the token in this tab's sessionStorage, not localStorage or a cookie", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: "tok-alice", token_type: "bearer", user: alice }));

    const user = await login({ email: alice.email, password: "pw" });

    expect(user).toEqual(alice);
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe("tok-alice");
    expect(getStoredUser()).toEqual(alice);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("tok-alice");
    expect(document.cookie).not.toContain("tok-alice");
  });

  it("doesn't send cookies: no credentials option on the request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: "t", token_type: "bearer", user: alice }));
    await login({ email: alice.email, password: "pw" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBeUndefined();
  });

  it("treats a 401 from login as a wrong password, not a sign-out", async () => {
    saveSession("existing", alice);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "Incorrect email or password." }));

    await expect(login({ email: alice.email, password: "bad" })).rejects.toThrow("Incorrect email or password.");
    expect(getToken()).toBe("existing");
  });
});

describe("API calls", () => {
  it("send Authorization: Bearer <token>", async () => {
    saveSession("tok-alice", alice);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));

    await fetchAllClaims();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok-alice");
  });

  it("sign this tab out on a 401", async () => {
    saveSession("expired-token", alice);
    registerOwner(alice.id);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "Login required." }));

    await expect(fetchAllClaims()).rejects.toThrow(SIGN_OUT_MESSAGES.expired);
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it("refuse to run as a different user than the tab shows, without sending the request", async () => {
    saveSession("tok-alice", alice);
    registerOwner(alice.id);
    // The stored login changes under the page (another login wrote this tab's storage).
    saveSession("tok-bob", bob);

    const error = await fetchAllClaims().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(SIGN_OUT_MESSAGES.changed);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });
});

describe("storage", () => {
  it("removes old auth keys from localStorage, leaving other settings alone", () => {
    window.localStorage.setItem(TOKEN_KEY, "leaked");
    window.localStorage.setItem(USER_KEY, JSON.stringify(alice));
    window.localStorage.setItem("claimflow-theme", "dark");

    purgeLegacyLocalStorage();

    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem(USER_KEY)).toBeNull();
    expect(window.localStorage.getItem("claimflow-theme")).toBe("dark");
  });

  it("logout clears this tab's login and its chat assistant state", () => {
    saveSession("tok-alice", alice);
    window.sessionStorage.setItem("claimflow-assistant", "{}");

    clearSession();

    expect(getToken()).toBeNull();
    expect(window.sessionStorage.getItem("claimflow-assistant")).toBeNull();
  });

  it("keeps working when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => saveSession("t", alice)).not.toThrow();
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(() => purgeLegacyLocalStorage()).not.toThrow();
  });
});
