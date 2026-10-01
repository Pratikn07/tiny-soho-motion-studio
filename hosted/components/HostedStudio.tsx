"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import { createStudioApi } from "@/lib/api";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { Login } from "@/components/Login";
import { StudioShell } from "@/components/StudioShell";
import { CreationShell } from "@/components/creation/CreationShell";
import { createCreationApi } from "@/components/creation/api";

export function HostedStudio({ creation = false }: { creation?: boolean }) {
  const [client, setClient] = useState<ReturnType<typeof createBrowserSupabaseClient> | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<{ token: string; error?: string } | null>(null);
  const [authError, setAuthError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    setClient(supabase);
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    }).catch(() => {
      setAuthError("Could not restore your session. Please sign in again.");
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const api = useMemo(() => client ? createStudioApi(client) : null, [client]);
  const creationApi = useMemo(() => client ? createCreationApi({
    getAccessToken: async () => (await client.auth.getSession()).data.session?.access_token ?? null,
  }) : null, [client]);
  useEffect(() => {
    if (!api || !session) return;
    let current = true;
    const token = session.access_token;
    setAccess(null);
    void api.authorize().then(() => {
      if (current) setAccess({ token });
    }).catch((error: unknown) => {
      if (current) setAccess({ token, error: error instanceof Error ? error.message : "Could not verify Studio access." });
    });
    return () => { current = false; };
  }, [api, session?.access_token, retry]);

  const signOut = async () => {
    const { error } = await client!.auth.signOut({ scope: "local" });
    if (error) setAuthError("Sign out failed. Please try again.");
  };

  if (loading || !client || !api) {
    return <div className="legacy-studio"><main>
      <h1>Tiny Soho Motion Studio</h1>
      <p>Sign in to create typography-safe motion.</p>
      <p>Loading Motion Studio…</p>
    </main></div>;
  }
  if (!session) {
    return <div className="legacy-studio">{authError && <p role="alert">{authError}</p>}<Login onSignIn={async (email, password) => {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }} /></div>;
  }
  if (!access || access.token !== session.access_token) {
    return <div className="legacy-studio"><main aria-busy="true"><h1>Tiny Soho Studio</h1><p>Checking Studio access…</p></main></div>;
  }
  if (access.error) {
    return <div className="legacy-studio"><main><h1>Tiny Soho Studio</h1><p role="alert">{access.error}</p>
      <button onClick={() => setRetry((value) => value + 1)}>Try again</button>{" "}
      <button onClick={() => void signOut()}>Sign out</button>
      {authError && <p role="alert">{authError}</p>}
    </main></div>;
  }
  return <>{authError && <p role="alert">{authError}</p>}{creation && creationApi
    ? <CreationShell key={session.user.id} api={creationApi} onSignOut={() => void signOut()} />
    : <StudioShell key={session.user.id} api={api} onSignOut={() => void signOut()} />}</>;
}
