import { FormEvent, useState } from "react";
import { api } from "../api";
import type { Me } from "../types";

export function AuthScreen({ onSignedIn }: { onSignedIn: (token: string, me: Me) => void }) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "register"
          ? await api.register(email.trim(), password, displayName.trim())
          : await api.login(email.trim(), password);
      onSignedIn(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            🔥
          </span>
          <h1>Ember</h1>
        </div>
        <p className="muted">Chats, plus breakout side conversations that clear themselves unless someone keeps them.</p>

        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => setMode("register")}>
            Sign up
          </button>
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => setMode("login")}>
            Log in
          </button>
        </div>

        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={mode === "register" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {mode === "register" && (
          <label>
            Display name
            <input
              autoComplete="name"
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </label>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? "…" : mode === "register" ? "Create account" : "Log in"}
        </button>
        {mode === "register" && <p className="hint">Passwords need at least 8 characters.</p>}
      </form>
    </main>
  );
}
