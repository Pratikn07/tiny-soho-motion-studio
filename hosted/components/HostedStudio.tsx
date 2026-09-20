"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import { createStudioApi } from "@/lib/api";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { Login } from "@/components/Login";
import { MotionStudio } from "@/components/MotionStudio";

export function HostedStudio() {
  const [client, setClient] = useState<ReturnType<typeof createBrowserSupabaseClient> | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    setClient(supabase);
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const api = useMemo(() => client ? createStudioApi(client) : null, [client]);
  if (loading || !client || !api) {
    return <main>
      <h1>Tiny Soho Motion Studio</h1>
      <p>Sign in to create typography-safe motion.</p>
      <p>Loading Motion Studio…</p>
    </main>;
  }
  if (!session) {
    return <Login onSignIn={async (email, password) => {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }} />;
  }
  return <MotionStudio api={api} />;
}
