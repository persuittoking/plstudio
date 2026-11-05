import { documentHtmlFile, type RenderedDocument } from "@/app/lib/documentation";

/**
 * The width a document is laid out at for the SVG and the PNG. Wider than the
 * 860px reading column of the HTML and PDF: a picture is looked at, often on a
 * wide screen, and the ER diagram and the tables get the room to be read.
 */
export const DOCUMENT_IMAGE_WIDTH = 1400;

/** The page let out to the image's width. */
const wide = (rendered: RenderedDocument): RenderedDocument => ({ ...rendered, css: `${rendered.css}\n.doc .page{max-width:none}` });

/** The page's full height at `width`, laid out by the browser in a throwaway frame. */
function measureHeight(file: string, width: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: `${width}px`, height: "100px", border: "0", visibility: "hidden" });
    frame.onload = () => {
      const height = frame.contentDocument?.documentElement.scrollHeight ?? 0;
      frame.remove();
      return height ? resolve(height) : reject(new Error("Could not lay out the document."));
    };
    frame.srcdoc = file;
    document.body.append(frame);
  });
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * The document as one SVG file: the page laid out at `width`, inside a
 * `foreignObject`. Browsers open it as the page it is; editors that draw SVG
 * without HTML (Inkscape, Illustrator) do not, which is what the PNG is for.
 */
export async function documentToSvg(page: RenderedDocument, width = DOCUMENT_IMAGE_WIDTH): Promise<{ svg: string; width: number; height: number }> {
  const rendered = wide(page);
  const height = await measureHeight(documentHtmlFile(rendered), width);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<foreignObject x="0" y="0" width="${width}" height="${height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml"><style>${escapeXml(rendered.css)}</style>${rendered.body}</div>`,
    `</foreignObject></svg>`,
  ].join("");
  return { svg, width, height };
}

/**
 * The document as a PNG: its HTML inside an SVG `foreignObject`, rasterized.
 * Everything it draws is inline -- styles, and diagrams as SVG -- so there is
 * no outside resource to taint the canvas.
 */
export async function documentToPng(rendered: RenderedDocument, width = DOCUMENT_IMAGE_WIDTH): Promise<Blob> {
  const { svg, height } = await documentToSvg(rendered, width);
  return rasterize(svg, width, height, 2);
}

/**
 * Like `svgToPng`, but loaded from a data URL: Chrome taints a canvas that draws
 * a `foreignObject` SVG from a blob URL, and does not for the same bytes inline.
 */
async function rasterize(svg: string, width: number, height: number, scale: number): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const fitted = Math.min(scale, 16_384 / width, 16_384 / height, Math.sqrt((16_384 * 16_384) / 4 / (width * height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * fitted));
  canvas.height = Math.max(1, Math.floor(height * fitted));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The document is too large to render as a PNG."))), "image/png"));
}

/**
 * Prints the document through the browser's dialog, where "Save as PDF" is one
 * of the printers. It prints from a frame of its own, so neither the editor
 * around it nor the preview's scroll position ends up on the page.
 */
export function printDocumentFile(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    frame.onload = () => {
      const target = frame.contentWindow;
      if (!target) return reject(new Error("Could not open the print dialog."));
      target.addEventListener("afterprint", () => window.setTimeout(() => frame.remove(), 0), { once: true });
      target.focus();
      target.print();
      resolve();
    };
    frame.srcdoc = file;
    document.body.append(frame);
  });
}
