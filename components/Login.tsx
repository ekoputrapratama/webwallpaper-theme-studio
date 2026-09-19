"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  isFirebaseClientConfigured,
  loginWithEmail,
  loginWithGithub,
  loginWithGoogle,
} from "@/lib/firebase";

function GoogleIcon() {
  return (
    <svg className="login-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#fff"
        opacity="0.85"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#fff"
        opacity="0.6"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#fff"
        opacity="0.7"
        d="M5.84 14.1a6.58 6.58 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#fff"
        opacity="0.45"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg className="login-icon" viewBox="0 0 24 24" fill="#e6e9f0" aria-hidden="true">
      <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 22 12 10 10 0 0 0 12 2Z" />
    </svg>
  );
}

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
        let msg = `Sign-in failed (HTTP ${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) msg = data.error;
        } catch {
          // response was not JSON; fall back to the status message
        }
        setError(msg);
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
    <main className="login-screen">
      <div className="login-card">
        <div className="brand">
          <div className="logo">W</div>
          <div>
            <div className="title">WebWallpaper Theme Studio</div>
            <div className="sub">create HTML5 and video wallpapers</div>
          </div>
        </div>

        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Your themes are saved to your account and stay private to you.</p>

        <div className="login-providers">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || !configured}
            onClick={() => withBusy(loginWithGoogle)}
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <button
            type="button"
            className="btn btn-block"
            disabled={busy || !configured}
            onClick={() => withBusy(loginWithGithub)}
          >
            <GithubIcon />
            Continue with GitHub
          </button>
        </div>

        <div className="login-divider">or use email</div>

        <form onSubmit={onEmail}>
          <div className="login-fields">
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
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !configured}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

        {error && <div className="login-error">{error}</div>}

        {!configured && (
          <div className="login-note warn">
            Firebase is not configured. Set the NEXT_PUBLIC_FIREBASE_* environment variables to
            enable sign-in.
          </div>
        )}
      </div>
    </main>
  );
}