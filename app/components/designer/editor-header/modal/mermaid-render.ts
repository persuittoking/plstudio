import type { DiagramTheme } from "../../diagram-svg";
import type { DocumentDiagram } from "@/app/lib/documentation";
import { PALETTE } from "@/app/lib/schema";

/**
 * Render Mermaid text (a flowchart the user wrote, say) to an
 * SVG the document can embed, in the browser.
 * Mermaid is large, so it is imported on first use rather than shipped with the
 * editor.
 *
 * Labels are SVG text rather than HTML in a `foreignObject` (`htmlLabels:
 * false`), which would otherwise taint the canvas `svgToPng` draws on. The root
 * keeps only its `viewBox`: the document gives it a position and size.
 */
/** The document's colours, so a flowchart sits in the page like the canvas cards do. */
const FLOW_COLORS = {
  light: { page: "#ffffff", card: "#f6f8fa", border: "#c5d0db", text: "#1f2328", line: "#0969da", label: "#59636e" },
  dark: { page: "#0d1117", card: "#161b22", border: "#3d4b5c", text: "#e6edf3", line: "#58a6ff", label: "#8b949e" },
} as const;

const config = (theme: DiagramTheme) => {
  const colors = FLOW_COLORS[theme];
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "base" as const,
    // "neo", Mermaid 12's default, draws every box with a heavy shadow.
    look: "classic" as const,
    htmlLabels: false,
    fontFamily: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
    // Right angles with rounded corners, like the canvas's relationship lines; wide enough that an identifier is never cut.
    flowchart: { curve: "rounded" as const, wrappingWidth: 420, nodeSpacing: 36, rankSpacing: 46, padding: 14, diagramPadding: 12 },
    themeVariables: {
      fontSize: "13px", background: colors.page, primaryColor: colors.card, primaryBorderColor: colors.border, primaryTextColor: colors.text,
      lineColor: colors.line, edgeLabelBackground: colors.page, tertiaryColor: colors.card, clusterBkg: colors.card, clusterBorder: colors.border,
    },
    themeCSS: `
      .node rect, .node polygon, .node circle, .node path { stroke-width: 1.2px; }
      .node rect { rx: 8px; ry: 8px; }
      .node text, .nodeLabel { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 600; }
      .flowchart-link { stroke-width: 1.6px; }
      .edgeLabel, .edgeLabel text, .edgeLabel tspan { font-size: 11px; fill: ${colors.label}; color: ${colors.label}; }
      .marker { fill: ${colors.line}; stroke: ${colors.line}; }
    `,
  };
};

const SVG = "http://www.w3.org/2000/svg";

/** Gives each flowchart box the coloured top strip a canvas table card has, from the same palette, in turn. */
function addCardStrips(doc: Document, id: string) {
  doc.querySelectorAll("g.node").forEach((node, index) => {
    const box = node.querySelector("rect");
    if (!box) return;
    const [x, y, width] = ["x", "y", "width"].map((name) => Number(box.getAttribute(name)));
    if (![x, y, width].every(Number.isFinite) || !width) return;
    const clip = doc.createElementNS(SVG, "clipPath");
    clip.setAttribute("id", `${id}-card-${index}`);
    clip.append(box.cloneNode());
    const strip = doc.createElementNS(SVG, "rect");
    // A style, not attributes: Mermaid's own `.node rect` rule would repaint attributes in the card's colours.
    Object.entries({ x, y, width, height: 4, class: "card-strip", style: `fill:${PALETTE[index % PALETTE.length].a};stroke:none`, "clip-path": `url(#${id}-card-${index})` })
      .forEach(([name, value]) => strip.setAttribute(name, String(value)));
    box.after(clip, strip);
  });
}

let renders = 0;
/** Mermaid keeps one global config, so renders are serialized: a theme switch mid-render must not leak into it. */
let queue: Promise<unknown> = Promise.resolve();

export function renderMermaidDiagram(source: string, theme: DiagramTheme): Promise<DocumentDiagram> {
  const run = async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize(config(theme));
    const id = `doc-diagram-${++renders}`;
    const { svg } = await mermaid.render(id, source);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    if (/^\s*(flowchart|graph)\b/.test(source)) addCardStrips(doc, id);
    const [, , width, height] = (root.getAttribute("viewBox") ?? "0 0 800 600").split(/[\s,]+/).map(Number);
    ["width", "height", "style"].forEach((name) => root.removeAttribute(name));
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return { markup: new XMLSerializer().serializeToString(doc), width, height };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
