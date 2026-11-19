import { useCallback, useEffect, useState } from "react";
import { api, setToken, setUnauthorizedHandler } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { Workspace } from "./components/Workspace";
import type { Me } from "./types";

const TOKEN_KEY = "ember.token";

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked (private mode etc.): the session just won't survive a reload.
  }
}

export interface Session {
  token: string;
  me: Me;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(() => readToken() !== null);

  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
    setSession(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(signOut), [signOut]);

  // Restore a saved session on load.
  useEffect(() => {
    const saved = readToken();
    if (!saved) return;
    setToken(saved);
    api
      .me()
      .then((me) => setSession({ token: saved, me }))
      .catch(() => signOut())
      .finally(() => setRestoring(false));
  }, [signOut]);

  const signedIn = useCallback((token: string, me: Me) => {
    writeToken(token);
    setToken(token);
    setSession({ token, me });
  }, []);

  if (restoring) return <div className="splash">Loading…</div>;
  if (!session) return <AuthScreen onSignedIn={signedIn} />;
  return (
    <Workspace
      key={session.token}
      session={session}
      onSignOut={signOut}
      onMeChanged={(me) => setSession((s) => (s ? { ...s, me } : s))}
    />
  );
}
