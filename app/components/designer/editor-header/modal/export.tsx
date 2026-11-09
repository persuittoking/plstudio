"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, DownloadIcon, FolderOpenIcon, XIcon } from "lucide-react";
import { generateDDL, generateDML, generateMermaidER } from "@/app/lib/generators";
import { generateMigration } from "@/app/lib/migration";
import { parseCreateTable } from "@/app/lib/parser";
import { exportSchemaJson, parseSchemaJson } from "@/app/lib/schema-json";
import { draftDocument } from "@/app/lib/document-draft";
import { renderDiagramSVG, type DiagramTheme } from "../../diagram-svg";
import { generatePostgres } from "@/app/lib/postgres";
import { svgToPng } from "./svg-to-png";
import type { Schema } from "@/app/lib/schema";
import type { ValidationIssue } from "@/app/lib/validation";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { highlightJson, highlightMermaid, highlightSql } from "../../highlight";

// The Document tab carries the rich-text editor and its highlighters: they load when it is first opened, not with every export.
const DocumentTab = dynamic(() => import("./document-tab").then((module) => module.DocumentTab), { ssr: false });

export type ExportTab = "ddl" | "postgres" | "dml" | "migration" | "mermaid" | "json" | "image" | "document";

/**
 * What a migration is generated *from*: the database as it stands, which the
 * diagram cannot know. It comes from a file (a JSON export or the DDL it was
 * built with) or from a saved version.
 */
export type MigrationBaseline = { schema: Schema; label: string; warnings: string[] };

const exportTabs = [
  ["ddl", "DDL"],
  ["postgres", "PostgreSQL"],
  ["dml", "DML"],
  ["migration", "Migration"],
  ["mermaid", "Mermaid"],
  ["json", "JSON"],
  ["image", "Image"],
  ["document", "Document"],
] as const satisfies ReadonlyArray<readonly [ExportTab, string]>;

/** `file.text()` resolves eagerly, so a huge file would freeze the tab first. */
const MAX_BASELINE_BYTES = 5_000_000;

/** A file the user keeps, so it is named after the diagram rather than "schema (3).json". */
const fileSlug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schema";

export const ExportModal = ({
  isOpen,
  onOpenChange,
  schema,
  errors,
  onClearInvalidForeignKeys,
  exportTab,
  onExportTabChange: setExportTab,
  baseline,
  onBaselineChange,
  readOnly,
  onDocumentationChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  schema: Schema;
  errors: ValidationIssue[];
  onClearInvalidForeignKeys: () => void;
  /** Lifted, so Version history can open this straight onto a migration. */
  exportTab: ExportTab;
  onExportTabChange: (tab: ExportTab) => void;
  baseline: MigrationBaseline | null;
  onBaselineChange: (baseline: MigrationBaseline | null) => void;
  readOnly: boolean;
  /** Rewrites the document from the text it holds now, so an edit can be merged onto a collaborator's. */
  onDocumentationChange: (update: (current: string) => string) => void;
}) => {
  const [copied, setCopied] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageTheme, setImageTheme] = useState<DiagramTheme>("light");
  const [rendering, setRendering] = useState(false);
  const ddl = useMemo(
    () => (isOpen && exportTab === "ddl" ? generateDDL(schema) : ""),
    [exportTab, isOpen, schema],
  );
  const postgresResult = useMemo(
    () => (isOpen && exportTab === "postgres" ? generatePostgres(schema) : null),
    [exportTab, isOpen, schema],
  );
  const postgres = postgresResult?.sql ?? "";
  /*
   * What PostgreSQL would refuse or read differently, each with its fix -- the
   * PostgreSQL tab's version of the Oracle tab's "Export blocked" alert. The
   * script is still written (the offending line as a comment), so it warns rather than blocks.
   */
  const postgresProblems = (postgresResult?.notes ?? []).filter((note) => note.level === "warning");
  const dml = useMemo(
    () => (isOpen && exportTab === "dml" ? generateDML(schema) : ""),
    [exportTab, isOpen, schema],
  );
  const mermaid = useMemo(
    () => (isOpen && exportTab === "mermaid" ? generateMermaidER(schema) : ""),
    [exportTab, isOpen, schema],
  );
  const json = useMemo(
    () => (isOpen && exportTab === "json" ? exportSchemaJson(schema) : ""),
    [exportTab, isOpen, schema],
  );
  const migration = useMemo(
    () => (isOpen && exportTab === "migration" && baseline ? generateMigration(baseline.schema, schema) : null),
    [baseline, exportTab, isOpen, schema],
  );
  const svg = useMemo(
    () => (isOpen && exportTab === "image" ? renderDiagramSVG(schema, { theme: imageTheme, edges: "straight" }) : ""),
    [exportTab, imageTheme, isOpen, schema],
  );
  const isDocument = exportTab === "document";
  const isPostgres = exportTab === "postgres";
  const isJson = exportTab === "json";
  const isMigration = exportTab === "migration";
  const isImage = exportTab === "image";
  const isMermaid = exportTab === "mermaid";
  const output =
    exportTab === "ddl"
      ? ddl
      : isPostgres
        ? postgres
      : exportTab === "dml"
        ? dml
        : exportTab === "mermaid"
          ? mermaid
          : isMigration
            ? (migration?.sql ?? "")
            : isImage
              ? svg
              : isDocument
                ? (schema.documentation?.trim() ? schema.documentation : draftDocument(schema))
                : json;

  const openBaseline = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared first, or picking the same file twice in a row fires no change event.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BASELINE_BYTES) {
      setBaselineError(`${file.name} is too large (max 5 MB).`);
      return;
    }
    const text = await file.text();
    const parsed = text.trimStart().startsWith("{") ? parseSchemaJson(text) : parseCreateTable(text);
    if (!parsed.schema || parsed.errors.length) {
      setBaselineError(parsed.errors[0] ?? `${file.name} holds no tables.`);
      return;
    }
    setBaselineError(null);
    onBaselineChange({ schema: parsed.schema, label: file.name, warnings: parsed.warnings });
  };
  const reviewNotes = [...(baseline?.warnings ?? []), ...(migration?.warnings ?? [])];

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      return void toast.error("Clipboard access failed. Use Download instead.");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };
  const download = () =>
    save(
      new Blob([output], { type: isJson ? "application/json" : isImage ? "image/svg+xml" : isDocument ? "text/markdown" : "text/plain" }),
      isJson
        ? `${fileSlug(schema.name)}.json`
        : isMermaid
          ? `${fileSlug(schema.name)}.mmd`
          : isMigration
            ? `${fileSlug(schema.name)}-migration.sql`
            : isImage
              ? `${fileSlug(schema.name)}.svg`
              : isDocument
                ? `${fileSlug(schema.name)}-document.md`
              : isPostgres
                ? `${fileSlug(schema.name)}-postgres.sql`
              : exportTab === "dml"
                ? "dml.sql"
                : "schema.sql",
    );
  const downloadPng = async () => {
    setRendering(true);
    try {
      save(await svgToPng(svg), `${fileSlug(schema.name)}.png`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not render the PNG.");
    } finally {
      setRendering(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className={isDocument ? "sm:max-w-5xl" : "sm:max-w-3xl"}
    >
      <DialogHeader>
        <DialogTitle className="sr-only">Export SQL</DialogTitle>
      </DialogHeader>
      <Tabs
        selectedKey={exportTab}
        onSelectionChange={(key) => setExportTab(key as ExportTab)}
      >
        <div className="flex items-center justify-between gap-2 pr-10">
          <TabsList>
            {exportTabs.map(([key, label]) => (
              <TabsTrigger key={key} id={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Copy export" isDisabled={!output} onClick={copyOutput}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
            <Button variant="ghost" size="icon" aria-label="Download export" isDisabled={!output} onClick={download}>
              <DownloadIcon/>
            </Button>
          </div>
        </div>
        {/* A JSON or Mermaid export is a snapshot of the diagram, not generated Oracle SQL, so an Oracle DDL error does not block it. */}
        {/* The PostgreSQL tab reviews its own problems: what blocks the Oracle DDL (a key into part of a composite key, say) it writes as a comment and explains. */}
        {errors.length > 0 && !isJson && !isMermaid && !isImage && !isDocument && !isPostgres && (
          <Alert variant="destructive" className="mt-4">
            <XIcon/>
            <AlertTitle>
              Export blocked: {errors[0].message} ({errors.length} error(s))
            </AlertTitle>
            <AlertAction>
              <Button variant="outline" onClick={onClearInvalidForeignKeys}>
                Clear invalid references
              </Button>
            </AlertAction>
          </Alert>
        )}
        {isPostgres && postgresProblems.length > 0 && (
          <Alert variant="destructive" className="mt-4">
            <XIcon/>
            <AlertTitle>
              Fix before running in PostgreSQL: {postgresProblems.length} problem{postgresProblems.length === 1 ? "" : "s"}
            </AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {postgresProblems.map((problem, index) => (
                  <li key={index}>
                    {problem.table && <span className="font-medium text-foreground">{problem.table}: </span>}
                    {problem.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
            {/* The same one-click fix as the Oracle tab, for the problem it fixes: a reference to a key that cannot take it. */}
            {errors.length > 0 && postgresProblems.some((problem) => / points at /.test(problem.message)) && (
              <AlertAction>
                <Button variant="outline" onClick={onClearInvalidForeignKeys}>
                  Clear invalid references
                </Button>
              </AlertAction>
            )}
          </Alert>
        )}
        <TabsContent id="migration">
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {baseline ? (
                <>
                  From <span className="font-medium text-foreground">{baseline.label}</span> to this diagram
                  {migration ? ` · ${migration.statements} statement${migration.statements === 1 ? "" : "s"}` : ""}
                </>
              ) : (
                "Load the database as it is now (its JSON export or the DDL it was built with), or pick a saved version from Version history."
              )}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.sql,.ddl,.mmd,.mermaid,application/json,text/plain"
              className="sr-only"
              aria-label="Baseline schema file"
              onChange={openBaseline}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <FolderOpenIcon data-icon="inline-start" />
              {baseline ? "Change baseline" : "Load baseline"}
            </Button>
          </div>
          {baselineError && (
            <Alert variant="destructive" className="mt-3">
              <XIcon/>
              <AlertTitle>{baselineError}</AlertTitle>
            </Alert>
          )}
          {/* Parse warnings first: a constraint the baseline skipped shows up below as one to add. */}
          {reviewNotes.length > 0 && (
            <Alert className="mt-3">
              <AlertTitle>Review before running</AlertTitle>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {reviewNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </Alert>
          )}
          {baseline && (
            <pre className="code mt-3">
              <code>{migration?.sql ? highlightSql(migration.sql) : "-- No changes: the diagram matches the baseline."}</code>
            </pre>
          )}
        </TabsContent>
        <TabsContent id="image">
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              className="segmented"
              aria-label="Image theme"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[imageTheme]}
              onSelectionChange={(keys) => {
                const [key] = [...keys];
                if (key) setImageTheme(key as DiagramTheme);
              }}
            >
              <ToggleGroupItem id="light">Light</ToggleGroupItem>
              <ToggleGroupItem id="dark">Dark</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" isDisabled={!svg} onClick={download}>
                <DownloadIcon data-icon="inline-start" />
                SVG
              </Button>
              <Button variant="outline" size="sm" isDisabled={!svg || rendering} onClick={downloadPng}>
                <DownloadIcon data-icon="inline-start" />
                {rendering ? "Rendering…" : "PNG"}
              </Button>
            </div>
          </div>
          {svg && (
            // A data URL rather than inline markup: the preview must not inherit the page's styles.
            // eslint-disable-next-line @next/next/no-img-element -- generated locally, nothing to optimize
            <img
              className="diagram-preview mt-3"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
              alt={`Diagram of ${schema.name}`}
            />
          )}
        </TabsContent>
        <TabsContent id="document">
          {/* Mounted only while open: it renders diagrams, which a closed dialog has no use for. */}
          {isOpen && isDocument && (
            <DocumentTab
              schema={schema}
              readOnly={readOnly}
              fileBase={fileSlug(schema.name)}
              save={save}
              onDocumentationChange={onDocumentationChange}
            />
          )}
        </TabsContent>
        {exportTabs.filter(([key]) => key !== "migration" && key !== "image" && key !== "document").map(([key]) => (
          <TabsContent key={key} id={key}>
            <pre className="code">
              <code>
                {isJson
                  ? highlightJson(output)
                  : isMermaid
                    ? highlightMermaid(output)
                    : highlightSql(output)}
              </code>
            </pre>
          </TabsContent>
        ))}
      </Tabs>
    </Dialog>
  );
};
