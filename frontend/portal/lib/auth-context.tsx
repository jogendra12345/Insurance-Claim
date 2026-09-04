"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import { fetchCurrentUser, logout as apiLogout } from "./api";
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

const CACHE_KEY = "claimflow_last_user";

// Every nav link in this app is a plain <a href> (full page reload, not
// next/link), so AuthProvider remounts on every navigation and briefly has
// user=null while GET /api/auth/me is in flight — long enough for e.g.
// TopBar's role-dependent tab label to flash its logged-out default before
// flipping to the real one. Seeding state from this per-viewer cache paints
// the right value immediately; the fetch below still runs and corrects it
// (including clearing it) if the cached guess turns out stale.
function readCachedUser(): AuthUser | null {
  if (typeof window === "undefined") return null; // SSR/build pass — no localStorage
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore — private browsing / blocked storage, cache is a convenience only
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Starts null (matching SSR, which has no localStorage) to avoid a
  // hydration mismatch; the layout effect below seeds the cached guess
  // synchronously before the browser paints, so there's still no visible
  // flash on the client.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    const cached = readCachedUser();
    if (cached) setUser(cached);
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchCurrentUser()
      .then((fetched) => {
        setUser(fetched);
        writeCachedUser(fetched);
      })
      .catch(() => {
        setUser(null);
        writeCachedUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  async function logout() {
    await apiLogout();
    setUser(null);
    writeCachedUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
