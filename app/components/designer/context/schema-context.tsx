"use client";

import {
  createContext,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  useCollaborativeSchema,
  type CollabUser,
} from "@/app/lib/collab/useCollaborativeSchema";
import {
  applyColumnTemplate,
  makeColumn,
  makeIndex,
  makeUniqueConstraint,
  nextId,
  normalizeRelationships,
  typeUsesSize,
  type Column,
  type ColumnTemplate,
  type Schema,
  type SchemaGroup,
  type Table,
  type TableIndex,
  type UniqueConstraint,
  prunePackages,
} from "@/app/lib/schema";
import { validateSchema } from "@/app/lib/validation";
import type { ValidationIssue } from "@/app/lib/validation";
import { applyLintFix, LINT_RULES, lintSchema, type LintFinding } from "@/app/lib/lint";
import { useLayout } from "@/app/hooks/use-layout";
import { useSaveState } from "@/app/hooks/use-save-state";
import { prepareCanvasSchema } from "../geometry";
import { useWorkerDDL } from "./use-worker-ddl";
import { DialectContext } from "./dialect-context";
import { dialectOf, toPostgresColumn } from "@/app/lib/dialect";
import { postgresIssues } from "@/app/lib/postgres-issues";

export type SchemaProviderProps = {
  initialSchema: Schema;
  projectId: string;
  workspaceSlug?: string;
  shareToken?: string;
  readOnly: boolean;
  user?: (CollabUser & { email?: string | null }) | null;
  children: ReactNode;
};

export type SchemaContextValue = {
  schema: Schema;
  /** Read by gesture handlers that only hold a ref to current state. */
  schemaRef: React.RefObject<Schema>;
  commit: (next: Schema) => void;
  commitWith: (mutate: (current: Schema) => Schema) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setRevision: (revision: number) => void;
  /** The revision the next `PUT` is based on; the server keeps it current while collab is connected. */
  getRevision: () => number;
  /** Whether the collab server holds every edit of this client's. A store: see `createSyncStore`. */
  collabSync: ReturnType<typeof useCollaborativeSchema>["sync"];
  collabStatus: ReturnType<typeof useCollaborativeSchema>["status"];
  peers: ReturnType<typeof useCollaborativeSchema>["peers"];
  /** This browser's presence identity, to tell whether a peer shares its account. */
  self: ReturnType<typeof useCollaborativeSchema>["self"];
  cursors: ReturnType<typeof useCollaborativeSchema>["cursors"];
  setCursor: ReturnType<typeof useCollaborativeSchema>["setCursor"];
  broadcastSelection: ReturnType<typeof useCollaborativeSchema>["setSelection"];
  patchTable: (id: string, patch: Partial<Table>) => void;
  patchColumn: (
    tableId: string,
    columnId: string,
    patch: Partial<Column>,
  ) => void;
  deleteTable: (id: string) => void;
  deleteColumn: (tableId: string, columnId: string) => void;
  addColumn: (tableId: string) => void;
  reorderColumns: (tableId: string, from: number, to: number) => void;
  addUnique: (tableId: string) => void;
  patchUnique: (
    tableId: string,
    uniqueId: string,
    patch: Partial<UniqueConstraint>,
  ) => void;
  deleteUnique: (tableId: string, uniqueId: string) => void;
  /** `columnIds` pre-fills the index, which is how a suggestion is accepted. */
  addIndex: (tableId: string, columnIds?: string[]) => void;
  patchIndex: (
    tableId: string,
    indexId: string,
    patch: Partial<TableIndex>,
  ) => void;
  deleteIndex: (tableId: string, indexId: string) => void;
  applyTemplate: (tableId: string, template: ColumnTemplate) => void;
  saveTemplate: (template: ColumnTemplate) => void;
  deleteTemplate: (templateId: string) => void;
  tablesById: Map<string, Table>;
  groupsById: Map<string, SchemaGroup>;
  columnsById: Map<string, { table: Table; column: Column }>;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  /** Lint findings: advice, never blocking. From the same deferred schema as `issues`. */
  suggestions: LintFinding[];
  /** Applies a finding's fix to the *current* schema, or does nothing if it no longer holds. One undo step. */
  fixSuggestion: (finding: LintFinding) => void;
  /** Sets which lint rules are on, for the whole project. One commit, however many rules changed. */
  setLintRules: (enabled: Iterable<string>) => void;
  ddl: string;
};

export const SchemaContext = createContext<SchemaContextValue | null>(null);

/** Shrink every constraint or index that names `columnId`, dropping the ones left empty. */
const dropColumnFromSets = <T extends UniqueConstraint | TableIndex>(
  sets: T[] | undefined,
  columnId: string,
) =>
  sets
    ?.map((constraint) => ({
      ...constraint,
      columnIds: constraint.columnIds.filter((id) => id !== columnId),
    }))
    .filter((constraint) => constraint.columnIds.length);

export function SchemaProvider({
  initialSchema,
  projectId,
  workspaceSlug,
  shareToken,
  readOnly,
  user,
  children,
}: SchemaProviderProps) {
  const { panelMode } = useLayout();
  const { setDirty } = useSaveState();

  // Awareness broadcasts this object to every peer, so hand the hook only the
  // presence fields; the email stays local to `NavUser`.
  const collabUser = useMemo(
    () => (user ? { id: user.id, name: user.name, image: user.image } : user),
    [user],
  );
  const {
    schema,
    commit: commitShared,
    undo: undoShared,
    redo: redoShared,
    canUndo,
    canRedo,
    setRevision,
    getRevision,
    sync: collabSync,
    status: collabStatus,
    peers,
    self,
    cursors,
    setCursor,
    setSelection: broadcastSelection,
  } = useCollaborativeSchema({
    projectId,
    initialSchema: useMemo(
      () => prepareCanvasSchema(initialSchema),
      [initialSchema],
    ),
    readOnly,
    user: collabUser,
    shareToken,
    workspaceSlug,
  });

  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  /**
   * Every edit lands in the shared document; undo history is the CRDT's, scoped
   * to this client. `dirty` only tracks whether an explicit save is pending —
   * saving to the project file is manual.
   */
  const commit = useCallback(
    (next: Schema) => {
      if (readOnly) return;
      commitShared(prunePackages(next));
      setDirty(true);
    },
    [commitShared, readOnly, setDirty],
  );

  /** Functional form of `commit`, for gesture handlers that only hold a ref to current state. */
  const commitWith = useCallback(
    (mutate: (current: Schema) => Schema) => commit(mutate(schemaRef.current)),
    [commit],
  );

  /** Undo walks only this client's own edits — never a collaborator's. */
  const undo = useCallback(() => {
    if (readOnly) return;
    undoShared();
    setDirty(true);
  }, [readOnly, undoShared, setDirty]);
  const redo = useCallback(() => {
    if (readOnly) return;
    redoShared();
    setDirty(true);
  }, [readOnly, redoShared, setDirty]);

  const patchTable = useCallback(
    (id: string, patch: Partial<Table>) =>
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) =>
          table.id === id ? { ...table, ...patch } : table,
        ),
      })),
    [commitWith],
  );

  const patchColumn = useCallback(
    (tableId: string, columnId: string, patch: Partial<Column>) => {
      /*
       * Changing away from a sized type drops the size with it. Leaving the old
       * VARCHAR2 length on a DATE column would surface as DATE(255) on the card
       * and as a "does not accept a size" validation error the user never typed.
       */
      const applied =
        patch.type && !typeUsesSize(patch.type)
          ? { ...patch, size: "" }
          : patch;
      const next = {
        ...schema,
        tables: schema.tables.map((table) =>
          table.id === tableId
            ? {
                ...table,
                columns: table.columns.map((column) =>
                  column.id === columnId ? { ...column, ...applied } : column,
                ),
              }
            : table,
        ),
      };
      if ("fk" in patch) {
        const relationships = (schema.relationships ?? []).filter(
          (relationship) =>
            !relationship.fields.some(
              (pair) =>
                relationship.startTableId === tableId &&
                pair.startFieldId === columnId,
            ),
        );
        const fk = patch.fk;
        if (fk) {
          const table = schema.tables.find((item) => item.id === tableId);
          const column = table?.columns.find((item) => item.id === columnId);
          const target = schema.tables.find((item) => item.id === fk.tableId);
          const targetColumn = target?.columns.find(
            (item) => item.id === fk.columnId,
          );
          if (table && column && target && targetColumn)
            relationships.push({
              id: nextId("rel"),
              startTableId: table.id,
              startFieldId: column.id,
              endTableId: target.id,
              endFieldId: targetColumn.id,
              fields: [
                { startFieldId: column.id, endFieldId: targetColumn.id },
              ],
              name: `fk_${table.name}_${column.name}_${target.name}`,
              cardinality: "many_to_one",
              manyLabel: "n",
              updateConstraint: "No action",
              deleteConstraint: "No action",
            });
        }
        commit(normalizeRelationships({ ...next, relationships }));
      } else commit(next);
    },
    [commit, schema],
  );

  const deleteTable = useCallback(
    (id: string) => {
      commitWith((current) =>
        normalizeRelationships({
          ...current,
          tables: current.tables
            .filter((table) => table.id !== id)
            .map((table) => ({
              ...table,
              columns: table.columns.map((column) =>
                column.fk?.tableId === id ? { ...column, fk: null } : column,
              ),
            })),
        }),
      );
    },
    [commitWith],
  );

  const deleteColumn = useCallback(
    (tableId: string, columnId: string) =>
      commitWith((current) =>
        normalizeRelationships({
          ...current,
          tables: current.tables.map((table) =>
            table.id === tableId
              ? {
                  ...table,
                  columns: table.columns.filter(
                    (column) => column.id !== columnId,
                  ),
                  /*
                   * `normalizeTables` would prune this on the next load, but
                   * the live schema must not carry an id nothing answers to:
                   * the editor renders a chip per member and the generator
                   * drops a constraint it cannot fully resolve.
                   */
                  uniques: dropColumnFromSets(table.uniques, columnId),
                  indexes: dropColumnFromSets(table.indexes, columnId),
                }
              : {
                  ...table,
                  columns: table.columns.map((column) =>
                    column.fk?.columnId === columnId
                      ? { ...column, fk: null }
                      : column,
                  ),
                },
          ),
        }),
      ),
    [commitWith],
  );

  const addColumn = useCallback(
    (tableId: string) => {
      if (!schemaRef.current.tables.some((item) => item.id === tableId)) return;
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((item) =>
          item.id === tableId
            ? {
                ...item,
                columns: [
                  ...item.columns,
                  makeColumn({ name: `COLUMN_${item.columns.length + 1}` }),
                ],
              }
            : item,
        ),
      }));
    },
    [commitWith],
  );

  const reorderColumns = useCallback(
    (tableId: string, from: number, to: number) => {
      if (from === to) return;
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) => {
          if (table.id !== tableId) return table;
          const columns = [...table.columns];
          const [moved] = columns.splice(from, 1);
          if (!moved) return table;
          columns.splice(to, 0, moved);
          return { ...table, columns };
        }),
      }));
    },
    [commitWith],
  );

  /** Every mutation below rewrites `uniques` whole — see `dropColumnFromSets`. */
  const withUniques = useCallback(
    (
      tableId: string,
      mutate: (uniques: UniqueConstraint[]) => UniqueConstraint[],
    ) =>
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) =>
          table.id === tableId
            ? { ...table, uniques: mutate(table.uniques ?? []) }
            : table,
        ),
      })),
    [commitWith],
  );

  const addUnique = useCallback(
    (tableId: string) =>
      withUniques(tableId, (uniques) => [...uniques, makeUniqueConstraint()]),
    [withUniques],
  );

  const patchUnique = useCallback(
    (tableId: string, uniqueId: string, patch: Partial<UniqueConstraint>) =>
      withUniques(tableId, (uniques) =>
        uniques.map((constraint) =>
          constraint.id === uniqueId ? { ...constraint, ...patch } : constraint,
        ),
      ),
    [withUniques],
  );

  const deleteUnique = useCallback(
    (tableId: string, uniqueId: string) =>
      withUniques(tableId, (uniques) =>
        uniques.filter((constraint) => constraint.id !== uniqueId),
      ),
    [withUniques],
  );

  /** The same shape as `withUniques`, for `indexes`. */
  const withIndexes = useCallback(
    (tableId: string, mutate: (indexes: TableIndex[]) => TableIndex[]) =>
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) =>
          table.id === tableId
            ? { ...table, indexes: mutate(table.indexes ?? []) }
            : table,
        ),
      })),
    [commitWith],
  );

  const addIndex = useCallback(
    (tableId: string, columnIds: string[] = []) =>
      withIndexes(tableId, (indexes) => [...indexes, makeIndex(columnIds)]),
    [withIndexes],
  );

  const patchIndex = useCallback(
    (tableId: string, indexId: string, patch: Partial<TableIndex>) =>
      withIndexes(tableId, (indexes) =>
        indexes.map((index) =>
          index.id === indexId ? { ...index, ...patch } : index,
        ),
      ),
    [withIndexes],
  );

  const deleteIndex = useCallback(
    (tableId: string, indexId: string) =>
      withIndexes(tableId, (indexes) =>
        indexes.filter((index) => index.id !== indexId),
      ),
    [withIndexes],
  );

  const applyTemplate = useCallback(
    (tableId: string, template: ColumnTemplate) =>
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) =>
          table.id === tableId
            ? applyColumnTemplate(
                table,
                // A PostgreSQL diagram takes a template's Oracle types as their PostgreSQL twins.
                dialectOf(current) === "postgres" ? { ...template, columns: template.columns.map((column) => toPostgresColumn(column)) } : template,
              )
            : table,
        ),
      })),
    [commitWith],
  );

  const saveTemplate = useCallback(
    (template: ColumnTemplate) =>
      commitWith((current) => ({
        ...current,
        columnTemplates: [...(current.columnTemplates ?? []), template],
      })),
    [commitWith],
  );

  const deleteTemplate = useCallback(
    (templateId: string) =>
      commitWith((current) => ({
        ...current,
        columnTemplates: (current.columnTemplates ?? []).filter(
          (template) => template.id !== templateId,
        ),
      })),
    [commitWith],
  );

  const tablesById = useMemo(
    () => new Map(schema.tables.map((table) => [table.id, table])),
    [schema.tables],
  );
  const groupsById = useMemo(
    () => new Map((schema.groups ?? []).map((group) => [group.id, group])),
    [schema.groups],
  );
  /**
   * Flat, so resolving a foreign key is two lookups rather than a scan of the
   * target's columns -- that scan ran once per column of every card.
   */
  const columnsById = useMemo(
    () =>
      new Map(
        schema.tables.flatMap((table) =>
          table.columns.map(
            (column) => [column.id, { table, column }] as const,
          ),
        ),
      ),
    [schema.tables],
  );

  const deferredSchema = useDeferredValue(schema);
  // A PostgreSQL diagram is checked as PostgreSQL will see it; see `postgresIssues`.
  const issues = useMemo(
    () => (dialectOf(deferredSchema) === "postgres" ? postgresIssues(deferredSchema) : validateSchema(deferredSchema)),
    [deferredSchema],
  );
  const errors = useMemo(
    () => issues.filter((issue) => issue.severity === "error"),
    [issues],
  );
  const suggestions = useMemo(
    () => lintSchema(deferredSchema),
    [deferredSchema],
  );
  const fixSuggestion = useCallback(
    (finding: LintFinding) => {
      const current = schemaRef.current;
      const next = applyLintFix(current, finding);
      if (next !== current) commit(next);
    },
    [commit],
  );
  const setLintRules = useCallback(
    (enabled: Iterable<string>) => {
      const on = new Set(enabled);
      const disabled = LINT_RULES.map((rule) => rule.id).filter((id) => !on.has(id));
      commitWith((current) => ({ ...current, lint: disabled.length ? { disabled } : undefined }));
    },
    [commitWith],
  );
  /**
   * Generating SQL is the most expensive thing a schema change can trigger, and
   * almost every schema change discards the result: the code panel and the
   * export dialog are the only readers. Gate each generator on a visible reader
   * so typing doesn't rebuild DDL nobody is looking at -- and, when someone is,
   * build it in a worker so typing doesn't wait on it either.
   */
  const ddl = useWorkerDDL(schema, panelMode === "code");

  const value = useMemo(
    () => ({
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
      self,
      cursors,
      setCursor,
      broadcastSelection,
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
      columnsById,
      issues,
      errors,
      suggestions,
      fixSuggestion,
      setLintRules,
      ddl,
    }),
    [
      schema,
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
      self,
      cursors,
      setCursor,
      broadcastSelection,
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
      columnsById,
      issues,
      errors,
      suggestions,
      fixSuggestion,
      setLintRules,
      ddl,
    ],
  );
  return (
    <SchemaContext.Provider value={value}>
      <DialectContext.Provider value={dialectOf(schema)}>{children}</DialectContext.Provider>
    </SchemaContext.Provider>
  );
}
