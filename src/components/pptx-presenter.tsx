import { useEffect, useRef } from "react";

type Previewer = {
  preview: (file: ArrayBuffer) => Promise<unknown>;
  renderSingleSlide: (index: number) => void;
  destroy: () => void;
};

type Props = {
  file: ArrayBuffer;
  slide: number;
  onReady: () => void;
  onError: (message: string) => void;
};

export function PptxPresenter({ file, slide, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<Previewer | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    void import("pptx-preview")
      .then(async ({ init }) => {
        if (cancelled) return;
        const previewer = init(host, { mode: "slide", width: 1280, height: 720 });
        previewerRef.current = previewer;
        await previewer.preview(file);
        if (!cancelled) {
          previewer.renderSingleSlide(slide - 1);
          onReady();
        }
      })
      .catch((error: unknown) => onError(error instanceof Error ? error.message : "This file could not be displayed"));
    return () => {
      cancelled = true;
      previewerRef.current?.destroy();
      previewerRef.current = null;
      host.replaceChildren();
    };
  }, [file, onError, onReady]);

  useEffect(() => {
    previewerRef.current?.renderSingleSlide(slide - 1);
  }, [slide]);

  return <div ref={hostRef} className="pptx-stage" aria-label="PowerPoint slide" />;
}