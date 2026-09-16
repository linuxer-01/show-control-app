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

export type DeckKind = "pptx" | "pdf";

export const DECK_KINDS: Record<DeckKind, { extension: string; contentType: string; label: string; unit: string }> = {
  pptx: { extension: ".pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PPT", unit: "slide" },
  pdf: { extension: ".pdf", contentType: "application/pdf", label: "PDF", unit: "page" },
};

/** Upload paths keep the original extension, so the kind needs no extra column on the row. */
export function deckKind(storagePath: string): DeckKind {
  return storagePath.toLowerCase().endsWith(DECK_KINDS.pdf.extension) ? "pdf" : "pptx";
}

export function kindFromFileName(fileName: string): DeckKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(DECK_KINDS.pptx.extension)) return "pptx";
  if (lower.endsWith(DECK_KINDS.pdf.extension)) return "pdf";
  return null;
}

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