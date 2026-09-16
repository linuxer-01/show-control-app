import { supabase } from "@/integrations/supabase/client";

export type Presentation = {
  id: string;
  name: string;
  storage_path: string;
  slide_count: number;
  access_code: string;
  status: string;
};

export type PresentationSession = {
  id: string;
  presentation_id: string;
  is_active: boolean;
  remote_enabled: boolean;
  current_slide: number;
  controller_id: string | null;
  controller_lease_until: string | null;
  pending_sequence: number | null;
};

export async function ensureAnonymousUser() {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signedIn.user) throw error ?? new Error("Could not start a device session");
  return signedIn.user;
}

export function makeAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}