"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileUpIcon, FolderOpenIcon, ListPlusIcon } from "lucide-react";
import { generateDDL, generateMermaidER } from "@/app/lib/generators";
import { exportSchemaJson } from "@/app/lib/schema-json";
import { generatePostgres } from "@/app/lib/postgres";
import { looksLikePostgres } from "@/app/lib/postgres-import";
import { isMermaidER } from "@/app/lib/mermaid";
import type { Schema } from "@/app/lib/schema";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { highlightJson, highlightMermaid, highlightSql } from "../../highlight";

export type ImportFormat = "ddl" | "postgres" | "mermaid" | "json";
export type ImportMessage = { ok: boolean; text: string };

const importTabs = [
  ["ddl", "Oracle DDL"],
  ["postgres", "PostgreSQL"],
  ["mermaid", "Mermaid ER"],
  ["json", "JSON"],
] as const satisfies ReadonlyArray<readonly [ImportFormat, string]>;

/** `file.text()` resolves eagerly, so a huge file would freeze the tab before anything here ran. */
const MAX_FILE_BYTES = 5_000_000;

const DESCRIPTION: Record<ImportFormat, string> = {
  ddl: "Supported CREATE TABLE subset · all-or-nothing · add to this project or replace it",
  postgres: "PostgreSQL CREATE TABLE, ALTER TABLE, CREATE INDEX, COMMENT ON and enum types (pg_dump works too) · replace makes this a PostgreSQL diagram",
  mermaid: "Mermaid erDiagram (entities, keys, relationships & comments) · add or replace",
  json: "A diagram exported from the JSON tab · replace restores it whole, add merges its tables in under fresh ids",
};

const PLACEHOLDER: Record<ImportFormat, string> = {
  ddl: "CREATE TABLE STUDENT ( ID NUMBER NOT NULL, NAME VARCHAR2(100), CONSTRAINT PK_STUDENT PRIMARY KEY (ID) );",
  postgres: "CREATE TABLE student (\n  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  name varchar(100) NOT NULL,\n  profile jsonb,\n  is_active boolean DEFAULT true\n);",
  mermaid: 'erDiagram\n    STUDENT {\n        NUMBER id PK\n        VARCHAR2(100) name\n    }\n    ENROLLMENT {\n        NUMBER student_id FK\n        VARCHAR2(20) course_code\n    }\n    STUDENT ||--o{ ENROLLMENT : "has"',
  json: '{ "formatVersion": 1, "schema": { "name": "Registrar", "tables": [ … ] } }',
};

/**
 * The text the user is importing is the only state here; parsing and
 * committing it stay with the designer, which owns the schema.
 *
 * Formats share one text box, so a file opened on the wrong tab is one
 * click from being read correctly rather than something to paste again.
 */
export const ImportModal = ({
  isOpen,
  onOpenChange,
  schema,
  readOnly,
  message,
  onMessage,
  onReplace,
  onAppend,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  schema: Schema;
  readOnly: boolean;
  message: ImportMessage | null;
  onMessage: (message: ImportMessage) => void;
  onReplace: (text: string, format: ImportFormat) => void;
  onAppend: (text: string, format: ImportFormat) => void;
}) => {
  // A PostgreSQL diagram opens on the PostgreSQL tab.
  const postgresDiagram = schema.dialect === "postgres";
  const [format, setFormat] = useState<ImportFormat>(postgresDiagram ? "postgres" : "ddl");
  useEffect(() => {
    if (isOpen) setFormat((current) => (current === "ddl" && postgresDiagram ? "postgres" : current === "postgres" && !postgresDiagram ? "ddl" : current));
  }, [isOpen, postgresDiagram]);
  const [importText, setImportText] = useState("");
  const highlightRef = useRef<HTMLPreElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isJson = format === "json";

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared first, or picking the same file twice in a row fires no change event.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      onMessage({ ok: false, text: `${file.name} is too large to import (max 5 MB).` });
      return;
    }
    const text = await file.text();
    setImportText(text);
    // Only a file switches tabs; doing it while someone types would move the ground under them.
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{")) {
      setFormat("json");
    } else if (trimmed.startsWith("%%") || isMermaidER(text)) {
      setFormat("mermaid");
    } else {
      setFormat(looksLikePostgres(text) ? "postgres" : "ddl");
    }
  };

  const editor = (
    <div className="sql-editor">
      <pre ref={highlightRef} className="sql-highlight" aria-hidden="true">
        <code>
          {isJson
            ? highlightJson(importText)
            : format === "mermaid"
              ? highlightMermaid(importText)
              : highlightSql(importText)}
        </code>
      </pre>
      <Textarea
        aria-label={
          isJson
            ? "Schema JSON input"
            : format === "mermaid"
              ? "Mermaid ER input"
              : format === "postgres"
                ? "PostgreSQL input"
                : "Oracle DDL input"
        }
        className="sql-input"
        placeholder={PLACEHOLDER[format]}
        value={importText}
        onScroll={(event) => {
          if (highlightRef.current) {
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onChange={(event) => setImportText(event.target.value)}
      />
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="sm:max-w-3xl"
    >
      <DialogHeader>
        <DialogTitle>Import</DialogTitle>
        <DialogDescription>{DESCRIPTION[format]}</DialogDescription>
      </DialogHeader>
      <Tabs
        selectedKey={format}
        onSelectionChange={(key) => setFormat(key as ImportFormat)}
      >
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            {importTabs.map(([key, label]) => (
              <TabsTrigger key={key} id={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {/*
           * Hidden but not removed: `sr-only` keeps the input focusable and
           * labelled for keyboard and screen readers, and the button is the
           * pointer affordance a native file input cannot be styled into.
           */}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.sql,.ddl,.mmd,.mermaid,application/json,text/plain"
            className="sr-only"
            aria-label="Schema file"
            onChange={openFile}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <FolderOpenIcon data-icon="inline-start" />
            Open file…
          </Button>
        </div>
        {importTabs.map(([key]) => (
          <TabsContent key={key} id={key}>
            {editor}
          </TabsContent>
        ))}
      </Tabs>
      {message && (
        <Alert variant={message.ok ? "default" : "destructive"}>
          <AlertTitle>{message.text}</AlertTitle>
        </Alert>
      )}
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() =>
            setImportText(
              isJson
                ? exportSchemaJson(schema)
                : format === "mermaid"
                  ? generateMermaidER(schema)
                  : format === "postgres"
                    ? generatePostgres(schema).sql
                    : generateDDL(schema),
            )
          }
        >
          Use current export
        </Button>
        <Button
          variant="outline"
          isDisabled={readOnly}
          onClick={() => onReplace(importText, format)}
        >
          <FileUpIcon data-icon="inline-start" />
          Replace project
        </Button>
        <Button isDisabled={readOnly} onClick={() => onAppend(importText, format)}>
          <ListPlusIcon data-icon="inline-start" />
          Add tables to project
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
