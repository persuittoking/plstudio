"use client";

import { NewDiagramDialog } from "@/app/components/new-diagram-dialog";
import { convertToOracle, convertToPostgres, dialectOf } from "@/app/lib/dialect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightIcon, ChevronDownIcon, ChevronRightIcon, LinkIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CollabUser } from "@/app/lib/collab/useCollaborativeSchema";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { mergeSchemaJson, parseSchemaJson } from "@/app/lib/schema-json";
import {
  createSaveQueue,
  type SaveQueue,
  type SaveResult,
} from "@/app/lib/save-queue";
import { EMPTY_SELECTION, selectAll } from "@/app/lib/selection";
import {
  isEditingTarget,
  matchShortcut,
  shortcutById,
  shortcutHint,
  type ShortcutId,
} from "@/app/lib/shortcuts";
import { project } from "@/app/lib/motion";
import {
  groupPrefix,
  GROUP_PALETTE,
  normalizeRelationships,
  primaryKeyColumns,
  type Schema,
  type Table,
  type Column,
  type ColumnTemplate,
  type KeyStrategy,
  type Relationship,
} from "@/app/lib/schema";
import { columnImpact } from "@/app/lib/impact";
import { type MenuItem } from "@/app/components/designer/primitives";
import { ColumnList } from "./editor-side-panel/tables-tab/column-list";
import { UniqueConstraints } from "./editor-side-panel/tables-tab/unique-constraints";
import { Indexes } from "./editor-side-panel/tables-tab/indexes";
import { ColumnTemplatesMenu } from "./editor-side-panel/tables-tab/column-templates";
import type { ImportMessage } from "./editor-header/modal/import";
import {
  useCanvasCommands,
  useDesignerSettings,
  useLayout,
  useOverlay,
  useSaveState,
  useSchema,
  useSelect,
  useTransformControls,
} from "@/app/hooks";
import { ControlPanel } from "./editor-header/control-panel";
import { Modals } from "./editor-header/modal/modal";
import { SidePanel } from "./editor-side-panel/side-panel";
import { CanvasHost } from "./editor-canvas/canvas-host";
import { TablesTab } from "./editor-side-panel/tables-tab/tables-tab";
import {
  RelationshipsTab,
  type RelationshipRow,
} from "./editor-side-panel/relationships-tab/relationships-tab";
import { RelationshipDetail } from "./editor-side-panel/relationships-tab/relationship-detail";
import { NO_GROUP } from "./constants";
import { prepareCanvasSchema, relationshipCardinalities } from "./geometry";

export type DesignerProps = {
  initialSchema: Schema;
  projectId: string;
  workspaceSlug?: string;
  workspaceId?: string;
  shareToken?: string;
  readOnly?: boolean;
  // The email is for the account menu only — never for presence, see below.
  user?: (CollabUser & { email?: string | null }) | null;
};

/** One id, so the conflict toast can be withdrawn when a reconnect settles it. */
const CONFLICT_TOAST = "save-conflict";
/** Stable, so the memoized template menu does not re-render for a project with none. */
const NO_TEMPLATES: ColumnTemplate[] = [];

export default function Workspace({
  initialSchema,
  projectId,
  workspaceSlug,
  workspaceId,
  shareToken,
  readOnly = false,
  user,
}: DesignerProps) {
  const router = useRouter();
  const [newDiagramOpen, setNewDiagramOpen] = useState(false);
  const {
    schema,
    schemaRef,
    commit,
    commitWith,
    undo,
    redo,
    canUndo,
    canRedo,
    setRevision,
    getRevision,
    collabSync,
    collabStatus,
    peers,
    patchTable,
    patchColumn,
    deleteTable,
    deleteColumn,
    addColumn,
    reorderColumns,
    addUnique,
    patchUnique,
    deleteUnique,
    addIndex,
    patchIndex,
    deleteIndex,
    applyTemplate,
    saveTemplate,
    deleteTemplate,
    tablesById,
    groupsById,
    issues,
    errors,
  } = useSchema();
  const {
    selection,
    setSelection,
    selectionRef,
    single,
    selectedId,
    selectedGroupId,
    selectedMemoId,
    selectedIdRef,
    selectSingle,
    selectTable,
  } = useSelect();
  /*
   * Commands only. The gesture state these close over lives in
   * `editor-canvas/canvas-host`, *below* this component — what is destructured
   * here are forwarders through a context value built once for the app's
   * lifetime, so reading them costs no re-render.
   */
  const {
    addGroup,
    addMemo,
    addTable,
    assignTableToGroup,
    autoLayout,
    copySelection,
    deleteSelection,
    duplicateSelection,
    fitView,
    makeJunction,
    pasteSelection,
    revealTables,
    setHandMode,
    setSpaceHeld,
    zoomBy,
  } = useCanvasCommands();
  /** Came with the gestures until they moved down; it is a lookup, not a gesture. */
  const selected = (selectedId && tablesById.get(selectedId)) || null;

  const { setImpactTarget } = useOverlay();
  const showImpact = useCallback(
    (tableId: string, columnId: string) => setImpactTarget({ tableId, columnId }),
    [setImpactTarget],
  );
  /*
   * Deleting stays one click -- undo is the safety net -- but a column other
   * things depended on says so, with the way back right there.
   */
  const deleteColumnReporting = useCallback(
    (tableId: string, columnId: string) => {
      const broken = columnImpact(schemaRef.current, { tableId, columnId }).filter((item) => item.drop).length;
      deleteColumn(tableId, columnId);
      if (broken)
        toast.warning(`Deleted a column ${broken} ${broken === 1 ? "thing" : "things"} depended on.`, {
          action: { label: "Undo", onClick: undo },
        });
    },
    [deleteColumn, schemaRef, undo],
  );

  const { zoomRef } = useTransformControls();

  const [importMessage, setImportMessage] = useState<ImportMessage | null>(
    null,
  );
  const {
    settings: relationSettings,
    setSettings: setRelationSettings,
    isMac,
  } = useDesignerSettings();
  const {
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    isResizingSidebar,
    onSidebarResizeStart,
    resetSidebarWidth,
    panelTab,
    setPanelTab,
    panelMode,
    setPanelMode,
    modal,
    setModal,
    openMenu,
    setOpenMenu,
    userMenuOpen,
    setUserMenuOpen,
    issuesOpen,
    setIssuesOpen,
    tableQuery,
    setTableQuery,
    relationshipQuery,
    setRelationshipQuery,
    openRelationshipId,
    setOpenRelationshipId,
    collapsedGroupIds,
    setCollapsedGroupIds,
  } = useLayout();
  const { dirty, setDirty, saveState, setSaveState } = useSaveState();
  useEffect(() => {
    /*
     * Reporting only. `SchemaProvider` already ran `prepareCanvasSchema` on the
     * way in, so repairing a second time here would redo an O(n²) sweep on every
     * open and commit its own result back — marking a freshly opened diagram
     * dirty. Comparing the seeded schema against the raw one says the same thing
     * for free.
     */
    const moved = schema.tables.some(
      (table, index) =>
        table.x !== initialSchema.tables[index]?.x ||
        table.y !== initialSchema.tables[index]?.y,
    );
    if (moved) toast.success("Overlapping tables were separated.");
    // Seeding only: re-running this on every `commit` would fight live edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSchema]);
  const filteredTables = useMemo(() => {
    const query = tableQuery.trim().toUpperCase();
    return query
      ? schema.tables.filter((table) =>
          table.name.toUpperCase().includes(query),
        )
      : schema.tables;
  }, [schema.tables, tableQuery]);
  /**
   * Id indexes over the schema. The card tree resolves a foreign key target and
   * a group for every column of every table on every render, and a linear find
   * inside those loops makes the render quadratic in table count. Build the
   * lookups once per schema instead.
   */
  /**
   * The tables panel mirrors the canvas' schema groups: one accordion section
   * per group, plus an ungrouped bucket. Empty groups stay visible so a group
   * created on the canvas is still discoverable here, but a search hides them —
   * "0 tables" is not a match.
   */
  const tableSections = useMemo(() => {
    const byGroup = new Map<string, Table[]>();
    filteredTables.forEach((table) => {
      const key = groupsById.has(table.schemaId ?? "")
        ? table.schemaId!
        : NO_GROUP;
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(table);
      else byGroup.set(key, [table]);
    });
    const searching = Boolean(tableQuery.trim());
    return [
      ...(schema.groups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        prefix: groupPrefix(group),
        accent: GROUP_PALETTE[group.color].border,
        tables: byGroup.get(group.id) ?? [],
      })),
      {
        id: NO_GROUP,
        name: "Ungrouped",
        prefix: "",
        accent: "var(--ink-4)",
        tables: byGroup.get(NO_GROUP) ?? [],
      },
    ].filter(
      (section) =>
        section.tables.length || (!searching && section.id !== NO_GROUP),
    );
  }, [filteredTables, groupsById, schema.groups, tableQuery]);
  /**
   * Selecting a table on the canvas opens its editor in the panel, so its
   * section has to open with it — otherwise the editor is behind a collapsed
   * accordion the user never touched.
   */
  useEffect(() => {
    const table = schema.tables.find((item) => item.id === selectedId);
    if (!table) return;
    const sectionId = groupsById.has(table.schemaId ?? "")
      ? table.schemaId!
      : NO_GROUP;
    setCollapsedGroupIds((current) =>
      current.has(sectionId)
        ? new Set([...current].filter((id) => id !== sectionId))
        : current,
    );
  }, [selectedId, schema.tables, groupsById]);
  /**
   * Candidate FK targets bucketed by column type, so the editor's per-column
   * select is a map lookup rather than a fresh sweep of the whole schema.
   */
  const foreignKeyCandidates = useMemo(() => {
    const byType = new Map<string, { table: Table; target: Column }[]>();
    const byColumnId = new Map<string, { table: Table; target: Column }>();
    schema.tables
      .filter(
        (table) =>
          table.id !== selectedId && primaryKeyColumns(table).length <= 1,
      )
      .forEach((table) =>
        table.columns.forEach((target) => {
          const entry = { table, target };
          const bucket = byType.get(target.type);
          if (bucket) bucket.push(entry);
          else byType.set(target.type, [entry]);
          byColumnId.set(target.id, entry);
        }),
      );
    return { byType, byColumnId };
  }, [schema.tables, selectedId]);

  const compatibleForeignKeyTargets = useCallback(
    (column: Column) => {
      const matches = foreignKeyCandidates.byType.get(column.type) ?? [];
      // A column whose target has since changed type still has to list that
      // target, or the select would silently drop the FK it is displaying.
      const current = column.fk
        ? foreignKeyCandidates.byColumnId.get(column.fk.columnId)
        : undefined;
      return current && !matches.includes(current)
        ? [...matches, current]
        : matches;
    },
    [foreignKeyCandidates],
  );

  /*
   * The parsers are fetched when an import actually runs: they are a third of
   * the editor's own code and most sessions never import anything. By then the
   * import dialog has usually pulled the same chunk in, so this resolves at once.
   * `schemaRef`, not `schema`: the document may have moved while it loaded.
   */
  const loadParser = () => import("@/app/lib/parser");
  const importSchema = async (text: string) => {
    const { parseCreateTable } = await loadParser();
    const result = parseCreateTable(text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.schema.tables.length} table(s) imported.${result.warnings.length ? ` ${result.warnings.length} warning(s).` : ""}`,
    });
    commit(result.schema);
    selectTable(result.schema.tables[0]?.id ?? null);
  };
  /**
   * The other half of import: keep the diagram and land the script's tables
   * under it. Nothing already on the canvas is edited, so the only new thing
   * to say is what was added and what was already there.
   */
  const appendSchema = async (text: string) => {
    const { appendCreateTable } = await loadParser();
    const result = appendCreateTable(schemaRef.current, text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.added.length} table(s) added.${result.skipped.length ? ` Already in this project: ${result.skipped.join(", ")}.` : ""}${result.warnings.length ? ` ${result.warnings.length} warning(s).` : ""}`,
    });
    commit(result.schema);
    selectTable(result.added[0]?.id ?? null);
    revealTables(result.added);
  };
  /**
   * The JSON half of the same two actions. A file carries the id and revision
   * of the project it was saved from, which address a different row on a
   * different server; the open project keeps its own.
   */
  const importJson = (text: string) => {
    const result = parseSchemaJson(text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.schema.tables.length} table(s) imported.${result.warnings.length ? ` ${result.warnings.length} warning(s).` : ""}`,
    });
    commit({ ...result.schema, id: schema.id, revision: schema.revision });
    selectTable(result.schema.tables[0]?.id ?? null);
  };
  const appendJson = (text: string) => {
    const result = mergeSchemaJson(schema, text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.added.length} table(s) added.${result.skipped.length ? ` Already in this project: ${result.skipped.join(", ")}.` : ""}${result.warnings.length ? ` ${result.warnings.length} warning(s).` : ""}`,
    });
    commit(result.schema);
    selectTable(result.added[0]?.id ?? null);
    revealTables(result.added);
  };
  const importMermaid = async (text: string) => {
    const { parseMermaidER } = await loadParser();
    const result = parseMermaidER(text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.schema.tables.length} table(s) imported.${result.warnings.length ? ` ${result.warnings.length} warning(s).` : ""}`,
    });
    commit({ ...result.schema, id: schema.id, revision: schema.revision });
    selectTable(result.schema.tables[0]?.id ?? null);
  };
  const appendMermaid = async (text: string) => {
    const { appendMermaidER } = await loadParser();
    const result = appendMermaidER(schemaRef.current, text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.added.length} table(s) added.${result.skipped.length ? ` Already in this project: ${result.skipped.join(", ")}.` : ""}${result.warnings.length ? ` ${result.warnings.length} warning(s).` : ""}`,
    });
    commit(result.schema);
    selectTable(result.added[0]?.id ?? null);
    revealTables(result.added);
  };
  /**
   * A PostgreSQL script. Replacing makes the project a PostgreSQL diagram;
   * adding keeps the project's database and brings the tables in with their
   * PostgreSQL types. The first warning is shown, since it names what was
   * set aside (an unknown type, an EXCLUDE clause).
   */
  const loadPostgresImport = () => import("@/app/lib/postgres-import");
  const importPostgres = async (text: string) => {
    const { parsePostgres } = await loadPostgresImport();
    const result = parsePostgres(text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.schema.tables.length} PostgreSQL table(s) imported.${result.warnings.length ? ` ${result.warnings.length} warning(s): ${result.warnings[0]}` : ""}`,
    });
    commit({ ...result.schema, id: schema.id, name: schema.name, revision: schema.revision });
    selectTable(result.schema.tables[0]?.id ?? null);
  };
  const appendPostgresTables = async (text: string) => {
    const { appendPostgres } = await loadPostgresImport();
    const result = appendPostgres(schemaRef.current, text);
    if (!result.schema) {
      setImportMessage({ ok: false, text: result.errors.join(" ") });
      return;
    }
    setImportMessage({
      ok: true,
      text: `${result.added.length} table(s) added.${result.skipped.length ? ` Already in this project: ${result.skipped.join(", ")}.` : ""}${result.warnings.length ? ` ${result.warnings.length} warning(s): ${result.warnings[0]}` : ""}`,
    });
    commit(result.schema);
    selectTable(result.added[0]?.id ?? null);
    revealTables(result.added);
  };
  const clearInvalidForeignKeys = () => {
    const next = {
      ...schema,
      tables: schema.tables.map((table) => ({
        ...table,
        columns: table.columns.map((column) => {
          if (!column.fk) return column;
          const targetTable = schema.tables.find(
            (candidate) => candidate.id === column.fk?.tableId,
          );
          const targetColumn = targetTable?.columns.find(
            (candidate) => candidate.id === column.fk?.columnId,
          );
          const isValid =
            targetTable &&
            targetColumn &&
            primaryKeyColumns(targetTable).length <= 1 &&
            targetColumn.type === column.type;
          return isValid ? column : { ...column, fk: null };
        }),
      })),
    };
    commit(normalizeRelationships(next));
  };

  /**
   * One write at a time, newest snapshot wins, and each response's revision
   * seeds the next request — see `createSaveQueue` for why that last part is
   * what keeps consecutive saves from conflicting with themselves.
   *
   * Built once per project. Everything it needs that changes goes through a
   * ref, so the queue is never torn down mid-write.
   */
  const saveQueueRef = useRef<SaveQueue | null>(null);
  const announceSaveRef = useRef<(result: SaveResult) => void>(() => {});
  if (!saveQueueRef.current)
    saveQueueRef.current = createSaveQueue({
      revision: getRevision,
      onRevision: setRevision,
      onState: setSaveState,
      onResult: (result) => announceSaveRef.current(result),
      write: async (next, revision, overwrite) => {
        const query = new URLSearchParams();
        if (workspaceSlug) query.set("workspace", workspaceSlug);
        if (shareToken) query.set("shareToken", shareToken);
        const response = await fetch(
          `/api/projects/${projectId}${query.toString() ? `?${query}` : ""}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              schema: { ...next, revision },
              overwrite,
            }),
          },
        );
        if (response.ok) {
          const saved = (await response.json()) as Schema;
          return { status: "saved", revision: saved.revision };
        }
        if (response.status === 409) {
          // The body carries the record as it now stands, so the overwrite
          // that follows is sent against the revision that rejected us.
          const current = (await response.json().catch(() => null)) as {
            revision?: number;
          } | null;
          return {
            status: "conflict",
            revision: current?.revision ?? revision,
          };
        }
        return {
          status: "failed",
          message: "Project storage is unavailable.",
        };
      },
    });
  const saveQueue = saveQueueRef.current;

  /**
   * Saving to the project file. An autosave says nothing when it works (the
   * appbar badge already reports state), whereas manual saves toast on success.
   */
  const [explicitSave, setExplicitSave] = useState(false);
  announceSaveRef.current = (result) => {
    if (result.status === "saved") {
      setDirty(false);
      if (explicitSave || !relationSettings.autoSave) {
        toast.success("Project saved.");
      }
      setExplicitSave(false);
      return;
    }
    setExplicitSave(false);
    if (result.status === "conflict") {
      toast.error("This project changed elsewhere.", {
        id: CONFLICT_TOAST,
        description: "Saving now would overwrite the other changes.",
        duration: Infinity,
        action: { label: "Overwrite", onClick: () => void save(true) },
      });
      return;
    }
    toast.error(result.message);
  };

  /**
   * While the collab socket is up the server persists every edit itself, and
   * bumps `revision` each time it does. The file is no longer ours alone to
   * version, so the optimistic `PUT` is the wrong tool: it would be redundant
   * at best and, a store later, a conflict with nobody.
   */
  const collabLive = collabStatus === "connected";

  const save = (overwrite = false) => {
    if (readOnly) return Promise.resolve();
    setExplicitSave(true);
    /*
     * An explicit save still writes the file -- it is what makes a history
     * version. Once the server has acknowledged everything, what is on screen
     * is already the merge of every peer's edits, so there is nothing for the
     * revision check to protect and it is skipped.
     */
    return saveQueue.flush(schemaRef.current, {
      overwrite: overwrite || (collabLive && collabSync.get()),
    });
  };

  /**
   * The autosave itself: when enabled in settings, every edit of this client's
   * re-arms the debounce, so a burst of typing writes once when it stops.
   * Gated on `dirty` and `relationSettings.autoSave`, and only the durability
   * path when collab is not.
   */
  useEffect(() => {
    if (readOnly || !dirty || !relationSettings.autoSave || collabLive) return;
    saveQueue.push(schema);
  }, [collabLive, dirty, readOnly, relationSettings.autoSave, saveQueue, schema]);

  /**
   * With collab up, "saved" is the server's acknowledgement. `dirty` is in the
   * deps so an edit that changed nothing in the document -- and so will never
   * be acknowledged -- is settled too.
   */
  useEffect(() => {
    if (!collabLive || !dirty || !relationSettings.autoSave) return;
    const settle = () => { if (collabSync.get()) setDirty(false); };
    settle();
    return collabSync.subscribe(settle);
  }, [collabLive, collabSync, dirty, relationSettings.autoSave, setDirty]);

  /**
   * Reconnecting merges whatever was written while the socket was down, which
   * answers the question a queued `PUT` or a standing conflict toast was asking.
   */
  useEffect(() => {
    if (!collabLive) return;
    saveQueue.cancel();
    toast.dismiss(CONFLICT_TOAST);
  }, [collabLive, saveQueue]);

  useEffect(() => () => saveQueue.cancel(), [saveQueue]);

  /**
   * When autosave is enabled: a tab closed mid-debounce flushes the edits.
   */
  useEffect(() => {
    if (readOnly || !relationSettings.autoSave) return;
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      if (saveQueue.state !== "pending") return;
      void saveQueue.flush(schemaRef.current);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [readOnly, relationSettings.autoSave, saveQueue]);

  /**
   * When autosave is disabled (default): warn before closing the tab or
   * navigating away if there are unsaved changes.
   */
  useEffect(() => {
    if (!dirty || readOnly || relationSettings.autoSave) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, readOnly, relationSettings.autoSave]);

  /**
   * Whatever the canvas selection currently is, remove it — in one commit, so
   * a swept-up cluster comes back on a single ⌘Z rather than one card at a time.
   */
  const pasteSelectionRef = useRef(pasteSelection);
  pasteSelectionRef.current = pasteSelection;
  const modalRef = useRef(modal);
  modalRef.current = modal;

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (readOnly || isEditingTarget(event.target) || modalRef.current) return;
      const text = event.clipboardData?.getData("text/plain")?.trim();
      // Only claim the event for something that looks like our envelope;
      // anything else belongs to whatever the user was really pasting into.
      if (!text || !text.startsWith("{")) return;
      event.preventDefault();
      pasteSelectionRef.current(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [readOnly]);

  /** Every command a chord can reach. Ids without an entry here stay inert. */
  const shortcutActions: Partial<Record<ShortcutId, () => void>> = {
    save: () => void save(),
    /*
     * Overwrite only once the server has already said there is a conflict and
     * the toast has reported it — pressing this then is the keyboard equivalent
     * of its Overwrite action. With nothing in contention it is a plain save,
     * so the chord can never discard a peer's work unannounced.
     */
    forceSave: () => void save(saveState === "conflict"),
    export: () => setModal("export"),
    import: () => setModal("import"),
    share: () => setModal("share"),
    undo,
    redo,
    addColumn: () => selected && addColumn(selected.id),
    bulkColumns: () => setModal("bulk-columns"),
    addTable,
    addGroup,
    addMemo,
    junction: makeJunction,
    selectAll: () => setSelection(selectAll(schema)),
    copySelectionSql: () => copySelection("sql"),
    copySelectionJson: () => copySelection("json"),
    deleteSelection,
    duplicate: () => duplicateSelection(),
    zoomIn: () => zoomBy(0.1),
    zoomOut: () => zoomBy(-0.1),
    // Through zoomBy, so ⌘0 keeps the middle of the view where it is -- the
    // same reset the dock's readout performs.
    zoomReset: () => zoomBy(1 - zoomRef.current),
    fitView,
    toggleHand: () => setHandMode((on) => !on),
    tidyLayout: autoLayout,
    toggleSidebar: () => setSidebarOpen((open) => !open),
    shortcutsHelp: () => setModal("shortcuts"),
    commandPalette: () => setModal("palette"),
  };
  /** Menu items fire the same closures as the chords, so the two can never diverge. */
  const run = (id: ShortcutId) => () => shortcutActions[id]?.();
  const hint = (id: ShortcutId) => shortcutHint(id, isMac);

  /**
   * Escape closes the topmost layer; everything else resolves through the shortcut
   * table. The handler lives in a ref so the listener is bound once rather than
   * re-bound on every render, while still seeing the latest closure.
   */
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (event: KeyboardEvent) => {
    // `code`, not `key`, so the hold survives non-US layouts. preventDefault
    // stops both the page scroll and Space activating a focused dock button.
    if (event.code === "Space") {
      if (isEditingTarget(event.target) || modal || openMenu || userMenuOpen)
        return;
      event.preventDefault();
      if (!event.repeat) setSpaceHeld(true);
      return;
    }
    if (event.key === "Escape") {
      // Overlays dismiss themselves; Escape only clears canvas selection.
      if (modal || openMenu || userMenuOpen) return;
      setSelection(EMPTY_SELECTION);
      return;
    }
    const id = matchShortcut(event, isMac);
    const shortcut = id && shortcutById(id);
    if (!id || !shortcut) return;
    // An open layer owns the keyboard, apart from the help sheet itself.
    if ((modal || openMenu || userMenuOpen) && id !== "shortcutsHelp") return;
    if (shortcut.mutating && readOnly) return;
    const run = shortcutActions[id];
    if (!run) return;
    event.preventDefault();
    run();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * The other half of the Space hold. `blur` matters as much as `keyup`: tabbing
   * away mid-hold means the keyup lands on another window, and without this the
   * canvas would come back stuck in hand mode.
   */
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) =>
      event.code === "Space" && setSpaceHeld(false);
    const clear = () => setSpaceHeld(false);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const relationships = useMemo(
    () =>
      (schema.relationships ?? []).flatMap((relationship) => {
        const from = schema.tables.find(
          (table) => table.id === relationship.startTableId,
        );
        const to = schema.tables.find(
          (table) => table.id === relationship.endTableId,
        );
        const pair = relationship.fields[0] ?? {
          startFieldId: relationship.startFieldId,
          endFieldId: relationship.endFieldId,
        };
        const fromIndex =
          from?.columns.findIndex(
            (column) => column.id === pair.startFieldId,
          ) ?? -1;
        const toIndex =
          to?.columns.findIndex((column) => column.id === pair.endFieldId) ??
          -1;
        return from && to && fromIndex >= 0 && toIndex >= 0
          ? [
              {
                relationship,
                from,
                fromIndex,
                to,
                toIndex,
                id: relationship.id,
              },
            ]
          : [];
      }),
    [schema],
  );
  /** Tallied once instead of filtering the whole list per table card. */
  const relationshipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
    relationships.forEach((item) => {
      bump(item.from.id);
      if (item.to.id !== item.from.id) bump(item.to.id);
    });
    return counts;
  }, [relationships]);

  const patchRelationship = (id: string, patch: Partial<Relationship>) => {
    if (readOnly) return;
    commit(
      normalizeRelationships({
        ...schema,
        relationships: (schema.relationships ?? []).map((relationship) =>
          relationship.id === id ? { ...relationship, ...patch } : relationship,
        ),
      }),
    );
  };

  const deleteRelationship = (id: string) => {
    if (readOnly) return;
    commit(
      normalizeRelationships({
        ...schema,
        relationships: (schema.relationships ?? []).filter(
          (relationship) => relationship.id !== id,
        ),
      }),
    );
    if (openRelationshipId === id) setOpenRelationshipId(null);
  };

  const swapRelationship = (relationship: Relationship) => {
    patchRelationship(relationship.id, {
      startTableId: relationship.endTableId,
      startFieldId: relationship.endFieldId,
      endTableId: relationship.startTableId,
      endFieldId: relationship.startFieldId,
      fields: relationship.fields.map((pair) => ({
        startFieldId: pair.endFieldId,
        endFieldId: pair.startFieldId,
      })),
      name: `fk_${schema.tables.find((table) => table.id === relationship.endTableId)?.name ?? "table"}_${schema.tables.find((table) => table.id === relationship.endTableId)?.columns.find((column) => column.id === relationship.endFieldId)?.name ?? "field"}_${schema.tables.find((table) => table.id === relationship.startTableId)?.name ?? "table"}`,
    });
  };

  const relationshipRows = useMemo(
    () =>
      relationships.map((relationship) => {
        const column = relationship.from.columns[relationship.fromIndex];
        const target = relationship.to.columns[relationship.toIndex];
        return {
          id: relationship.id,
          from: `${relationship.from.name.toUpperCase()}.${column.name.toUpperCase()}`,
          to: `${relationship.to.name.toUpperCase()}.${target.name.toUpperCase()}`,
          cardinality: relationshipCardinalities(
            relationship.relationship,
          ).join(":"),
          fromId: relationship.from.id,
          name: relationship.relationship.name,
          relationship: relationship.relationship,
          // Already resolved here; the row body used to look both up again on
          // every render of the sidebar, which is every drag frame.
          startTable: relationship.from,
          endTable: relationship.to,
        };
      }),
    [relationships],
  );

  const fileMenu: MenuItem[] = [
    // Asks which database first; see `NewDiagramDialog`.
    { label: "New diagram", onSelect: () => setNewDiagramOpen(true) },
    {
      // Columns are stored as Oracle types either way, so switching is a relabel plus,
      // towards PostgreSQL, moving each type to the twin that keeps its meaning. One undo reverts it.
      label: dialectOf(schema) === "postgres" ? "Switch to Oracle" : "Switch to PostgreSQL",
      disabled: readOnly,
      onSelect: () => {
        const toPostgres = dialectOf(schema) !== "postgres";
        commit(toPostgres ? convertToPostgres(schema) : convertToOracle(schema));
        toast.success(toPostgres ? "This diagram is now PostgreSQL. The Oracle DDL stays in Export." : "This diagram is now Oracle.");
      },
    },
    { separator: true },
    { label: "Import…", onSelect: run("import"), hint: hint("import") },
    { label: "Export…", onSelect: run("export"), hint: hint("export") },
    { label: "Version history…", onSelect: () => setModal("history") },
    { separator: true },
    { label: "Save", onSelect: run("save"), hint: hint("save") },
    {
      label: "Force save",
      onSelect: run("forceSave"),
      // Only ever different from Save while a conflict is outstanding, so it
      // stays out of the way until it has something to offer.
      disabled: saveState !== "conflict",
      hint: hint("forceSave"),
    },
  ];
  const editMenu: MenuItem[] = [
    {
      label: "Undo",
      onSelect: run("undo"),
      disabled: !canUndo,
      hint: hint("undo"),
    },
    {
      label: "Redo",
      onSelect: run("redo"),
      disabled: !canRedo,
      hint: hint("redo"),
    },
    { separator: true },
    { label: "Add table", onSelect: run("addTable"), hint: hint("addTable") },
    {
      label: "Add schema group",
      onSelect: run("addGroup"),
      hint: hint("addGroup"),
    },
    { label: "Add memo", onSelect: run("addMemo"), hint: hint("addMemo") },
    {
      label: "Add junction table",
      onSelect: run("junction"),
      disabled: !selected,
      hint: hint("junction"),
    },
    { separator: true },
    {
      label: "Edit columns…",
      onSelect: run("bulkColumns"),
      hint: hint("bulkColumns"),
    },
    {
      label: "Duplicate",
      onSelect: run("duplicate"),
      disabled: !selection.tables.length,
      hint: hint("duplicate"),
    },
    {
      label: "Delete selection",
      onSelect: run("deleteSelection"),
      disabled: !selectedId && !selectedGroupId && !selectedMemoId,
      hint: hint("deleteSelection"),
    },
  ];
  const viewMenu: MenuItem[] = [
    { label: "Zoom in", onSelect: run("zoomIn"), hint: hint("zoomIn") },
    { label: "Zoom out", onSelect: run("zoomOut"), hint: hint("zoomOut") },
    {
      label: "Reset zoom",
      onSelect: run("zoomReset"),
      hint: hint("zoomReset"),
    },
    { label: "Fit to screen", onSelect: run("fitView"), hint: hint("fitView") },
    { separator: true },
    {
      label: "Tidy up layout",
      onSelect: run("tidyLayout"),
      hint: hint("tidyLayout"),
    },
    {
      label: sidebarOpen ? "Hide side panel" : "Show side panel",
      onSelect: run("toggleSidebar"),
      hint: hint("toggleSidebar"),
    },
  ];
  const settingsMenu: MenuItem[] = [
    {
      label: `${relationSettings.showCardinality ? "Hide" : "Show"} cardinality`,
      onSelect: () =>
        setRelationSettings((current) => ({
          ...current,
          showCardinality: !current.showCardinality,
        })),
    },
    {
      label: `${relationSettings.showRelationshipLabels ? "Hide" : "Show"} relationship labels`,
      onSelect: () =>
        setRelationSettings((current) => ({
          ...current,
          showRelationshipLabels: !current.showRelationshipLabels,
        })),
    },
    {
      label: `${relationSettings.dimUnrelated ? "Turn off" : "Turn on"} focus dimming`,
      onSelect: () =>
        setRelationSettings((current) => ({
          ...current,
          dimUnrelated: !current.dimUnrelated,
        })),
    },
    {
      label: `Use ${relationSettings.cardStyle === "document" ? "classic" : "document"} table cards`,
      onSelect: () =>
        setRelationSettings((current) => ({
          ...current,
          cardStyle: current.cardStyle === "document" ? "classic" : "document",
        })),
    },
    {
      label: `${relationSettings.showMinimap ? "Hide" : "Show"} minimap`,
      onSelect: () =>
        setRelationSettings((current) => ({
          ...current,
          showMinimap: !current.showMinimap,
        })),
    },
    {
      label: `${relationSettings.autoSave ? "Turn off" : "Turn on"} auto-save`,
      onSelect: () =>
        setRelationSettings((current) => {
          const next = !current.autoSave;
          toast.success(
            next ? "Auto-save turned on." : "Auto-save turned off.",
          );
          return { ...current, autoSave: next };
        }),
    },
    { separator: true },
    { label: "Clear invalid references", onSelect: clearInvalidForeignKeys },
  ];
  const helpMenu: MenuItem[] = [
    {
      label: "Keyboard shortcuts",
      onSelect: run("shortcutsHelp"),
      hint: hint("shortcutsHelp"),
    },
    { separator: true },
    // The database the diagram is for, and the version its main script targets.
    dialectOf(schema) === "postgres"
      ? {
        label: "PostgreSQL target: 13+",
        onSelect: () =>
          toast.success("Generating SQL for PostgreSQL 13 and later. The Oracle DDL (12.2+) stays in Export."),
      }
      : {
        label: "Oracle target: 12.2+",
        onSelect: () =>
          toast.success("Generating DDL for Oracle 12.2 and later."),
      },
  ];

  const tableEntity = (table: Table) => (
    <Collapsible
      className={`entity ${selectedId === table.id ? "open" : ""}`}
      key={table.id}
      isExpanded={selectedId === table.id}
      onExpandedChange={(expanded) => selectTable(expanded ? table.id : null)}
    >
      <CollapsibleTrigger className="entity-head">
        <span
          className="entity-swatch"
          style={{ background: table.color.a }}
          aria-hidden="true"
        />
        <strong className="entity-name">{table.name.toUpperCase()}</strong>
        <small className="entity-count">{table.columns.length}</small>
        <ChevronDownIcon className="entity-chevron"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {selectedId === table.id ? (
          <div className="entity-body">
            <section className="inset-section">
              <div className="inset-group">
                <label className="inset-row">
                  <span className="inset-row-label">Name</span>
                  <Input
                    className="inset-field mono"
                    disabled={readOnly}
                    value={table.name}
                    onChange={(event) =>
                      patchTable(table.id, { name: event.target.value })
                    }
                  />
                </label>
                <div className="inset-row">
                  <span className="inset-row-label">Key</span>
                  <Select
                    className="inset-row-value"
                    aria-label="Key generation"
                    isDisabled={readOnly}
                    selectedKey={table.keyStrategy}
                    onSelectionChange={(key) =>
                      patchTable(table.id, { keyStrategy: key as KeyStrategy })
                    }
                  >
                    <SelectTrigger className="inset-field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem id="sequence-trigger">
                          Sequence + trigger
                        </SelectItem>
                        <SelectItem id="identity">Identity</SelectItem>
                        <SelectItem id="none">Manual</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="inset-row">
                  <span className="inset-row-label">Group</span>
                  <Select
                    className="inset-row-value"
                    aria-label="Schema group"
                    isDisabled={readOnly}
                    selectedKey={table.schemaId ?? NO_GROUP}
                    onSelectionChange={(key) =>
                      assignTableToGroup(
                        table.id,
                        key === NO_GROUP ? "" : String(key),
                      )
                    }
                  >
                    <SelectTrigger className="inset-field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem id={NO_GROUP}>None</SelectItem>
                        {(schema.groups ?? []).map((group) => (
                          <SelectItem key={group.id} id={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                {/* Prose, not a value: stacked, full width, and growing with
                    what is written -- a document card prints it in full. */}
                <label className="inset-row stacked">
                  <span className="inset-row-label">Comment</span>
                  <Textarea
                    className="inset-textarea"
                    disabled={readOnly}
                    placeholder="What this table holds"
                    value={table.comment ?? ""}
                    onChange={(event) =>
                      patchTable(table.id, { comment: event.target.value })
                    }
                  />
                </label>
              </div>
              {primaryKeyColumns(table).length > 1 && (
                <p className="inset-group-footer">
                  Composite primary key — keys have to be supplied manually.
                </p>
              )}
            </section>

            <section className="inset-section">
              <h3 className="inset-group-header">
                Columns
                <span className="inset-group-count">
                  {table.columns.length}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    className="row-icon-button tint"
                    aria-label={`Add a column to ${table.name}`}
                    onClick={() => addColumn(table.id)}
                  >
                    <PlusIcon size={16} />
                  </button>
                )}
                {!readOnly && (
                  <ColumnTemplatesMenu
                    table={table}
                    templates={schema.columnTemplates ?? NO_TEMPLATES}
                    applyTemplate={applyTemplate}
                    saveTemplate={saveTemplate}
                    deleteTemplate={deleteTemplate}
                  />
                )}
              </h3>
              <ColumnList
                table={table}
                readOnly={readOnly}
                patchColumn={patchColumn}
                deleteColumn={deleteColumnReporting}
                reorderColumns={reorderColumns}
                compatibleForeignKeyTargets={compatibleForeignKeyTargets}
                onShowImpact={showImpact}
              />
            </section>

            <UniqueConstraints
              table={table}
              readOnly={readOnly}
              addUnique={addUnique}
              patchUnique={patchUnique}
              deleteUnique={deleteUnique}
            />

            <Indexes
              table={table}
              readOnly={readOnly}
              addIndex={addIndex}
              patchIndex={patchIndex}
              deleteIndex={deleteIndex}
            />

            {!readOnly && (
              <div className="inset-group">
                <button
                  type="button"
                  className="inset-row inset-row-action"
                  onClick={() => makeJunction(table.id)}
                >
                  <LinkIcon size={16} />
                  Make junction table
                </button>
                <button
                  type="button"
                  className="inset-row inset-row-action destructive"
                  onClick={() => deleteTable(table.id)}
                >
                  <Trash2Icon size={16} />
                  Delete table
                </button>
              </div>
            )}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );

  const menus: Array<{ name: string; items: MenuItem[] }> = [
    { name: "File", items: fileMenu },
    { name: "Edit", items: editMenu },
    { name: "View", items: viewMenu },
    { name: "Settings", items: settingsMenu },
    { name: "Help", items: helpMenu },
  ];

  const relationshipEntity = (row: RelationshipRow) => {
    const relationship = row.relationship;
    const { startTable, endTable } = row;
    return (
      <Collapsible
        className={`relationship-editor ${openRelationshipId === relationship.id ? "open" : ""}`}
        key={relationship.id}
        isExpanded={openRelationshipId === relationship.id}
        onExpandedChange={(expanded) =>
          setOpenRelationshipId(expanded ? relationship.id : null)
        }
      >
        <CollapsibleTrigger className="relationship-row relationship-editor-head">
          <LinkIcon aria-hidden="true" />
          <span className="relationship-copy" title={`${relationship.name}\n${row.from} → ${row.to} · ${row.cardinality}`}>
            <strong>{relationship.name}</strong>
            {/*
              Tables only -- the columns are in the editor one press away. Each
              name gives way on its own, so a long source can no longer push the
              target, the arrow and the cardinality off the end of the row.
            */}
            <small className="relationship-path">
              <span>{startTable.name.toUpperCase()}</span>
              <ArrowRightIcon aria-label="references" />
              <span>{endTable.name.toUpperCase()}</span>
              <b>{row.cardinality}</b>
            </small>
          </span>
          <ChevronDownIcon className="entity-chevron" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {openRelationshipId === relationship.id ? (
            <RelationshipDetail
              relationship={relationship}
              startTable={startTable}
              endTable={endTable}
              readOnly={readOnly}
              onPatch={(patch) => patchRelationship(relationship.id, patch)}
              onSwap={() => swapRelationship(relationship)}
              onDelete={() => deleteRelationship(relationship.id)}
            />
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className={`app ${readOnly ? "share-read-only" : ""}`}>
      <NewDiagramDialog isOpen={newDiagramOpen} onOpenChange={setNewDiagramOpen} workspace={workspaceSlug} />
      <ControlPanel
        menus={menus}
        save={save}
        workspaceSlug={workspaceSlug}
        readOnly={readOnly}
        user={user}
      />

      <SidebarProvider
        className={`body min-h-0 flex-1 ${isResizingSidebar ? "is-resizing" : ""}`}
        style={
          { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
        }
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
      >
        <SidePanel
          readOnly={readOnly}
          relationshipCount={relationshipRows.length}
          tablesTab={
            <TablesTab
              tables={schema.tables}
              filteredTables={filteredTables}
              sections={tableSections}
              hasGroups={Boolean((schema.groups ?? []).length)}
              onAddTable={() => addTable()}
              renderTable={tableEntity}
            />
          }
          relationshipsTab={
            <RelationshipsTab
              rows={relationshipRows}
              renderRow={relationshipEntity}
            />
          }
        />

        {!sidebarOpen && (
          <SidebarTrigger className="panel-reveal" aria-label="Show side panel">
            <ChevronRightIcon/>
          </SidebarTrigger>
        )}

        <CanvasHost
          readOnly={readOnly}
          save={save}
          relationships={relationships}
          relationshipCounts={relationshipCounts}
          runShortcut={(id: ShortcutId) => shortcutActions[id]?.()}
        />
      </SidebarProvider>

      <Modals
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        shareToken={shareToken}
        readOnly={readOnly}
        importMessage={importMessage}
        onSave={() => save()}
        onRestore={(version) =>
          // Through `commit`, so it syncs to peers and one undo takes it back.
          commit({ ...version, id: schema.id, revision: schema.revision })
        }
        onImportMessage={setImportMessage}
        onReplace={(text, format) => {
          if (format === "json") importJson(text);
          else if (format === "mermaid") void importMermaid(text);
          else if (format === "postgres") void importPostgres(text);
          else void importSchema(text);
        }}
        onAppend={(text, format) => {
          if (format === "json") appendJson(text);
          else if (format === "mermaid") void appendMermaid(text);
          else if (format === "postgres") void appendPostgresTables(text);
          else void appendSchema(text);
        }}
        onClearInvalidForeignKeys={clearInvalidForeignKeys}
        onRunCommand={(id) => shortcutActions[id]?.()}
        onJumpToTable={(tableId) => {
          const table = tablesById.get(tableId);
          if (!table) return;
          selectTable(tableId);
          revealTables([table]);
          setPanelTab("tables");
          setSidebarOpen(true);
        }}
      />
    </div>
  );
}
