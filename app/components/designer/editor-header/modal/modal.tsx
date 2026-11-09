"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Schema } from "@/app/lib/schema";
import type { ValidationIssue } from "@/app/lib/validation";
import { useLayout, useSchema } from "@/app/hooks";
import type { ExportTab, MigrationBaseline } from "./export";
import type { ImportFormat, ImportMessage } from "./import";
import type { ShortcutId } from "@/app/lib/shortcuts";

/*
 * Each dialog is its own chunk, fetched the first time it is opened. Between
 * them they carry the parsers, the migration differ and the SVG export -- none
 * of which a session that only draws ever runs -- so the editor's first load
 * no longer pays for them.
 */
const ExportModal = dynamic(() => import("./export").then((module) => module.ExportModal), { ssr: false });
const ImportModal = dynamic(() => import("./import").then((module) => module.ImportModal), { ssr: false });
const HistoryModal = dynamic(() => import("./history").then((module) => module.HistoryModal), { ssr: false });
const ShareModal = dynamic(() => import("./share").then((module) => module.ShareModal), { ssr: false });
const CommandPalette = dynamic(() => import("./command-palette").then((module) => module.CommandPalette), { ssr: false });
const BulkColumnsModal = dynamic(() => import("./bulk-columns").then((module) => module.BulkColumnsModal), { ssr: false });
const ShortcutsModal = dynamic(() => import("./shortcuts").then((module) => module.ShortcutsModal), { ssr: false });

export type ModalsProps = {
  projectId: string;
  workspaceSlug?: string;
  workspaceId?: string;
  shareToken?: string;
  readOnly: boolean;
  importMessage: ImportMessage | null;
  onImportMessage: (message: ImportMessage | null) => void;
  onReplace: (text: string, format: ImportFormat) => void;
  onAppend: (text: string, format: ImportFormat) => void;
  onClearInvalidForeignKeys: () => void;
  onSave: () => Promise<void> | void;
  onRestore: (schema: Schema) => void;
  onRunCommand: (id: ShortcutId) => void;
  onJumpToTable: (tableId: string) => void;
};

/**
 * One place that maps the open-modal value to a body, the way drawdb's
 * `Modal.jsx` switches on its MODAL enum. The union in `LayoutContext` plays
 * the part of that enum, so every modal is closed by the same `setModal(null)`.
 */
export function Modals({
  projectId,
  workspaceSlug,
  workspaceId,
  shareToken,
  readOnly,
  importMessage,
  onImportMessage,
  onReplace,
  onAppend,
  onClearInvalidForeignKeys,
  onSave,
  onRestore,
  onRunCommand,
  onJumpToTable,
}: ModalsProps) {
  const { modal, setModal } = useLayout();
  const { schema, errors, commitWith } = useSchema();
  const close = (open: boolean) => !open && setModal(null);
  /*
   * A dialog mounts on its first opening and then stays, closed: unmounting it
   * with `modal` would cut its exit animation and drop whatever it had typed in.
   */
  const opened = useRef(new Set<string>()).current;
  if (modal) opened.add(modal);
  const [exportTab, setExportTab] = useState<ExportTab>("ddl");
  // Kept across openings: comparing against the same baseline is the common case.
  const [baseline, setBaseline] = useState<MigrationBaseline | null>(null);

  return (
    <>
      {opened.has("share") && <ShareModal
        isOpen={modal === "share"}
        onOpenChange={close}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
      />}
      {opened.has("export") && <ExportModal
        isOpen={modal === "export"}
        onOpenChange={close}
        schema={schema as Schema}
        errors={errors as ValidationIssue[]}
        onClearInvalidForeignKeys={onClearInvalidForeignKeys}
        exportTab={exportTab}
        onExportTabChange={setExportTab}
        baseline={baseline}
        onBaselineChange={setBaseline}
        readOnly={readOnly}
        onDocumentationChange={(update) => commitWith((current) => ({ ...current, documentation: update(current.documentation ?? "") || undefined }))}
      />}
      {opened.has("import") && <ImportModal
        isOpen={modal === "import"}
        onOpenChange={close}
        schema={schema}
        readOnly={readOnly}
        message={importMessage}
        onMessage={onImportMessage}
        onReplace={onReplace}
        onAppend={onAppend}
      />}
      {opened.has("history") && <HistoryModal
        isOpen={modal === "history"}
        onOpenChange={close}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        shareToken={shareToken}
        readOnly={readOnly}
        schema={schema as Schema}
        onSave={onSave}
        onRestore={onRestore}
        onUseAsBaseline={(next) => {
          setBaseline(next);
          setExportTab("migration");
          setModal("export");
        }}
      />}
      {opened.has("palette") && <CommandPalette
        isOpen={modal === "palette"}
        onOpenChange={close}
        readOnly={readOnly}
        onRunCommand={onRunCommand}
        onJumpToTable={onJumpToTable}
      />}
      {opened.has("bulk-columns") && <BulkColumnsModal
        isOpen={modal === "bulk-columns"}
        onOpenChange={close}
        readOnly={readOnly}
      />}
      {opened.has("shortcuts") && <ShortcutsModal
        isOpen={modal === "shortcuts"}
        onOpenChange={close}
        readOnly={readOnly}
      />}
    </>
  );
}
