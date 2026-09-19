"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  isFirebaseClientConfigured,
  loginWithEmail,
  loginWithGithub,
  loginWithGoogle,
} from "@/lib/firebase";

export default function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const configured = isFirebaseClientConfigured();

  async function exchange(idToken: string | null) {
    if (!idToken) {
      setError("Sign-in returned no credentials.");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Sign-in could not be completed.");
        setBusy(false);
        return;
      }
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch {
      setError("Sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  function withBusy(fn: () => Promise<string | null>) {
    setError("");
    setBusy(true);
    fn()
      .then(exchange)
      .catch((e) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Sign-in failed");
      });
  }

  function onEmail(e: FormEvent) {
    e.preventDefault();
    withBusy(() => loginWithEmail(email, password));
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="logo">W</div>
          <div>
            <div className="title">WebWallpaper Theme Studio</div>
            <div className="sub">create HTML5 and video wallpapers</div>
          </div>
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <h1>Sign in</h1>
          <p>Your themes are saved to your account and stay private to you.</p>
        </div>

        {!configured && (
          <p style={{ color: "var(--danger)", margin: "0 0 12px" }}>
            Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* environment variables to
            enable sign-in.
          </p>
        )}

        <div
          style={{
            maxWidth: 420,
            background: "var(--panel-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !configured}
              onClick={() => withBusy(loginWithGoogle)}
            >
              Continue with Google
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !configured}
              onClick={() => withBusy(loginWithGithub)}
            >
              Continue with GitHub
            </button>
          </div>

          <div style={{ textAlign: "center", margin: "16px 0 8px", opacity: 0.6 }}>or</div>

          <form onSubmit={onEmail}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                disabled={busy || !configured}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                disabled={busy || !configured}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !configured}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>

          {error && <p style={{ color: "var(--danger)", marginTop: 12 }}>{error}</p>}
        </div>
      </main>
    </>
  );
}