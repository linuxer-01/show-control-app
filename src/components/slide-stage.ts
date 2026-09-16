export type SlideRendererProps = {
  file: ArrayBuffer;
  slide: number;
  onReady: () => void;
  onError: (message: string) => void;
};

/** Both renderers draw at this fixed width and let `fitFrameToStage` scale the result. */
export const RENDER_WIDTH = 1280;

/**
 * Sizes `frame` to the deck's native aspect ratio, then keeps it scaled to fit inside
 * `stage` as the window resizes. Returns a disposer.
 */
export function fitFrameToStage(stage: HTMLElement, frame: HTMLElement, height: number) {
  frame.style.width = `${RENDER_WIDTH}px`;
  frame.style.height = `${height}px`;
  const fit = () => {
    const scale = Math.min(stage.clientWidth / RENDER_WIDTH, stage.clientHeight / height);
    frame.style.transform = `scale(${scale > 0 ? scale : 1})`;
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(stage);
  return () => observer.disconnect();
}
