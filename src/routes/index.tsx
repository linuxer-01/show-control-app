import { createFileRoute, Link } from "@tanstack/react-router";
import JSZip from "jszip";
import { ChevronLeft, ChevronRight, Expand, FileUp, MonitorPlay, Power, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PdfPresenter } from "@/components/pdf-presenter";
import { PptxPresenter } from "@/components/pptx-presenter";
import { countPdfPages } from "@/lib/pdf";
import { DECK_KINDS, deckKind, ensureAnonymousUser, kindFromFileName, makeAccessCode, type Presentation, type PresentationSession } from "@/lib/presentations";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Desktop Presenter | Slide Relay" },
    { name: "description", content: "Upload PowerPoint files and control presentations from a phone." },
    { property: "og:title", content: "Desktop Presenter | Slide Relay" },
    { property: "og:description", content: "Present PowerPoint files and control slides remotely from a phone." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Index,
});

function Index() {
  const [decks, setDecks] = useState<Presentation[]>([]);
  const [sessions, setSessions] = useState<Record<string, PresentationSession>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<Presentation | null>(null);
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [slide, setSlide] = useState(1);
  const [rendererReady, setRendererReady] = useState(false);
  const presenterRef = useRef<HTMLDivElement>(null);
  // Declared here, not in the presenting branch below: hooks called after a conditional
  // return change the hook count between renders and React throws on the next render.
  const handleRendererReady = useCallback(() => setRendererReady(true), []);
  const handleRendererError = useCallback((message: string) => setError(message), []);

  const loadDecks = useCallback(async () => {
    const user = await ensureAnonymousUser();
    const [{ data: presentationRows, error: presentationError }, { data: sessionRows, error: sessionError }] = await Promise.all([
      supabase.from("presentations").select("id,name,storage_path,slide_count,access_code,status").eq("owner_id", user.id).order("created_at", { ascending: false }),
      supabase.from("presentation_sessions").select("id,presentation_id,is_active,remote_enabled,current_slide,controller_id,controller_lease_until,pending_sequence").eq("owner_id", user.id),
    ]);
    if (presentationError || sessionError) throw presentationError ?? sessionError;
    setDecks(presentationRows ?? []);
    setSessions(Object.fromEntries((sessionRows ?? []).map((row) => [row.presentation_id, row])));
  }, []);

  useEffect(() => { void loadDecks().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load presentations")).finally(() => setLoading(false)); }, [loadDecks]);

  useEffect(() => {
    const userId = (Object.values(sessions)[0] as (PresentationSession & { owner_id?: string }) | undefined)?.owner_id;
    const channel = supabase.channel("presenter-sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "presentation_sessions" }, (payload) => {
        const row = payload.new as PresentationSession;
        if (!row?.presentation_id) return;
        setSessions((current) => ({ ...current, [row.presentation_id]: row }));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); void userId; };
  }, []);

  const stopPresentation = useCallback(async () => {
    if (active) await supabase.from("presentation_sessions").update({ is_active: false, remote_enabled: false, controller_id: null, controller_lease_until: null, pending_sequence: null }).eq("presentation_id", active.id);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    setActive(null); setFileData(null); setRendererReady(false);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const session = sessions[active.id];
    if (!session) return;
    const channel = supabase.channel(`commands-${session.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "slide_commands", filter: `session_id=eq.${session.id}` }, (payload) => {
        const command = payload.new as { sequence: number; direction: string };
        setSlide((current) => {
          const next = command.direction === "next" ? Math.min(active.slide_count, current + 1) : Math.max(1, current - 1);
          window.setTimeout(() => { void supabase.rpc("acknowledge_slide_command", { _session_id: session.id, _sequence: command.sequence, _current_slide: next }); }, 80);
          return next;
        });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active, sessions]);

  const moveLocal = useCallback(async (delta: number) => {
    if (!active || !rendererReady) return;
    const next = Math.max(1, Math.min(active.slide_count, slide + delta));
    if (next === slide) return;
    setSlide(next);
    await supabase.from("presentation_sessions").update({ current_slide: next, pending_sequence: null }).eq("presentation_id", active.id);
  }, [active, rendererReady, slide]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") { event.preventDefault(); void moveLocal(1); }
      if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); void moveLocal(-1); }
      if (event.key === "Escape") void stopPresentation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, moveLocal, stopPresentation]);

  async function countSlides(kind: "pptx" | "pdf", buffer: ArrayBuffer) {
    if (kind === "pdf") return countPdfPages(buffer);
    const zip = await JSZip.loadAsync(buffer);
    return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  }

  async function upload(file: File) {
    const kind = kindFromFileName(file.name);
    if (!kind) { setError("Choose a .pptx or .pdf file."); return; }
    setUploading(true); setError("");
    try {
      const user = await ensureAnonymousUser();
      const buffer = await file.arrayBuffer();
      const slideCount = await countSlides(kind, buffer);
      if (slideCount < 1 || slideCount > 500) throw new Error(`The file has no readable ${DECK_KINDS[kind].unit}s or exceeds 500.`);
      const id = crypto.randomUUID();
      const path = `${user.id}/${id}${DECK_KINDS[kind].extension}`;
      const { error: storageError } = await supabase.storage.from("presentations").upload(path, file, { contentType: DECK_KINDS[kind].contentType });
      if (storageError) throw storageError;
      let created: Presentation | null = null;
      for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
        const { data, error: insertError } = await supabase.from("presentations").insert({ id, owner_id: user.id, name: file.name.replace(/\.(pptx|pdf)$/i, ""), storage_path: path, slide_count: slideCount, access_code: makeAccessCode() }).select("id,name,storage_path,slide_count,access_code,status").single();
        if (!insertError) created = data;
        else if (insertError.code !== "23505") throw insertError;
      }
      if (!created) throw new Error("Could not generate a unique access code. Try again.");
      const { error: sessionError } = await supabase.from("presentation_sessions").insert({ presentation_id: created.id, owner_id: user.id });
      if (sessionError) throw sessionError;
      await loadDecks();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  async function present(deck: Presentation) {
    setError(""); setRendererReady(false);
    try {
      await supabase.from("presentation_sessions").update({ is_active: false, remote_enabled: false, controller_id: null, controller_lease_until: null, pending_sequence: null }).neq("presentation_id", deck.id);
      const { data, error: downloadError } = await supabase.storage.from("presentations").download(deck.storage_path);
      if (downloadError) throw downloadError;
      const nextSlide = sessions[deck.id]?.current_slide ?? 1;
      setSlide(nextSlide); setFileData(await data.arrayBuffer()); setActive(deck);
      await supabase.from("presentation_sessions").update({ is_active: true, current_slide: nextSlide }).eq("presentation_id", deck.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open this presentation"); }
  }

  async function remove(deck: Presentation) {
    if (active?.id === deck.id) await stopPresentation();
    await supabase.storage.from("presentations").remove([deck.storage_path]);
    const { error: deleteError } = await supabase.from("presentations").delete().eq("id", deck.id);
    if (deleteError) setError(deleteError.message); else await loadDecks();
  }

  async function setRemote(enabled: boolean) {
    if (!active) return;
    const update = enabled ? { remote_enabled: true } : { remote_enabled: false, controller_id: null, controller_lease_until: null, pending_sequence: null };
    const { error: updateError } = await supabase.from("presentation_sessions").update(update).eq("presentation_id", active.id);
    if (updateError) setError(updateError.message);
  }

  if (active && fileData) {
    const session = sessions[active.id];
    return <main ref={presenterRef} className="presenter-shell">
      <div className="presenter-topbar">
        <div className="min-w-0"><strong className="block truncate">{active.name}</strong><span>{slide} / {active.slide_count}</span></div>
        <div className="presenter-code"><span>REMOTE CODE</span><strong>{active.access_code}</strong></div>
        <label className="remote-toggle"><Switch checked={session?.remote_enabled ?? false} onCheckedChange={(checked) => void setRemote(checked)} /><span>Remote {session?.remote_enabled ? "on" : "off"}</span></label>
        <Button aria-label="Enter fullscreen" title="Enter fullscreen" variant="ghost" size="icon" onClick={() => void presenterRef.current?.requestFullscreen()}><Expand /></Button>
        <Button aria-label="Close presentation" title="Close presentation" variant="ghost" size="icon" onClick={() => void stopPresentation()}><X /></Button>
      </div>
      <section className="presenter-canvas">
        {deckKind(active.storage_path) === "pdf"
          ? <PdfPresenter file={fileData} slide={slide} onReady={handleRendererReady} onError={handleRendererError} />
          : <PptxPresenter file={fileData} slide={slide} onReady={handleRendererReady} onError={handleRendererError} />}
        {!rendererReady && <div className="presenter-loading">Preparing slides…</div>}
      </section>
      <div className="presenter-controls">
        <Button aria-label="Previous slide" title="Previous slide" variant="secondary" size="icon" disabled={!rendererReady || slide <= 1} onClick={() => void moveLocal(-1)}><ChevronLeft /></Button>
        <span>{session?.controller_id ? "Phone connected" : session?.remote_enabled ? "Waiting for phone" : "Local control"}</span>
        <Button aria-label="Next slide" title="Next slide" size="icon" disabled={!rendererReady || slide >= active.slide_count} onClick={() => void moveLocal(1)}><ChevronRight /></Button>
      </div>
      {error && <div className="presenter-error" role="alert">{error}</div>}
    </main>;
  }

  return <main className="operator-shell">
    <header className="operator-header"><div><p className="brand-mark">SLIDE RELAY</p><h1>Desktop presenter</h1><p className="muted-copy">Upload a PowerPoint or PDF, open it, then enable phone control.</p></div><Button asChild variant="outline"><Link to="/remote">Open phone remote</Link></Button></header>
    <section className="upload-band">
      <FileUp aria-hidden="true" />
      <div><strong>Add a PowerPoint or PDF</strong><p>Static slide playback · .pptx or .pdf · up to 20 MB</p></div>
      <label className="ml-auto"><input className="sr-only" type="file" accept=".pptx,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /><span className="upload-button">{uploading ? "Uploading…" : "Choose file"}</span></label>
    </section>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <section aria-labelledby="presentations-title"><div className="section-heading"><h2 id="presentations-title">Presentations</h2><span>{decks.length}</span></div>
      {loading ? <p className="empty-state">Loading presentations…</p> : decks.length === 0 ? <p className="empty-state">No presentations yet. Upload a .pptx or .pdf file to begin.</p> : <div className="deck-list">{decks.map((deck) => { const kind = DECK_KINDS[deckKind(deck.storage_path)]; return <article key={deck.id} className="deck-row"><div className="file-glyph">{kind.label}</div><div className="deck-name"><strong>{deck.name}</strong><span>{deck.slide_count} {kind.unit}{deck.slide_count === 1 ? "" : "s"}</span></div><div className="code-block"><span>Access code</span><strong>{deck.access_code}</strong></div><Button onClick={() => void present(deck)}><MonitorPlay />Present</Button><Button aria-label={`Delete ${deck.name}`} title="Delete presentation" variant="ghost" size="icon" onClick={() => void remove(deck)}><Trash2 /></Button></article>; })}</div>}
    </section>
    <footer className="operator-footer"><Power />Only the presentation open here can receive phone commands.</footer>
  </main>;
}
