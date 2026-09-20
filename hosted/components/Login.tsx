"use client";

import { FormEvent, useState } from "react";

export function Login({ onSignIn }: { onSignIn: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSignIn(email.trim(), password);
    } catch {
      setError("Sign-in was not accepted.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <p className="eyebrow">Tiny Soho</p>
      <h1>Motion Studio</h1>
      <p>Sign in with your existing Tiny Soho account to create typography-safe motion.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
