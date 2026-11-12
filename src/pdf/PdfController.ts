import * as pdfjs from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = worker;

export class PdfController {
  document: PDFDocumentProxy | null = null;
  private task: RenderTask | null = null;
  private loading: ReturnType<typeof pdfjs.getDocument> | null = null;
  private version = 0;
  private renderVersion = 0;
  async load(data: Uint8Array) {
    const version = ++this.version;
    this.renderVersion++;
    this.task?.cancel();
    this.task = null;
    const previous = this.loading;
    this.loading = null;
    this.document = null;
    await previous?.destroy();
    if (version !== this.version) return 0;
    const options = {
      data,
      cMapUrl: '/pdf-assets/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdf-assets/standard_fonts/',
      wasmUrl: '/pdf-assets/wasm/',
      isEvalSupported: false,
    };
    const loading = pdfjs.getDocument(options);
    this.loading = loading;
    const document = await loading.promise;
    if (version !== this.version) {
      await loading.destroy();
      return 0;
    }
    this.document = document;
    return document.numPages;
  }
  async render(canvas: HTMLCanvasElement, pageNumber: number, width: number, height: number) {
    const document = this.document;
    if (!document) return;
    const version = ++this.renderVersion;
    const previous = this.task;
    previous?.cancel();
    try {
      await previous?.promise;
    } catch {
      /* expected cancellation */
    }
    if (version !== this.renderVersion || document !== this.document) return;
    const page = await document.getPage(pageNumber);
    if (version !== this.renderVersion || document !== this.document) return;
    const natural = page.getViewport({ scale: 1 });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(width / natural.width, height / natural.height);
    const viewport = page.getViewport({ scale: scale * ratio });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${viewport.width / ratio}px`;
    canvas.style.height = `${viewport.height / ratio}px`;
    this.task = page.render({ canvas, viewport });
    try {
      await this.task.promise;
    } catch (e) {
      if ((e as Error).name !== 'RenderingCancelledException') throw e;
    }
  }
  async dispose() {
    this.version++;
    this.renderVersion++;
    this.task?.cancel();
    this.task = null;
    const loading = this.loading;
    this.loading = null;
    this.document = null;
    await loading?.destroy();
  }
}
