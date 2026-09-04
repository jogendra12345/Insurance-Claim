"use client";

import { createContext, useCallback, useContext, useState } from "react";
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

// initialUser comes from the server (RootLayout resolves it by forwarding
// the session cookie to GET /api/auth/me during SSR — see app/layout.tsx)
// so the very first HTML the browser paints already has the right
// logged-in state, before any client JS runs. Seeding client state from a
// cache (localStorage, etc.) can't fix that: the server-rendered HTML
// paints first regardless of what React does after hydration.
export function AuthProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: AuthUser | null;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [loading, setLoading] = useState(false);

  // Not auto-run on mount — initialUser is already correct for every full
  // page load (server-resolved, see app/layout.tsx). Exposed for the
  // /login and /signup pages to call after a router.push (client-side nav,
  // doesn't re-run the server component) so context picks up the new
  // session without a full reload.
  const refresh = useCallback(() => {
    setLoading(true);
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
