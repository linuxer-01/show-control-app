import { useEffect, useRef } from "react";
import { fitFrameToStage, RENDER_WIDTH, type SlideRendererProps } from "./slide-stage";

type Previewer = {
  preview: (file: ArrayBuffer) => Promise<unknown>;
  renderSingleSlide: (index: number) => void;
  destroy: () => void;
};

const DEFAULT_RATIO = 9 / 16;

// pptx-preview derives its scale from options.width alone, so options.height has to
// match the deck's own aspect ratio or every slide overflows the wrapper it renders into.
async function readSlideRatio(file: ArrayBuffer) {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(file);
    const xml = await zip.file("ppt/presentation.xml")?.async("text");
    const size = xml?.match(/<p:sldSz\b[^>]*>/)?.[0];
    const cx = Number(size?.match(/\bcx="(\d+)"/)?.[1]);
    const cy = Number(size?.match(/\bcy="(\d+)"/)?.[1]);
    return cx > 0 && cy > 0 ? cy / cx : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}

export function PptxPresenter({ file, slide, onReady, onError }: SlideRendererProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<Previewer | null>(null);
  const loadedRef = useRef(false);
  const slideRef = useRef(slide);
  const handlersRef = useRef({ onReady, onError });

  // Read the handlers through a ref so the loader below depends on `file` only; a re-run
  // would tear down the renderer and re-parse the whole deck mid-presentation.
  useEffect(() => {
    handlersRef.current = { onReady, onError };
  }, [onReady, onError]);

  useEffect(() => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return;
    let cancelled = false;
    let releaseStage: (() => void) | undefined;
    loadedRef.current = false;

    void (async () => {
      try {
        const height = Math.round(RENDER_WIDTH * (await readSlideRatio(file)));
        if (cancelled) return;
        releaseStage = fitFrameToStage(stage, frame, height);

        const { init } = await import("pptx-preview");
        if (cancelled) return;
        const previewer: Previewer = init(frame, { mode: "slide", width: RENDER_WIDTH, height });
        previewerRef.current = previewer;
        await previewer.preview(file);
        if (cancelled) return;
        // preview() already rendered slide 0; only redraw when resuming elsewhere.
        if (slideRef.current !== 1) previewer.renderSingleSlide(slideRef.current - 1);
        loadedRef.current = true;
        handlersRef.current.onReady();
      } catch (error) {
        if (!cancelled) {
          handlersRef.current.onError(
            error instanceof Error ? error.message : "This file could not be displayed",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      loadedRef.current = false;
      releaseStage?.();
      previewerRef.current?.destroy();
      previewerRef.current = null;
      frame.replaceChildren();
    };
  }, [file]);

  useEffect(() => {
    slideRef.current = slide;
    // renderSingleSlide() dereferences an internal renderer that only exists once
    // preview() has resolved, so commands arriving mid-load are dropped, not crashed on.
    if (loadedRef.current) previewerRef.current?.renderSingleSlide(slide - 1);
  }, [slide]);

  return (
    <div ref={stageRef} className="slide-stage" aria-label="PowerPoint slide">
      <div ref={frameRef} className="slide-frame pptx-frame" />
    </div>
  );
}
