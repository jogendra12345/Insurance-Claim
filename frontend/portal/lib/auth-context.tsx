"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { logout as apiLogout } from "./api";
import {
  clearSession,
  getStoredUser,
  getToken,
  isAuthKey,
  purgeLegacyLocalStorage,
  registerOwner,
  signOutTab,
} from "./auth-session";
import type { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: () => {},
  logout: async () => {},
});

// The logged-in user comes from this tab's sessionStorage (lib/auth-session.ts),
// so each tab can be signed in as someone different — .claude/specs/generic/
// auth-role-based-access.md, addendum 2026-10-05. The server can't see
// sessionStorage, so it renders logged-out and `loading` stays true until
// this runs in the browser; pages wait on `loading` before redirecting.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const readUser = useCallback(() => {
    const stored = getStoredUser();
    // A user without a token (half-written storage) is not a login.
    if (stored && !getToken()) {
      clearSession();
      return null;
    }
    return stored;
  }, []);

  useEffect(() => {
    purgeLegacyLocalStorage();
    setUser(readUser());
    setLoading(false);
  }, [readUser]);

  // Owner check: API calls refuse to run as anyone but the user this tab shows.
  useEffect(() => {
    registerOwner(user?.id ?? null);
  }, [user]);

  // Another tab or devtools touching this tab's auth keys means the sign-in
  // changed under the page — sign out rather than act as someone else.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (user && isAuthKey(event.key)) signOutTab("changed");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user]);

  // Called by /login and /signup after a successful login (which saved the
  // session) so the context picks it up without a full reload.
  const refresh = useCallback(() => {
    setUser(readUser());
    setLoading(false);
  }, [readUser]);

  // Logs out this tab only; other tabs keep their own logins.
  async function logout() {
    await apiLogout();
    clearSession();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
