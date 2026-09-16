/** Loads pdf.js and its worker on first use so the operator page does not pay for it upfront. */
export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (
      await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ).default;
  }
  return pdfjs;
}

/**
 * pdf.js transfers the buffer it is handed to its worker, which detaches it. The presenter
 * keeps one buffer for the life of the presentation, so every reader gets its own copy.
 */
export async function openPdf(file: ArrayBuffer) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: file.slice(0) }).promise;
}

export async function countPdfPages(file: ArrayBuffer) {
  const document = await openPdf(file);
  try {
    return document.numPages;
  } finally {
    void document.loadingTask.destroy();
  }
}
