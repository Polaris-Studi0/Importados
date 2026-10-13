import { createClient } from "@supabase/supabase-js";

export const initialAuthFlow = /type=(invite|recovery)/.test(window.location.hash);
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const forceDemo = import.meta.env.VITE_DEMO_MODE === "true";
export const isDemoMode = forceDemo && import.meta.env.DEV;
export const isConfigured = !!url && !!anonKey && !anonKey.includes("CLAVE_PUBLICA");

export const supabase = (isDemoMode || !isConfigured)
  ? null
  : createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } }
    });
