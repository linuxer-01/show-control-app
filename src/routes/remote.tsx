import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Lock, LogOut, Unlock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ensureAnonymousUser } from "@/lib/presentations";
import { supabase } from "@/integrations/supabase/client";

type Joined = { session_id: string; presentation_name: string; current_slide: number; slide_count: number; claimed: boolean };
type WakeLockHandle = { release: () => Promise<void> };

export const Route = createFileRoute("/remote")({
  head: () => ({ meta: [
    { title: "Phone Remote | Slide Relay" },
    { name: "description", content: "Use your phone to control an active Slide Relay presentation." },
    { property: "og:title", content: "Phone Remote | Slide Relay" },
    { property: "og:description", content: "Join an active presentation and control its slides from your phone." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: RemotePage,
});

function RemotePage() {
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState<Joined | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Enter the code shown on the presenter screen.");
  const wakeLock = useRef<WakeLockHandle | null>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      const wakeLockApi = (navigator as Navigator & { wakeLock?: { request: (kind: "screen") => Promise<WakeLockHandle> } }).wakeLock;
      if (wakeLockApi && document.visibilityState === "visible") wakeLock.current = await wakeLockApi.request("screen");
    } catch { /* Unsupported or denied; controls remain usable. */ }
  }, []);

  const leave = useCallback(async () => {
    if (joined?.claimed) await supabase.rpc("release_controller", { _session_id: joined.session_id });
    await wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    setJoined(null);
    setBusy(false);
    setLocked(false);
    setMessage("Enter the code shown on the presenter screen.");
  }, [joined]);

  useEffect(() => {
    if (!joined?.claimed) return;
    const heartbeat = window.setInterval(async () => {
      const { data } = await supabase.rpc("renew_controller", { _session_id: joined.session_id });
      if (!data) void leave();
    }, 8_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void requestWakeLock(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(heartbeat); document.removeEventListener("visibilitychange", onVisibility); };
  }, [joined, leave, requestWakeLock]);

  useEffect(() => {
    if (!joined?.claimed) return;
    const channel = supabase.channel(`remote-${joined.session_id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "presentation_sessions", filter: `id=eq.${joined.session_id}` }, (payload) => {
        const row = payload.new as { current_slide: number; pending_sequence: number | null; remote_enabled: boolean; is_active: boolean; controller_id: string | null };
        if (!row.is_active || !row.remote_enabled || !row.controller_id) { void leave(); return; }
        setJoined((value) => value ? { ...value, current_slide: row.current_slide } : value);
        if (row.pending_sequence === null) setBusy(false);
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [joined?.claimed, joined?.session_id, leave]);

  async function join(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await ensureAnonymousUser();
      const { data, error } = await supabase.rpc("join_presentation", { _code: code.trim().toUpperCase() });
      if (error) throw error;
      const result = data[0];
      if (!result) throw new Error("Presentation not found");
      setJoined(result);
      setMessage(result.claimed ? "Connected" : "Another phone currently has control.");
      if (result.claimed) await requestWakeLock();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join this presentation");
    } finally { setBusy(false); }
  }

  async function move(direction: "previous" | "next") {
    if (!joined?.claimed || locked || busy) return;
    if ((direction === "previous" && joined.current_slide <= 1) || (direction === "next" && joined.current_slide >= joined.slide_count)) return;
    setBusy(true);
    setMessage("Changing slide…");
    const { error } = await supabase.rpc("submit_slide_command", { _session_id: joined.session_id, _direction: direction });
    if (error) { setBusy(false); setMessage(error.message); }
    else setMessage("Waiting for presenter…");
  }

  if (!joined) return (
    <main className="remote-shell">
      <section className="remote-join">
        <div><p className="brand-mark">SLIDE RELAY</p><h1>Phone remote</h1><p className="muted-copy">{message}</p></div>
        <form onSubmit={join} className="space-y-4">
          <Input aria-label="Presentation code" inputMode="text" autoCapitalize="characters" autoComplete="off" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} placeholder="ABC123" className="h-16 text-center font-mono text-3xl uppercase tracking-widest" />
          <Button type="submit" disabled={busy || code.length !== 6} className="h-14 w-full text-base">{busy ? "Joining…" : "Join presentation"}</Button>
        </form>
        <Button asChild variant="ghost" className="self-center"><Link to="/">Presenter setup</Link></Button>
      </section>
    </main>
  );

  return (
    <main className="remote-shell">
      <section className="remote-control">
        <header className="flex items-start justify-between gap-3"><div><p className="brand-mark">{joined.claimed ? "CONNECTED" : "CONTROL BUSY"}</p><h1 className="text-2xl font-semibold">{joined.presentation_name}</h1></div><Button aria-label="Leave presentation" title="Leave presentation" variant="ghost" size="icon" onClick={() => void leave()}><LogOut /></Button></header>
        {joined.claimed ? <>
          <div className="slide-counter"><strong>{joined.current_slide}</strong><span>of {joined.slide_count}</span></div>
          <div className="remote-buttons" aria-disabled={locked || busy}>
            <Button aria-label="Previous slide" title="Previous slide" variant="secondary" disabled={locked || busy || joined.current_slide <= 1} onClick={() => void move("previous")}><ArrowLeft /><span>Previous</span></Button>
            <Button aria-label="Next slide" title="Next slide" disabled={locked || busy || joined.current_slide >= joined.slide_count} onClick={() => void move("next")}><span>Next</span><ArrowRight /></Button>
          </div>
          <p className="remote-status" role="status">{locked ? "Controls locked" : message}</p>
          <Button variant={locked ? "default" : "outline"} className="h-14 w-full" onClick={() => setLocked((value) => !value)}>{locked ? <Unlock /> : <Lock />}{locked ? "Unlock controls" : "Lock controls"}</Button>
        </> : <div className="busy-state"><Lock /><p>Another phone has control. Leave and try again after they disconnect.</p></div>}
      </section>
    </main>
  );
}