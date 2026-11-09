"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { CopyIcon, DownloadIcon, FileTextIcon, LanguagesIcon, PrinterIcon } from "lucide-react";
import {
  diagramSources,
  documentHtmlFile,
  documentTemplate,
  parseDocument,
  renderDocument,
  type DocumentDiagram,
  type DocumentTheme,
  type RenderedDocument,
} from "@/app/lib/documentation";
import { DOC_LANGUAGES, documentLanguage, setVersion, splitVersions, type DocLang } from "@/app/lib/document-i18n";
import type { Schema } from "@/app/lib/schema";
import { rebaseText } from "@/app/lib/text-merge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DocumentEditor } from "./document-editor/document-editor";
import { editorStrings } from "./document-editor/editor-i18n";
import { documentToPng, documentToSvg, printDocumentFile } from "./document-export";
import { renderMermaidDiagram } from "./mermaid-render";


/** How long typing pauses before the text is committed to the diagram, and before the preview redraws. */
const COMMIT_DELAY = 600;
const RENDER_DELAY = 300;

/** A placeholder figure for a Mermaid block that does not parse, so one typo does not blank the page; drawn in the page's own danger colour. */
const errorDiagram = (message: string): DocumentDiagram => ({
  markup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 44"><text x="12" y="27" font-family="ui-monospace, monospace" font-size="13" style="fill:var(--bad)">${message.replace(/&/g, "&amp;").replace(/</g, "&lt;").slice(0, 110)}</text></svg>`,
  width: 720,
  height: 44,
});

export function DocumentTab({
  schema,
  readOnly,
  fileBase,
  save,
  onDocumentationChange,
}: {
  schema: Schema;
  readOnly: boolean;
  fileBase: string;
  save: (blob: Blob, name: string) => void;
  onDocumentationChange: (update: (current: string) => string) => void;
}) {
  // The page starts in the app's own appearance (System/Light/Dark in the account menu); the switch changes it, exports included.
  const { resolvedTheme } = useTheme();
  const [chosenTheme, setChosenTheme] = useState<DocumentTheme | null>(null);
  const theme: DocumentTheme = chosenTheme ?? (resolvedTheme === "dark" ? "dark" : "light");
  const [draft, setDraft] = useState(schema.documentation ?? "");
  // A diagram with no document yet opens on one written from its tables. It is not saved until it is
  // edited, so until then it follows the diagram: add a table and its section appears.
  const [auto, setAuto] = useState(() => !(schema.documentation ?? "").trim());
  const [rendered, setRendered] = useState<RenderedDocument | null>(null);
  const [busy, setBusy] = useState(false);
  // The language on screen. Each has its own version of the text; switching shows it, and never rewrites another.
  const [lang, setLang] = useState<DocLang>(() => documentLanguage(schema.documentation ?? ""));

  /*
   * Typed text waits in `latest` until a pause. `base` is the document it was
   * typed onto: a collaborator's edit arriving meanwhile is not shown (it would
   * reset the editor under the cursor), and the flush merges the typing onto it
   * rather than over it.
   */
  const pending = useRef<number | null>(null);
  const latest = useRef(draft);
  const base = useRef(draft);
  const commitRef = useRef(onDocumentationChange);
  commitRef.current = onDocumentationChange;
  useEffect(() => {
    if (pending.current !== null) return;
    base.current = schema.documentation ?? "";
    if (base.current !== latest.current) { latest.current = base.current; setDraft(base.current); }
  }, [schema.documentation]);
  const flush = () => {
    if (pending.current === null) return;
    window.clearTimeout(pending.current);
    pending.current = null;
    commitRef.current((current) => {
      const { text, conflict } = rebaseText(base.current, latest.current, current);
      if (conflict) toast.warning("A collaborator edited the same passage. Your version was kept.");
      if (text !== latest.current) setDraft(text);
      base.current = latest.current = text;
      return text;
    });
  };
  useEffect(() => flush, []);

  const edit = (text: string) => {
    setAuto(false);
    latest.current = text;
    setDraft(text);
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(flush, COMMIT_DELAY);
  };

  const shown = useMemo(
    () => (auto && !draft.trim() ? setVersion("", lang, documentTemplate(schema, lang)) : draft),
    [auto, draft, lang, schema],
  );

  // Diagrams are the slow part, so each is drawn once per theme and source and kept.
  const cache = useRef(new Map<string, DocumentDiagram>());
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(async () => {
      const blocks = parseDocument(splitVersions(shown).texts[lang] ?? "");
      const diagrams = new Map<string, DocumentDiagram>();
      for (const source of diagramSources(schema, blocks)) {
        const key = `${theme}\u0000${source}`;
        if (!cache.current.has(key)) {
          cache.current.set(key, await renderMermaidDiagram(source, theme).catch((error: unknown) =>
            errorDiagram(`Mermaid: ${error instanceof Error ? error.message.split("\n")[0] : "could not draw this diagram"}`)));
        }
        diagrams.set(source, cache.current.get(key)!);
      }
      if (current) setRendered(renderDocument(schema, shown, { theme, diagrams, lang, generatedAt: new Date().toLocaleDateString("uz-UZ") }));
    }, RENDER_DELAY);
    return () => { current = false; window.clearTimeout(timer); };
  }, [shown, lang, schema, theme]);

  const run = async (task: () => Promise<void> | void) => {
    if (!rendered) return;
    setBusy(true);
    try { await task(); } catch (error) { toast.error(error instanceof Error ? error.message : "Export failed."); } finally { setBusy(false); }
  };
  const downloadHtml = () => run(() => save(new Blob([documentHtmlFile(rendered!)], { type: "text/html" }), `${fileBase}-document.html`));
  const downloadPng = () => run(async () => {
    try { save(await documentToPng(rendered!), `${fileBase}-document.png`); }
    catch { throw new Error("This browser could not draw the PNG. Download HTML or PDF instead."); }
  });
  const printPdf = () => run(() => printDocumentFile(documentHtmlFile(rendered!)));
  const downloadSvg = () => run(async () => save(new Blob([(await documentToSvg(rendered!)).svg], { type: "image/svg+xml" }), `${fileBase}-document.svg`));

  const versions = splitVersions(shown);
  const exists = versions.texts[lang] !== undefined;
  const body = versions.texts[lang] ?? "";
  const words = editorStrings(lang);
  const empty = !body.trim();
  /** The version a missing one is copied from: the first that has text. */
  const from = versions.order.find((other) => other !== lang && versions.texts[other]?.trim());
  const name = (id: DocLang) => DOC_LANGUAGES.find((language) => language.id === id)!.label;
  const writeVersion = (text: string) => edit(setVersion(latest.current, lang, text));

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            className="segmented"
            aria-label="Document theme"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[theme]}
            onSelectionChange={(keys) => {
              const [key] = [...keys];
              if (key) setChosenTheme(key as DocumentTheme);
            }}
          >
            <ToggleGroupItem id="light">Light</ToggleGroupItem>
            <ToggleGroupItem id="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            className="segmented"
            aria-label="Document language"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[lang]}
            onSelectionChange={(keys) => {
              const [key] = [...keys];
              if (key && key !== lang) { flush(); setLang(key as DocLang); }
            }}
          >
            {DOC_LANGUAGES.map((language) => (
              <ToggleGroupItem key={language.id} id={language.id} aria-label={language.label}>{language.short}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" isDisabled={!rendered || empty || busy} onClick={downloadHtml}>
            <DownloadIcon data-icon="inline-start" />
            HTML
          </Button>
          <Button variant="outline" size="sm" isDisabled={!rendered || empty || busy} onClick={printPdf}>
            <PrinterIcon data-icon="inline-start" />
            PDF
          </Button>
          <Button variant="outline" size="sm" isDisabled={!rendered || empty || busy} onClick={downloadSvg}>
            <DownloadIcon data-icon="inline-start" />
            SVG
          </Button>
          <Button variant="outline" size="sm" isDisabled={!rendered || empty || busy} onClick={downloadPng}>
            <DownloadIcon data-icon="inline-start" />
            {busy ? "Rendering…" : "PNG"}
          </Button>
        </div>
      </div>

      {/* The editor draws the page as it exports, so there is no separate preview. */}
      {!exists && from ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <LanguagesIcon className="size-8 text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">{words.versions.missing}</p>
          {!readOnly && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => writeVersion(versions.texts[from] ?? "")}>
                <CopyIcon data-icon="inline-start" />
                {words.versions.copy(name(from))}
              </Button>
              <Button size="sm" variant="outline" onClick={() => writeVersion(documentTemplate(schema, lang))}>
                {words.start}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          {empty && !readOnly && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm">
              <FileTextIcon className="size-5 shrink-0 text-muted-foreground" />
              <p className="flex-1 text-muted-foreground">{words.banner}</p>
              <Button size="sm" onClick={() => writeVersion(documentTemplate(schema, lang))}>{words.start}</Button>
            </div>
          )}
          <DocumentEditor key={lang} value={body} onChange={writeVersion} schema={schema} theme={theme} readOnly={readOnly} lang={lang} />
        </>
      )}
    </div>
  );
}
