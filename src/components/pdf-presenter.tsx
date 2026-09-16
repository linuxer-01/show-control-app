import { useCallback, useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { openPdf } from "@/lib/pdf";
import { fitFrameToStage, RENDER_WIDTH, type SlideRendererProps } from "./slide-stage";

const DEFAULT_RATIO = 9 / 16;
// The frame is often scaled up past 1280 CSS px on large displays, so draw at 2x to stay sharp.
const MAX_PIXEL_RATIO = 2;

export function PdfPresenter({ file, slide, onReady, onError }: SlideRendererProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const frameHeightRef = useRef(Math.round(RENDER_WIDTH * DEFAULT_RATIO));
  const slideRef = useRef(slide);
  const handlersRef = useRef({ onReady, onError });

  useEffect(() => {
    handlersRef.current = { onReady, onError };
  }, [onReady, onError]);

  const renderPage = useCallback(async (page: number) => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    // A fast operator can outrun a render; drop the in-flight one rather than queue it.
    taskRef.current?.cancel();

    const pdfPage = await doc.getPage(Math.min(Math.max(page, 1), doc.numPages));
    const unscaled = pdfPage.getViewport({ scale: 1 });
    // Pages in one file can differ in size or orientation, so fit each into the same box.
    const fit = Math.min(RENDER_WIDTH / unscaled.width, frameHeightRef.current / unscaled.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const viewport = pdfPage.getViewport({ scale: fit * pixelRatio });

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.style.width = `${viewport.width / pixelRatio}px`;
    canvas.style.height = `${viewport.height / pixelRatio}px`;

    const task = pdfPage.render({ canvas, viewport });
    taskRef.current = task;
    try {
      await task.promise;
    } catch (error) {
      // cancel() rejects the previous task; that is the expected path, not a failure.
      if ((error as { name?: string })?.name !== "RenderingCancelledException") throw error;
    } finally {
      if (taskRef.current === task) taskRef.current = null;
    }
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return;
    let cancelled = false;
    let releaseStage: (() => void) | undefined;

    void (async () => {
      try {
        const doc = await openPdf(file);
        if (cancelled) {
          void doc.loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        const first = await doc.getPage(1);
        const { width, height } = first.getViewport({ scale: 1 });
        frameHeightRef.current = Math.round(RENDER_WIDTH * (height / width));
        releaseStage = fitFrameToStage(stage, frame, frameHeightRef.current);
        await renderPage(slideRef.current);
        if (cancelled) return;
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
      releaseStage?.();
      taskRef.current?.cancel();
      taskRef.current = null;
      void docRef.current?.loadingTask.destroy();
      docRef.current = null;
    };
  }, [file, renderPage]);

  useEffect(() => {
    slideRef.current = slide;
    if (!docRef.current) return;
    renderPage(slide).catch((error: unknown) =>
      handlersRef.current.onError(
        error instanceof Error ? error.message : "This page could not be displayed",
      ),
    );
  }, [slide, renderPage]);

  return (
    <div ref={stageRef} className="slide-stage" aria-label="PDF page">
      <div ref={frameRef} className="slide-frame pdf-frame">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
