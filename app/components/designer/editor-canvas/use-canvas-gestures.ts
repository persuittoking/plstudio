"use client";

import { dialectOf, toPostgresColumn } from "@/app/lib/dialect";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { generateDDL } from "@/app/lib/generators";
import {
  exportSchemaJson,
  mergeSchemaJson,
} from "@/app/lib/schema-json";
import {
  duplicateTables,
  EMPTY_SELECTION,
  isSelected,
  marqueeSelection,
  moveSelection,
  movingEntities,
  pruneSelection,
  rectFromPoints,
  removeSelection,
  selectOnly,
  selectionBounds,
  selectionCount,
  selectionSchema,
  toggleSelected,
  type CanvasSelection,
  type Rect,
  type SelectionKind,
} from "@/app/lib/selection";
import {
  FLICK_SPRING,
  SETTLE_SPRING,
  VelocityTracker,
  project,
  type Vec,
} from "@/app/lib/motion";
import {
  groupPrefix,
  makeColumn,
  makeMemo,
  makeSchemaGroup,
  makeTable,
  normalizeRelationships,
  clampTableWidth,
  nextId,
  prefixTableName,
  primaryKeyColumns,
  stripTablePrefix,
  tableHeaderHeight,
  tableHeight,
  tableMinWidth,
  tableWidth,
  type Schema,
  type Table,
  type Column,
  type Memo,
  type SchemaGroup,
  type Relationship,
} from "@/app/lib/schema";
import {
  useDesignerSettings,
  useLayout,
  useSchema,
  useSelect,
  useTransformControls,
} from "@/app/hooks";
import {
  DRAG_THRESHOLD,
  GROUP_MIN_HEIGHT,
  GROUP_MIN_WIDTH,
  MAX_ZOOM,
  MEMO_MAX_HEIGHT,
  MEMO_MAX_WIDTH,
  MEMO_MIN_HEIGHT,
  MEMO_MIN_WIDTH,
  MIN_ZOOM,
  NUDGE,
  ROW_HEIGHT,
  TABLE_GAP,
  ZOOM_SENSITIVITY,
  ZOOM_STEP_LIMIT,
  WHEEL_SETTLE_MS,
} from "../constants";
import {
  enclosedBy,
  insideGroup,
  resizeDelta,
  tidyLayout,
  wheelScale,
} from "../geometry";


/** Canvas space, never screen space — the same coordinates `canvasPoint` returns. */
type Point = { x: number; y: number };

/**
 * A function whose identity never changes but always runs the latest closure.
 * The memo and group cards are `memo`-wrapped, and most of their handlers are
 * plain closures re-created every render -- which is every pointermove while a
 * gesture is live -- so without this every card re-rendered on every frame.
 * Same ref mirror as the listeners use: event handlers only, never render.
 */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/**
 * Everything the canvas does: its gesture state, the pointer and wheel
 * handling, the camera, and the commands that add, move, resize and delete
 * what sits on it. Lifted out of `Workspace` so the code lives beside the
 * canvas it drives.
 *
 * It stays a hook rather than a provider because the appbar's menus and the
 * global key handler fire these same commands from outside the canvas subtree,
 * so the values have to surface at the `Workspace` level either way.
 */
export function useCanvasGestures({ readOnly }: { readOnly: boolean }) {
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
    collabStatus,
    peers,
    setCursor,
    broadcastSelection,
    patchTable,
    patchColumn,
    deleteTable,
    deleteColumn,
    addColumn,
    reorderColumns,
    groupsById,
    columnsById,
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
  const { setPanelTab, setSidebarOpen } = useLayout();
  /*
   * The card style decides how tall a card is, and so where its rows, its
   * collisions and its bounds fall. Read through a ref, like the rest of the
   * state the long-lived listeners need, so a style change re-subscribes nothing.
   */
  const { settings } = useDesignerSettings();
  const cardStyleRef = useRef(settings.cardStyle);
  cardStyleRef.current = settings.cardStyle;
  const heightOf = useCallback((table: Table) => tableHeight(table, cardStyleRef.current), []);
  /*
   * Controls only. The hook *drives* the camera and never renders from it, so
   * reading `useTransform()` here would re-render the whole canvas on every
   * frame of a pan for no gain — `panRef`/`zoomRef` carry the live value.
   */
  const {
    setZoom,
    setPan,
    applyViewport,
    viewportRef,
    panRef,
    zoomRef,
    springsRef,
    stopAnimationRef,
    stopAnimation,
    animateTo,
  } = useTransformControls();
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  /**
   * Memos that have held text at some point. A memo left blank was never really
   * created, so blurring it discards it; one the user has just emptied is a memo
   * they are still editing, and silently deleting it on a stray click away would
   * destroy work. Seeded on focus so memos loaded from the document count too.
   */
  const memoHadText = useRef(new Set<string>());

  /** Live position of the table under the pointer; schema is written once on release. */
  const [dragPosition, setDragPosition] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  /** Live width of the table being resized; committed once on release. */
  const [resizeTable, setResizeTable] = useState<{
    id: string;
    width: number;
  } | null>(null);
  const [dragMemoPosition, setDragMemoPosition] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [resizeMemo, setResizeMemo] = useState<{
    id: string;
    width: number;
    height: number;
  } | null>(null);
  /**
   * `dx`/`dy` are the offset from the group's committed origin. Members ride
   * along on that delta, so a group drag stays one state write per frame no
   * matter how many tables and memos sit inside it.
   */
  const [dragGroupPosition, setDragGroupPosition] = useState<{
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const [resizeGroup, setResizeGroup] = useState<{
    id: string;
    width: number;
    height: number;
  } | null>(null);
  /**
   * The offset a multi-selection is currently dragged by. One delta for the
   * whole set, on the same reasoning as `dragGroupPosition`: a state write per
   * frame per selected card would make a fifty-table drag fifty times the work.
   */
  const [dragSelection, setDragSelection] = useState<{
    dx: number;
    dy: number;
  } | null>(null);
  /** The rectangle being swept, in canvas space. Null when no marquee is live. */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  /**
   * The hand tool. `handMode` is the sticky dock toggle; `spaceHeld` is the
   * momentary hold. Panning reads the union, so the two can never disagree —
   * releasing Space while the toggle is on leaves hand mode on, as in Figma.
   */
  const [handMode, setHandMode] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panMode = handMode || spaceHeld;

  const [linking, setLinking] = useState<{
    pointerId: number;
    sourceTableId: string;
    sourceColumnId: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  /* The element `applyViewport` writes to; the provider owns it so both can. */
  const canvasRef = viewportRef;
  /**
   * Gesture state lives in refs, not state: it updates every pointermove and
   * must not schedule a React render per frame.
   */
  const gestureRef = useRef<{
    mode:
      | "table"
      | "table-resize"
      | "memo"
      | "memo-resize"
      | "group"
      | "group-resize"
      | "pan"
      /** Sweeping a rectangle over empty canvas. */
      | "marquee"
      /** Dragging everything selected, as one. */
      | "selection";
    pointerId: number;
    tableId?: string;
    groupId?: string;
    memoId?: string;
    /** What the marquee unions onto — the selection held when the sweep began. */
    base?: CanvasSelection;
    grabX: number;
    grabY: number;
    originX: number;
    originY: number;
    originWidth?: number;
    originHeight?: number;
    startX: number;
    startY: number;
    moved: boolean;
    tracker: VelocityTracker;
  } | null>(null);
  const dragPositionRef = useRef(dragPosition);
  /**
   * The release handler needs the live gesture values, but reading them from
   * state would put them in the pointer effect's dependency array — and they
   * change every frame, so the window listeners would be torn down and
   * re-attached ~60 times a second. Mirror them into refs instead.
   */
  const dragGroupPositionRef = useRef(dragGroupPosition);
  const resizeGroupRef = useRef(resizeGroup);
  const dragMemoPositionRef = useRef(dragMemoPosition);
  const resizeMemoRef = useRef(resizeMemo);
  const resizeTableRef = useRef(resizeTable);
  const dragSelectionRef = useRef(dragSelection);
  dragSelectionRef.current = dragSelection;
  dragGroupPositionRef.current = dragGroupPosition;
  resizeGroupRef.current = resizeGroup;
  dragMemoPositionRef.current = dragMemoPosition;
  resizeMemoRef.current = resizeMemo;
  resizeTableRef.current = resizeTable;

  dragPositionRef.current = dragPosition;

  useEffect(
    () => broadcastSelection(selection.tables),
    [selection.tables, broadcastSelection],
  );

  /**
   * A commit — this client's or a collaborator's — can remove something that is
   * selected here. Prune in one place rather than at every delete site;
   * `pruneSelection` returns the same object when nothing went, so this cannot
   * loop.
   */
  useEffect(
    () => setSelection((current) => pruneSelection(schema, current)),
    [schema],
  );

  /** Which collaborator, if any, has a given table selected — drives its ring colour. */
  const peerSelection = useMemo(
    () =>
      new Map(
        peers.flatMap((peer) =>
          peer.selectedIds.map((id) => [id, peer] as const),
        ),
      ),
    [peers],
  );

  /**
   * Everything travelling under the current multi-selection drag. Sets, so a
   * card that is both selected outright and a member of a selected group is
   * offset once; empty while no such drag is in flight, which is the common case.
   */
  const movingSet = useMemo(
    () =>
      dragSelection
        ? movingEntities(schema, selection)
        : {
            tables: new Set<string>(),
            memos: new Set<string>(),
            groups: new Set<string>(),
          },
    [dragSelection, schema, selection],
  );

  /**
   * The box drawn around a multi-selection. Only for two or more: one card
   * already says what it is with its own accent border, and a frame around it
   * would just be a second outline.
   */
  const multiFrame = useMemo(() => {
    if (selectionCount(selection) < 2) return null;
    const bounds = selectionBounds(schema, selection, settings.cardStyle);
    if (!bounds) return null;
    return dragSelection
      ? {
          ...bounds,
          x: bounds.x + dragSelection.dx,
          y: bounds.y + dragSelection.dy,
        }
      : bounds;
  }, [dragSelection, schema, selection, settings.cardStyle]);

  /**
   * A table's on-screen position: the in-flight one while it moves, else its
   * committed one shifted by the drag of the group it belongs to or the
   * selection it is part of.
   */
  const livePosition = useCallback(
    (table: Table) => {
      if (dragPosition && dragPosition.id === table.id)
        return { x: dragPosition.x, y: dragPosition.y };
      if (dragGroupPosition && table.schemaId === dragGroupPosition.id)
        return {
          x: table.x + dragGroupPosition.dx,
          y: table.y + dragGroupPosition.dy,
        };
      if (dragSelection && movingSet.tables.has(table.id))
        return { x: table.x + dragSelection.dx, y: table.y + dragSelection.dy };
      return { x: table.x, y: table.y };
    },
    [dragGroupPosition, dragPosition, dragSelection, movingSet],
  );
  const livePositionRef = useRef(livePosition);
  livePositionRef.current = livePosition;
  /**
   * A table's on-screen width: the in-flight one while it is being resized,
   * else `tableWidth` -- the stored override or the content fit, never under the content. Relationship
   * anchors read this so the right-hand edge stays attached during a resize.
   */
  const liveWidth = useCallback(
    (table: Table) =>
      resizeTable && resizeTable.id === table.id
        ? resizeTable.width
        : tableWidth(table),
    [resizeTable],
  );
  const liveWidthRef = useRef(liveWidth);
  liveWidthRef.current = liveWidth;
  const liveMemo = useCallback(
    (memo: Memo) => {
      const position =
        dragMemoPosition?.id === memo.id ? dragMemoPosition : memo;
      const size = resizeMemo?.id === memo.id ? resizeMemo : memo;
      const rides =
        dragMemoPosition?.id !== memo.id &&
        dragGroupPosition &&
        memo.schemaId === dragGroupPosition.id;
      const swept = dragSelection && movingSet.memos.has(memo.id);
      // The memo itself when nothing moves it, so `MemoCard`'s memo holds.
      if (position === memo && size === memo && !rides && !swept) return memo;
      return {
        x:
          position.x +
          (rides ? dragGroupPosition.dx : 0) +
          (swept ? dragSelection.dx : 0),
        y:
          position.y +
          (rides ? dragGroupPosition.dy : 0) +
          (swept ? dragSelection.dy : 0),
        width: size.width,
        height: size.height,
      };
    },
    [dragGroupPosition, dragMemoPosition, dragSelection, movingSet, resizeMemo],
  );
  const liveGroup = useCallback(
    (group: SchemaGroup) => {
      const position =
        dragGroupPosition?.id === group.id ? dragGroupPosition : group;
      const size = resizeGroup?.id === group.id ? resizeGroup : group;
      const swept = dragSelection && movingSet.groups.has(group.id);
      if (position === group && size === group && !swept) return group;
      return {
        x: position.x + (swept ? dragSelection.dx : 0),
        y: position.y + (swept ? dragSelection.dy : 0),
        width: size.width,
        height: size.height,
      };
    },
    [dragGroupPosition, dragSelection, movingSet, resizeGroup],
  );
  const liveGroupRef = useRef(liveGroup);
  liveGroupRef.current = liveGroup;

  /**
   * The canvas rect is read on every pointermove — to place the cursor, to
   * clamp a pan, to convert a drag to canvas space — and each read is a forced
   * layout, interleaved with the state writes of the same frame. It only
   * changes when the canvas is resized or the page scrolls, so cache it and
   * invalidate on those.
   */
  const canvasRectRef = useRef<DOMRect | null>(null);
  const canvasRect = useCallback(() => {
    if (!canvasRectRef.current)
      canvasRectRef.current =
        canvasRef.current?.getBoundingClientRect() ?? null;
    return canvasRectRef.current;
  }, []);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const invalidate = () => {
      canvasRectRef.current = null;
    };
    // A ResizeObserver covers what a window resize misses: collapsing the
    // sidebar resizes the canvas without resizing the window.
    const observer = new ResizeObserver(invalidate);
    observer.observe(element);
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", invalidate, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate, true);
    };
  }, []);

  const canvasPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = canvasRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
        y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
      };
    },
    [canvasRect, panRef, zoomRef],
  );
  const rowPoint = useCallback(
    (table: Table, columnIndex: number) => {
      const position = livePosition(table);
      return {
        x: position.x,
        y:
          position.y +
          tableHeaderHeight(table, cardStyleRef.current) +
          columnIndex * ROW_HEIGHT +
          ROW_HEIGHT / 2,
      };
    },
    [livePosition],
  );
  const rowPointRef = useRef(rowPoint);
  rowPointRef.current = rowPoint;
  /**
   * Takes ids rather than records, and resolves them through refs, so its
   * identity survives a schema change — the table cards memoize on their props,
   * and a handler rebuilt every render would defeat that.
   */
  const startLinking = useCallback(
    (
      event: ReactPointerEvent,
      tableId: string,
      columnId: string,
      columnIndex: number,
    ) => {
      event.stopPropagation();
      const table = schemaRef.current.tables.find(
        (item) => item.id === tableId,
      );
      if (!table) return;
      const point = rowPointRef.current(table, columnIndex);
      setLinking({
        pointerId: event.pointerId,
        sourceTableId: tableId,
        sourceColumnId: columnId,
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
      });
    },
    [],
  );
  const finishLinking = (event: ReactPointerEvent) => {
    if (!linking || linking.pointerId !== event.pointerId) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-table-id][data-column-id]");
    const targetTableId = target?.dataset.tableId;
    const targetColumnId = target?.dataset.columnId;
    if (
      targetTableId &&
      targetColumnId &&
      !(
        targetTableId === linking.sourceTableId &&
        targetColumnId === linking.sourceColumnId
      )
    ) {
      const sourceTable = schema.tables.find(
        (table) => table.id === linking.sourceTableId,
      );
      const sourceColumn = sourceTable?.columns.find(
        (column) => column.id === linking.sourceColumnId,
      );
      const targetTable = schema.tables.find(
        (table) => table.id === targetTableId,
      );
      const targetColumn = targetTable?.columns.find(
        (column) => column.id === targetColumnId,
      );
      if (
        sourceTable &&
        sourceColumn &&
        targetTable &&
        targetColumn &&
        sourceColumn.type === targetColumn.type
      ) {
        const child = sourceColumn.pk
          ? { table: targetTable, column: targetColumn }
          : { table: sourceTable, column: sourceColumn };
        const parent = sourceColumn.pk
          ? { table: sourceTable, column: sourceColumn }
          : { table: targetTable, column: targetColumn };
        if (!child.column.pk && parent.column.pk) {
          const relationship: Relationship = {
            id: nextId("rel"),
            startTableId: child.table.id,
            startFieldId: child.column.id,
            endTableId: parent.table.id,
            endFieldId: parent.column.id,
            fields: [
              { startFieldId: child.column.id, endFieldId: parent.column.id },
            ],
            name: `fk_${child.table.name}_${child.column.name}_${parent.table.name}`,
            cardinality: "many_to_one",
            manyLabel: "n",
            updateConstraint: "No action",
            deleteConstraint: "No action",
          };
          commit(
            normalizeRelationships({
              ...schema,
              relationships: [...(schema.relationships ?? []), relationship],
            }),
          );
          setPanelTab("relationships");
          toast.success(
            `Linked ${child.table.name}.${child.column.name} to ${parent.table.name}.${parent.column.name}.`,
          );
        }
      }
    }
    setLinking(null);
  };

  const selected =
    schema.tables.find((table) => table.id === selectedId) ?? null;

  const foreignKeyTarget = useCallback(
    (column: Column) => {
      if (!column.fk) return undefined;
      const found = columnsById.get(column.fk.columnId);
      // The id pair has to agree: a column may have been moved to another table
      // since the key was set, and the reference is stale rather than valid.
      return found && found.table.id === column.fk.tableId ? found : undefined;
    },
    [columnsById],
  );


  /**
   * `at` is the canvas-space point a context menu was opened at: an object
   * created from the menu belongs where the user right-clicked, not in the
   * staggered slot the keyboard shortcut uses.
   */
  const addTable = (groupId?: string, at?: Point) => {
    const target = (schema.groups ?? []).find(
      (group) =>
        group.id ===
        (groupId ??
          selectedGroupId ??
          schema.tables.find((table) => table.id === selectedId)?.schemaId),
    );
    const index = schema.tables.length;
    const made = makeTable(
      prefixTableName(`TABLE_${index + 1}`, groupPrefix(target)),
      at?.x ?? 90 + (index % 4) * 70,
      at?.y ?? 100 + (index % 3) * 75,
      index,
    );
    // A PostgreSQL diagram's new table starts as PostgreSQL would have it: a bigint identity key.
    const base = dialectOf(schema) === "postgres"
      ? { ...made, keyStrategy: "identity" as const, columns: made.columns.map((column) => toPostgresColumn(column)) }
      : made;
    const table = target
      ? {
          ...base,
          schemaId: target.id,
          ...insideGroup(
            target,
            base,
            schema.tables.filter((item) => item.schemaId === target.id).length,
            at,
            settings.cardStyle,
          ),
        }
      : base;
    commit({ ...schema, tables: [...schema.tables, table] });
    selectTable(table.id);
  };
  const autoLayout = () => commit(tidyLayout(schema, settings.cardStyle));
  const fitView = () => {
    if (
      !canvasRef.current ||
      (!schema.tables.length && !(schema.groups ?? []).length)
    )
      return;
    stopAnimationRef.current?.();
    stopAnimationRef.current = null;
    const rect = canvasRef.current.getBoundingClientRect();
    const padding = 48;
    const minX = Math.min(
      ...schema.tables.map((table) => table.x),
      ...(schema.groups ?? []).map((group) => group.x),
    );
    const minY = Math.min(
      ...schema.tables.map((table) => table.y),
      ...(schema.groups ?? []).map((group) => group.y),
    );
    const maxX = Math.max(
      ...schema.tables.map((table) => table.x + tableWidth(table)),
      ...(schema.groups ?? []).map((group) => group.x + group.width),
    );
    const maxY = Math.max(
      ...schema.tables.map((table) => table.y + heightOf(table)),
      ...(schema.groups ?? []).map((group) => group.y + group.height),
    );
    const next = Math.max(
      MIN_ZOOM,
      Math.min(
        1.15,
        Math.min(
          (rect.width - padding * 2) / Math.max(1, maxX - minX),
          (rect.height - padding * 2) / Math.max(1, maxY - minY),
        ),
      ),
    );
    setZoom(next);
    // Centre the diagram's bounding box rather than resetting to a fixed corner.
    setPan({
      x: (rect.width - (maxX - minX) * next) / 2 - minX * next,
      y: (rect.height - (maxY - minY) * next) / 2 - minY * next,
    });
  };

  /**
   * Centre the viewport on a subset of tables — what an import lands with, so
   * the tables it just added are the thing on screen. Zoom only ever comes
   * down, and only far enough to fit them: an import of two tables into a
   * forty-table diagram should not reframe the diagram.
   */
  const revealTables = (tables: Table[]) => {
    if (!canvasRef.current || !tables.length) return;
    stopAnimationRef.current?.();
    stopAnimationRef.current = null;
    const rect = canvasRef.current.getBoundingClientRect();
    const padding = 64;
    const minX = Math.min(...tables.map((table) => table.x));
    const minY = Math.min(...tables.map((table) => table.y));
    const maxX = Math.max(
      ...tables.map((table) => table.x + tableWidth(table)),
    );
    const maxY = Math.max(
      ...tables.map((table) => table.y + heightOf(table)),
    );
    const next = Math.max(
      MIN_ZOOM,
      Math.min(
        zoomRef.current,
        (rect.width - padding * 2) / Math.max(1, maxX - minX),
        (rect.height - padding * 2) / Math.max(1, maxY - minY),
      ),
    );
    setZoom(next);
    setPan({
      x: (rect.width - (maxX - minX) * next) / 2 - minX * next,
      y: (rect.height - (maxY - minY) * next) / 2 - minY * next,
    });
  };

  const resolveTablePosition = useCallback(
    (id: string, x: number, y: number) => {
      const tables = schemaRef.current.tables;
      const table = tables.find((candidate) => candidate.id === id);
      if (!table) return { x, y };
      const settle = (value: Vec) => ({
        x: Math.round(value.x),
        y: Math.round(value.y),
      });
      const hits = (position: Vec, other: Table) =>
        position.x < other.x + tableWidth(other) + TABLE_GAP &&
        position.x + tableWidth(table) + TABLE_GAP > other.x &&
        position.y < other.y + heightOf(other) + TABLE_GAP &&
        position.y + heightOf(table) + TABLE_GAP > other.y;
      const overlapping = (position: Vec) =>
        tables.find((other) => other.id !== id && hits(position, other));
      /**
       * Slide out of `other` along whichever axis it is least buried in, so the
       * table rests against its neighbour instead of being flung to the first
       * free slot in some arbitrary search order.
       */
      const pushOut = (position: Vec, other: Table) => {
        const moves = [
          { x: other.x - tableWidth(table) - TABLE_GAP, y: position.y },
          { x: other.x + tableWidth(other) + TABLE_GAP, y: position.y },
          { x: position.x, y: other.y - heightOf(table) - TABLE_GAP },
          { x: position.x, y: other.y + heightOf(other) + TABLE_GAP },
        ];
        return moves.reduce((best, move) =>
          Math.hypot(move.x - position.x, move.y - position.y) <
          Math.hypot(best.x - position.x, best.y - position.y)
            ? move
            : best,
        );
      };
      let position = settle({ x, y });
      // Each push can land on a different neighbour; a handful of passes settles
      // any realistic cluster, and the cap is what guarantees termination now
      // that no edge can stop the walk early.
      for (let pass = 0; pass < 8; pass += 1) {
        const other = overlapping(position);
        if (!other) return position;
        position = settle(pushOut(position, other));
      }
      return position;
    },
    [],
  );

  /**
   * Writes an already-resolved position. Deliberately leaves `dragPosition`
   * alone: the release path commits *before* the settle animation runs, and
   * clearing it here would snap the card to its target and then yank it back to
   * the drop point on the animation's first frame.
   */
  const writeTablePosition = useCallback(
    (id: string, x: number, y: number, schemaId?: string | null) => {
      if (readOnly) return;
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) =>
          table.id === id
            ? {
                ...table,
                x,
                y,
                schemaId:
                  schemaId === undefined
                    ? table.schemaId
                    : schemaId || undefined,
              }
            : table,
        ),
      }));
    },
    [commitWith, readOnly],
  );

  const commitTableWidth = useCallback(
    (id: string, width: number) => {
      if (readOnly) {
        setResizeTable(null);
        return;
      }
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) =>
          table.id === id
            ? { ...table, width: clampTableWidth(Math.max(width, tableMinWidth(table))) }
            : table,
        ),
      }));
      setResizeTable(null);
    },
    [commitWith, readOnly],
  );

  /** Drops the manual override so the card goes back to fitting its content. */
  const resetTableWidth = useCallback(
    (id: string) => {
      if (readOnly) return;
      if (
        schemaRef.current.tables.find((table) => table.id === id)?.width ===
        undefined
      )
        return;
      commitWith((current) => ({
        ...current,
        tables: current.tables.map((table) =>
          table.id === id ? { ...table, width: undefined } : table,
        ),
      }));
      setResizeTable(null);
    },
    [commitWith, readOnly],
  );

  const commitPosition = useCallback(
    (id: string, x: number, y: number, schemaId?: string | null) => {
      if (readOnly) return;
      const resolved = resolveTablePosition(id, x, y);
      writeTablePosition(id, resolved.x, resolved.y, schemaId);
      setDragPosition(null);
    },
    [readOnly, resolveTablePosition, writeTablePosition],
  );

  const commitGroupPosition = useCallback(
    (id: string, x: number, y: number) => {
      if (readOnly) return;
      /*
       * Resolve inside the updater, against the schema being committed: a
       * remote edit can land between pointerup and here, and the delta the
       * members move by has to be measured from the same origin the group
       * lands on.
       */
      commitWith((next) => {
        const group = (next.groups ?? []).find((item) => item.id === id);
        if (!group) return next;
        const nextX = Math.round(x);
        const nextY = Math.round(y);
        const dx = nextX - group.x;
        const dy = nextY - group.y;
        return {
          ...next,
          groups: (next.groups ?? []).map((item) =>
            item.id === id ? { ...item, x: nextX, y: nextY } : item,
          ),
          /*
           * No `resolveTablePosition` pass over the members: its overlap
           * push-out would rearrange the layout the user built inside the
           * schema, which is the one thing relocating it must preserve.
           */
          tables: next.tables.map((table) =>
            table.schemaId === id
              ? { ...table, x: table.x + dx, y: table.y + dy }
              : table,
          ),
          memos: next.memos?.map((memo) =>
            memo.schemaId === id
              ? { ...memo, x: memo.x + dx, y: memo.y + dy }
              : memo,
          ),
        };
      });
      setDragGroupPosition(null);
    },
    [commitWith, readOnly],
  );

  const commitGroupSize = useCallback(
    (id: string, width: number, height: number) => {
      if (readOnly) return;
      const current = schemaRef.current;
      if (!current.groups?.some((item) => item.id === id)) return;
      const group = current.groups.find((item) => item.id === id);
      if (!group) return;
      // Only a floor. A group may grow as far to the right and down as the
      // person dragging it wants to take it.
      const nextWidth = Math.max(GROUP_MIN_WIDTH, Math.round(width));
      const nextHeight = Math.max(GROUP_MIN_HEIGHT, Math.round(height));
      commitWith((next) => ({
        ...next,
        groups: (next.groups ?? []).map((item) =>
          item.id === id
            ? {
                ...item,
                width: nextWidth,
                height: nextHeight,
              }
            : item,
        ),
        tables: next.tables.map((table) => {
          if (table.schemaId !== undefined && table.schemaId !== id)
            return table;
          const inside = enclosedBy(
            { x: group.x, y: group.y, width: nextWidth, height: nextHeight },
            table.x + tableWidth(table) / 2,
            table.y + heightOf(table) / 2,
          );
          return { ...table, schemaId: inside ? id : undefined };
        }),
        memos: next.memos?.map((memo) => {
          if (memo.schemaId !== undefined && memo.schemaId !== id) return memo;
          const inside = enclosedBy(
            { x: group.x, y: group.y, width: nextWidth, height: nextHeight },
            memo.x + memo.width / 2,
            memo.y + memo.height / 2,
          );
          return { ...memo, schemaId: inside ? id : undefined };
        }),
      }));
      setResizeGroup(null);
    },
    [commitWith, readOnly],
  );

  const commitMemoPosition = useCallback(
    (id: string, x: number, y: number, schemaId?: string | null) => {
      if (readOnly) return;
      const current = schemaRef.current;
      const memo = current.memos?.find((item) => item.id === id);
      if (!memo) return;
      commitWith((next) => ({
        ...next,
        memos: (next.memos ?? []).map((item) =>
          item.id === id
            ? {
                ...item,
                x: Math.round(x),
                y: Math.round(y),
                schemaId:
                  schemaId === undefined
                    ? item.schemaId
                    : schemaId || undefined,
              }
            : item,
        ),
      }));
      setDragMemoPosition(null);
    },
    [commitWith, readOnly],
  );

  const commitMemoSize = useCallback(
    (id: string, width: number, height: number) => {
      if (readOnly) return;
      const current = schemaRef.current;
      if (!current.memos?.some((item) => item.id === id)) return;
      commitWith((next) => ({
        ...next,
        memos: (next.memos ?? []).map((item) =>
          item.id === id
            ? {
                ...item,
                width: Math.max(
                  MEMO_MIN_WIDTH,
                  Math.min(MEMO_MAX_WIDTH, Math.round(width)),
                ),
                height: Math.max(
                  MEMO_MIN_HEIGHT,
                  Math.min(MEMO_MAX_HEIGHT, Math.round(height)),
                ),
              }
            : item,
        ),
      }));
      setResizeMemo(null);
    },
    [commitWith, readOnly],
  );

  useEffect(() => {
    let moveFrame: number | null = null;
    let pendingMoveAction: (() => void) | null = null;

    const flushMove = () => {
      if (moveFrame !== null) {
        cancelAnimationFrame(moveFrame);
        moveFrame = null;
      }
      if (pendingMoveAction) {
        const action = pendingMoveAction;
        pendingMoveAction = null;
        action();
      }
    };

    const scheduleMove = (action: () => void) => {
      pendingMoveAction = action;
      if (moveFrame === null) {
        moveFrame = requestAnimationFrame(() => {
          moveFrame = null;
          if (pendingMoveAction) {
            const act = pendingMoveAction;
            pendingMoveAction = null;
            act();
          }
        });
      }
    };

    const move = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const now = event.timeStamp || performance.now();
      if (
        !gesture.moved &&
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ) < DRAG_THRESHOLD
      ) {
        return; // hysteresis: not a drag yet
      }
      gesture.moved = true;

      if (gesture.mode === "pan") {
        // Straight 1:1 with the pointer. There is no edge to resist against,
        // so there is nothing for a rubber band to mean.
        const next = {
          x: gesture.originX + event.clientX - gesture.startX,
          y: gesture.originY + event.clientY - gesture.startY,
        };
        gesture.tracker.add(next.x, next.y, now);
        scheduleMove(() => applyViewport(next, zoomRef.current));
        return;
      }

      const rect = canvasRect();
      if (gesture.mode === "marquee" || gesture.mode === "selection") {
        if (!rect) return;
        const point = {
          x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
          y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
        };
        if (gesture.mode === "marquee") {
          const swept = rectFromPoints(
            gesture.originX,
            gesture.originY,
            point.x,
            point.y,
          );
          // Recompute the hit set every frame rather than on release: cards
          // that light up as the rectangle crosses them are how the user knows
          // what they are about to get.
          const next = marqueeSelection(
            schemaRef.current,
            swept,
            gesture.base ?? EMPTY_SELECTION,
            cardStyleRef.current,
          );
          scheduleMove(() => {
            setMarquee(swept);
            setSelection(next);
          });
          return;
        }
        const next = {
          dx: point.x - gesture.grabX,
          dy: point.y - gesture.grabY,
        };
        gesture.tracker.add(next.dx, next.dy, now);
        scheduleMove(() => setDragSelection(next));
        return;
      }
      const group = schemaRef.current.groups?.find(
        (item) => item.id === gesture.groupId,
      );
      if (gesture.mode === "group" || gesture.mode === "group-resize") {
        if (!rect || !group) return;
        const point = {
          x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
          y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
        };
        if (gesture.mode === "group") {
          const x = point.x - gesture.grabX;
          const y = point.y - gesture.grabY;
          const nextGroup = {
            id: group.id,
            x,
            y,
            dx: x - group.x,
            dy: y - group.y,
          };
          scheduleMove(() => setDragGroupPosition(nextGroup));
        } else {
          const nextResize = {
            id: group.id,
            width: Math.max(
              GROUP_MIN_WIDTH,
              gesture.originWidth! + point.x - gesture.grabX,
            ),
            height: Math.max(
              GROUP_MIN_HEIGHT,
              gesture.originHeight! + point.y - gesture.grabY,
            ),
          };
          scheduleMove(() => setResizeGroup(nextResize));
        }
        return;
      }
      const memo = schemaRef.current.memos?.find(
        (item) => item.id === gesture.memoId,
      );
      if (gesture.mode === "memo" || gesture.mode === "memo-resize") {
        if (!rect || !memo) return;
        const point = {
          x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
          y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
        };
        if (gesture.mode === "memo") {
          const nextMemo = {
            id: memo.id,
            x: point.x - gesture.grabX,
            y: point.y - gesture.grabY,
          };
          scheduleMove(() => setDragMemoPosition(nextMemo));
        } else {
          const nextMemoResize = {
            id: memo.id,
            width: Math.max(
              MEMO_MIN_WIDTH,
              Math.min(
                MEMO_MAX_WIDTH,
                gesture.originWidth! + point.x - gesture.grabX,
              ),
            ),
            height: Math.max(
              MEMO_MIN_HEIGHT,
              Math.min(
                MEMO_MAX_HEIGHT,
                gesture.originHeight! + point.y - gesture.grabY,
              ),
            ),
          };
          scheduleMove(() => setResizeMemo(nextMemoResize));
        }
        return;
      }

      const table = schemaRef.current.tables.find(
        (item) => item.id === gesture.tableId,
      );
      if (!rect || !table) return;

      if (gesture.mode === "table-resize") {
        const pointX =
          (event.clientX - rect.left - panRef.current.x) / zoomRef.current;
        // The content is a hard floor: past it a name would ellipsize.
        const width = Math.max(
          tableMinWidth(table),
          clampTableWidth(gesture.originWidth! + pointX - gesture.grabX),
        );
        scheduleMove(() => setResizeTable({ id: table.id, width }));
        return;
      }

      const next = {
        x:
          (event.clientX - rect.left - panRef.current.x) / zoomRef.current -
          gesture.grabX,
        y:
          (event.clientY - rect.top - panRef.current.y) / zoomRef.current -
          gesture.grabY,
      };
      gesture.tracker.add(next.x, next.y, now);
      scheduleMove(() => setDragPosition({ id: table.id, ...next }));
    };

    const up = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      flushMove();
      gestureRef.current = null;
      setGrabbing(false);
      const now = event.timeStamp || performance.now();
      const velocity = gesture.tracker.velocity(now);

      if (gesture.mode === "pan") {
        if (!gesture.moved) return;
        const current = panRef.current;
        // Where the flick is going, not where a wall would have stopped it.
        const target = {
          x: current.x + project(velocity.x),
          y: current.y + project(velocity.y),
        };
        const flicked = Math.hypot(velocity.x, velocity.y) > 60;
        animateTo(
          current,
          target,
          velocity,
          flicked ? FLICK_SPRING : SETTLE_SPRING,
          (value) => applyViewport(value, zoomRef.current),
          // One commit for the whole flick, once it has come to rest.
          (value) => setPan(value),
        );
        return;
      }

      if (gesture.mode === "marquee") {
        setMarquee(null);
        // A sweep that never passed the threshold is a click on empty canvas,
        // which is how the selection is cleared.
        if (!gesture.moved) setSelection(gesture.base ?? EMPTY_SELECTION);
        return;
      }

      if (gesture.mode === "selection") {
        const live = dragSelectionRef.current;
        if (!gesture.moved || !live) {
          setDragSelection(null);
          return;
        }
        const selected = selectionRef.current;
        const target = {
          x: live.dx + project(velocity.x),
          y: live.dy + project(velocity.y),
        };
        const flicked = Math.hypot(velocity.x, velocity.y) > 60;
        // Commit on release, spring afterwards — the same invariant the single
        // table drag documents below.
        commitWith((current) =>
          moveSelection(current, selected, target.x, target.y),
        );
        animateTo(
          { x: live.dx, y: live.dy },
          target,
          velocity,
          flicked ? FLICK_SPRING : SETTLE_SPRING,
          // The schema already holds the move, so the spring animates the
          // *residual* — how far the cards still are from where they landed.
          (value) =>
            setDragSelection({
              dx: value.x - target.x,
              dy: value.y - target.y,
            }),
          () => setDragSelection(null),
        );
        /*
         * A residual left frozen by an interrupted settle would offset the whole
         * set until the next selection drag, so hang the cleanup off the stop
         * handle: grabbing, panning or zooming mid-flight now drops it and the
         * cards sit where the schema already says they are. Wrapping *after*
         * `animateTo` matters — it calls `stopAnimation` itself on the way in,
         * and clearing there would snap the set home for a frame.
         */
        const stop = stopAnimationRef.current;
        if (stop)
          stopAnimationRef.current = () => {
            stop();
            setDragSelection(null);
          };
        return;
      }

      const memo = schemaRef.current.memos?.find(
        (item) => item.id === gesture.memoId,
      );
      const group = schemaRef.current.groups?.find(
        (item) => item.id === gesture.groupId,
      );
      if (gesture.mode === "group" && group) {
        const live = dragGroupPositionRef.current;
        if (gesture.moved && live?.id === group.id)
          commitGroupPosition(group.id, live.x, live.y);
        else setDragGroupPosition(null);
        return;
      }
      if (gesture.mode === "group-resize" && group) {
        const live = resizeGroupRef.current;
        if (gesture.moved && live?.id === group.id)
          commitGroupSize(group.id, live.width, live.height);
        else setResizeGroup(null);
        return;
      }
      if (gesture.mode === "memo" && memo) {
        const live = dragMemoPositionRef.current;
        if (gesture.moved && live?.id === memo.id) {
          const landing = { x: live.x, y: live.y };
          const targetGroup = (schemaRef.current.groups ?? []).find((group) =>
            enclosedBy(
              liveGroupRef.current(group),
              landing.x + memo.width / 2,
              landing.y + memo.height / 2,
            ),
          );
          commitMemoPosition(
            memo.id,
            landing.x,
            landing.y,
            targetGroup?.id ?? null,
          );
        } else {
          setDragMemoPosition(null);
        }
        return;
      }
      if (gesture.mode === "memo-resize" && memo) {
        const live = resizeMemoRef.current;
        if (gesture.moved && live?.id === memo.id) {
          commitMemoSize(memo.id, live.width, live.height);
        } else {
          setResizeMemo(null);
        }
        return;
      }

      const table = schemaRef.current.tables.find(
        (item) => item.id === gesture.tableId,
      );
      if (!table) return;

      if (gesture.mode === "table-resize") {
        const live = resizeTableRef.current;
        if (gesture.moved && live?.id === table.id) {
          commitTableWidth(table.id, live.width);
        } else {
          setResizeTable(null);
        }
        return;
      }

      if (!gesture.moved) {
        setDragPosition(null);
        return; // a tap, not a drag — selection already happened on pointerdown
      }
      const current = {
        x: gesture.originX,
        y: gesture.originY,
      };
      const live = dragPositionRef.current;
      const from =
        live && live.id === table.id ? { x: live.x, y: live.y } : current;
      const projected = {
        x: from.x + project(velocity.x),
        y: from.y + project(velocity.y),
      };
      const target = resolveTablePosition(table.id, projected.x, projected.y);
      const tableCenter = {
        x: target.x + tableWidth(table) / 2,
        y: target.y + heightOf(table) / 2,
      };
      const targetGroup = (schemaRef.current.groups ?? []).find((group) =>
        enclosedBy(liveGroupRef.current(group), tableCenter.x, tableCenter.y),
      );
      const flicked = Math.hypot(velocity.x, velocity.y) > 60;
      /**
       * Commit on release, not on settle. Every gesture entry point calls
       * `stopAnimation()`, which cancels the frame loop without running its
       * `onSettle` — so anything that grabbed, panned or zoomed inside the
       * settle window used to discard the move silently. The card kept looking
       * right only because the stale `dragPosition` masked it, until the next
       * drag claimed that slot and the table snapped back to its old position.
       * The spring is now purely cosmetic: the schema already holds `target`,
       * so an interrupted animation lands there instead of reverting.
       */
      writeTablePosition(table.id, target.x, target.y, targetGroup?.id ?? null);
      animateTo(
        from,
        target,
        velocity,
        flicked ? FLICK_SPRING : SETTLE_SPRING,
        (value) => setDragPosition({ id: table.id, ...value }),
        () => setDragPosition(null),
      );
    };

    const cancel = (event: PointerEvent) => up(event);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      flushMove();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    // Every dependency here is stable, so the listeners attach once instead of
    // once per pointermove. Live gesture values are read through refs above.
  }, [
    animateTo,
    canvasRect,
    commitGroupPosition,
    commitGroupSize,
    commitMemoPosition,
    commitMemoSize,
    commitTableWidth,
    commitWith,
    writeTablePosition,
    resolveTablePosition,
  ]);

  /**
   * Wheel handling is attached natively because React registers `wheel`
   * passively, which makes `preventDefault` a no-op and lets the page scroll.
   *
   * Scroll pans and ctrl/⌘-scroll (trackpad pinch) zooms, matching the
   * convention in every other diagram editor.
   */
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    let wheelFrame: number | null = null;
    /**
     * Deltas accumulate rather than overwrite: a frame usually swallows several
     * wheel events, and keeping only the last one both loses distance and makes
     * the gesture stutter. One flush per frame applies their sum.
     */
    let zoomDelta = 0;
    let panDelta = { x: 0, y: 0 };
    let pointer = { x: 0, y: 0 };
    /*
     * Wheel has no end event, so the commit is on an idle timer. Until it
     * fires the camera lives only in the refs and the DOM — which is exactly
     * how a pan behaves between pointerdown and pointerup.
     */
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSettle = () => {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        setPan(panRef.current);
        setZoom(zoomRef.current);
      }, WHEEL_SETTLE_MS);
    };

    const applyWheel = () => {
      let nextZoom = zoomRef.current;
      let nextPan = panRef.current;
      if (zoomDelta !== 0) {
        const scaled = Math.min(
          MAX_ZOOM,
          Math.max(
            MIN_ZOOM,
            nextZoom * Math.exp(-zoomDelta * ZOOM_SENSITIVITY),
          ),
        );
        zoomDelta = 0;
        if (scaled !== nextZoom) {
          // Keep the point under the cursor pinned while the scale changes.
          const world = {
            x: (pointer.x - nextPan.x) / nextZoom,
            y: (pointer.y - nextPan.y) / nextZoom,
          };
          nextPan = {
            x: pointer.x - world.x * scaled,
            y: pointer.y - world.y * scaled,
          };
          nextZoom = scaled;
        }
      }
      if (panDelta.x !== 0 || panDelta.y !== 0) {
        nextPan = {
          x: nextPan.x - panDelta.x,
          y: nextPan.y - panDelta.y,
        };
        panDelta = { x: 0, y: 0 };
      }
      if (nextZoom === zoomRef.current && nextPan === panRef.current) return;
      applyViewport(nextPan, nextZoom);
      scheduleSettle();
    };

    const flushWheel = () => {
      if (wheelFrame !== null) {
        cancelAnimationFrame(wheelFrame);
        wheelFrame = null;
        applyWheel();
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopAnimation();
      const rect = canvasRect();
      if (!rect) return;
      const scale = wheelScale(event);

      if (event.ctrlKey || event.metaKey) {
        // Capping the per-event step is what separates a trackpad pinch (a few
        // pixels at a time) from a mouse notch (100 at once) without needing to
        // tell the two devices apart.
        const step = event.deltaY * scale;
        zoomDelta += Math.max(
          -ZOOM_STEP_LIMIT,
          Math.min(ZOOM_STEP_LIMIT, step),
        );
        pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      } else {
        panDelta = {
          x: panDelta.x + event.deltaX * scale,
          y: panDelta.y + event.deltaY * scale,
        };
      }

      if (wheelFrame === null) {
        wheelFrame = requestAnimationFrame(() => {
          wheelFrame = null;
          applyWheel();
        });
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      flushWheel();
      // Unmounting mid-scroll must still leave the camera committed, or the
      // next mount reads a `pan`/`zoom` the refs have long since passed.
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        setPan(panRef.current);
        setZoom(zoomRef.current);
      }
      element.removeEventListener("wheel", onWheel);
    };
  }, [
    applyViewport,
    canvasRect,
    panRef,
    setPan,
    setZoom,
    stopAnimation,
    zoomRef,
  ]);

  /** Zoom around the viewport centre, for the HUD buttons and keyboard. */
  const zoomBy = useCallback(
    (delta: number) => {
      stopAnimation();
      const rect = canvasRect();
      const currentZoom = zoomRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom + delta));
      if (next === currentZoom || !rect) {
        setZoom(next);
        return;
      }
      const centre = { x: rect.width / 2, y: rect.height / 2 };
      const world = {
        x: (centre.x - panRef.current.x) / currentZoom,
        y: (centre.y - panRef.current.y) / currentZoom,
      };
      setZoom(next);
      setPan({ x: centre.x - world.x * next, y: centre.y - world.y * next });
    },
    [canvasRect, stopAnimation],
  );

  /**
   * Seeds a pan gesture. Deliberately leaves selection alone: hitting empty
   * canvas clears it (below), but the hand tool must not — dragging the view
   * around is not a way of deselecting what you were working on.
   */
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    stopAnimation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGrabbing(true);
    const tracker = new VelocityTracker();
    tracker.add(
      panRef.current.x,
      panRef.current.y,
      event.timeStamp || performance.now(),
    );
    gestureRef.current = {
      mode: "pan",
      pointerId: event.pointerId,
      grabX: 0,
      grabY: 0,
      originX: panRef.current.x,
      originY: panRef.current.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tracker,
    };
  };

  /** Seeds the rectangle sweep. Additive when Shift or ⌘/Ctrl is held. */
  const startMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    stopAnimation();
    const rect = canvasRect();
    if (!rect) return startPan(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = {
      x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
    };
    const base =
      event.shiftKey || event.metaKey || event.ctrlKey
        ? selectionRef.current
        : EMPTY_SELECTION;
    gestureRef.current = {
      mode: "marquee",
      pointerId: event.pointerId,
      base,
      grabX: point.x,
      grabY: point.y,
      originX: point.x,
      originY: point.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tracker: new VelocityTracker(),
    };
  };

  /**
   * Pressing empty canvas sweeps a selection, the way it does on both desktops.
   * Panning keeps every route it already had — hold Space, the hand tool, a
   * middle-drag, and the wheel — so nothing is lost by giving the left button
   * over to selection.
   */
  const onCanvasDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setEditingMemoId(null);
    if (event.button === 0 && !panMode) return startMarquee(event);
    startPan(event);
  };

  /**
   * What a press on a card does to the selection, before any drag begins.
   * Shift or ⌘/Ctrl toggles that one card in or out and starts nothing;
   * pressing something already inside a multi-selection leaves the set intact
   * so the whole thing can be dragged; anything else collapses to it.
   */
  const pressSelection = useCallback(
    (event: React.PointerEvent<Element>, kind: SelectionKind, id: string) => {
      const current = selectionRef.current;
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        setSelection(toggleSelected(current, kind, id));
        return "toggled" as const;
      }
      if (selectionCount(current) > 1 && isSelected(current, kind, id))
        return "set" as const;
      setSelection(selectOnly(kind, id));
      return "single" as const;
    },
    [],
  );

  /** Seeds a drag of everything selected. The pointer's canvas position is the origin. */
  const startSelectionDrag = useCallback(
    (event: React.PointerEvent<Element>) => {
      const rect = canvasRect();
      if (!rect) return;
      setGrabbing(true);
      gestureRef.current = {
        mode: "selection",
        pointerId: event.pointerId,
        grabX: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
        grabY: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
        originX: 0,
        originY: 0,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        tracker: new VelocityTracker(),
      };
    },
    [canvasRect],
  );

  /**
   * Hand mode pans from anywhere, so it has to win before the cards do — they
   * all `stopPropagation()` in the bubble phase, and the pan handler below only
   * fires on a bare-canvas hit. Stopping the capture-phase event halts React's
   * whole dispatch, which leaves table drag, group/memo resize and relationship
   * linking inert for as long as the tool is held.
   */
  const onCanvasDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panMode || event.button !== 0) return;
    // Only the canvas itself is pannable surface. The dock and the selection
    // toolbar are chrome floating over it, and swallowing their presses here
    // left the hand tool unable to switch itself off — its own button never saw
    // the click that would have toggled it.
    const target = event.target as Element;
    if (target !== event.currentTarget && !target.closest(".canvas")) return;
    event.preventDefault();
    event.stopPropagation();
    startPan(event);
  };

  const onHeaderDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, tableId: string) => {
      if (event.button !== 0) return;
      const table = schemaRef.current.tables.find(
        (item) => item.id === tableId,
      );
      if (!table) return;
      event.preventDefault();
      event.stopPropagation();
      stopAnimation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = canvasRect();
      if (!rect) return;
      setEditingMemoId(null);
      const intent = pressSelection(event, "table", tableId);
      if (intent === "toggled") return;
      if (intent === "set") return startSelectionDrag(event);
      setGrabbing(true);
      const origin = livePositionRef.current(table);
      const tracker = new VelocityTracker();
      tracker.add(origin.x, origin.y, event.timeStamp || performance.now());
      gestureRef.current = {
        mode: "table",
        pointerId: event.pointerId,
        tableId,
        // Respect where the card was grabbed — snapping to its centre would
        // break the illusion that the card is stuck to the pointer.
        grabX:
          (event.clientX - rect.left - panRef.current.x) / zoomRef.current -
          origin.x,
        grabY:
          (event.clientY - rect.top - panRef.current.y) / zoomRef.current -
          origin.y,
        originX: origin.x,
        originY: origin.y,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        tracker,
      };
    },
    [canvasRect, pressSelection, startSelectionDrag, stopAnimation],
  );

  /**
   * Width-only resize from the card's right edge — a card's height is derived
   * from its column count, so there is nothing vertical to drag.
   */
  /** A table resizes on one axis, so only the horizontal arrows do anything. */
  const onTableResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, tableId: string) => {
      const delta = resizeDelta(event);
      if (!delta || !delta[0]) return;
      const table = schemaRef.current.tables.find(
        (item) => item.id === tableId,
      );
      if (!table) return;
      event.preventDefault();
      event.stopPropagation();
      commitTableWidth(tableId, liveWidthRef.current(table) + delta[0]);
    },
    [commitTableWidth],
  );

  const onTableResizeDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, tableId: string) => {
      if (event.button !== 0 || readOnly) return;
      const table = schemaRef.current.tables.find(
        (item) => item.id === tableId,
      );
      if (!table) return;
      event.preventDefault();
      event.stopPropagation();
      stopAnimation();
      const rect = canvasRect();
      if (!rect) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelection(selectOnly("table", tableId));
      setEditingMemoId(null);
      setGrabbing(true);
      gestureRef.current = {
        mode: "table-resize",
        pointerId: event.pointerId,
        tableId,
        grabX: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
        grabY: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
        originX: table.x,
        originY: table.y,
        originWidth: liveWidthRef.current(table),
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        tracker: new VelocityTracker(),
      };
    },
    [canvasRect, readOnly, stopAnimation],
  );

  const onMemoDown = (event: React.PointerEvent<HTMLElement>, memo: Memo) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopAnimation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = canvasRect();
    if (!rect) return;
    const position = liveMemo(memo);
    const intent = pressSelection(event, "memo", memo.id);
    if (intent === "toggled") return;
    if (intent === "set") return startSelectionDrag(event);
    setGrabbing(true);
    gestureRef.current = {
      mode: "memo",
      pointerId: event.pointerId,
      memoId: memo.id,
      grabX: (event.clientX - rect.left - panRef.current.x) / zoomRef.current - position.x,
      grabY: (event.clientY - rect.top - panRef.current.y) / zoomRef.current - position.y,
      originX: position.x,
      originY: position.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tracker: new VelocityTracker(),
    };
  };

  const onMemoResizeDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    memo: Memo,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = canvasRect();
    if (!rect) return;
    const position = liveMemo(memo);
    const pointer = {
      x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
    };
    setSelection(selectOnly("memo", memo.id));
    setGrabbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      mode: "memo-resize",
      pointerId: event.pointerId,
      memoId: memo.id,
      grabX: pointer.x,
      grabY: pointer.y,
      originX: position.x,
      originY: position.y,
      originWidth: position.width,
      originHeight: position.height,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tracker: new VelocityTracker(),
    };
  };

  const onGroupDown = (
    event: React.PointerEvent<HTMLElement>,
    group: SchemaGroup,
  ) => {
    if (event.button !== 0 || readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    stopAnimation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = canvasRect();
    if (!rect) return;
    const position = liveGroup(group);
    const intent = pressSelection(event, "group", group.id);
    if (intent === "toggled") return;
    if (intent === "set") return startSelectionDrag(event);
    setGrabbing(true);
    gestureRef.current = {
      mode: "group",
      pointerId: event.pointerId,
      memoId: undefined,
      grabX: (event.clientX - rect.left - panRef.current.x) / zoomRef.current - position.x,
      grabY: (event.clientY - rect.top - panRef.current.y) / zoomRef.current - position.y,
      originX: position.x,
      originY: position.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tracker: new VelocityTracker(),
    };
    gestureRef.current.groupId = group.id;
  };

  const onGroupResizeDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    group: SchemaGroup,
  ) => {
    if (event.button !== 0 || readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = canvasRect();
    if (!rect) return;
    const position = liveGroup(group);
    const pointer = {
      x: (event.clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (event.clientY - rect.top - panRef.current.y) / zoomRef.current,
    };
    setSelection(selectOnly("group", group.id));
    setGrabbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      mode: "group-resize",
      pointerId: event.pointerId,
      groupId: group.id,
      grabX: pointer.x,
      grabY: pointer.y,
      originX: position.x,
      originY: position.y,
      originWidth: position.width,
      originHeight: position.height,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tracker: new VelocityTracker(),
    };
  };

  const addMemo = (at?: Point, schemaId?: string) => {
    const index = schema.memos?.length ?? 0;
    const memo = {
      ...makeMemo(
        "",
        at?.x ?? 120 + (index % 4) * 70,
        at?.y ?? 100 + (index % 3) * 70,
        "yellow",
      ),
      schemaId,
    };
    commit({ ...schema, memos: [...(schema.memos ?? []), memo] });
    setSelection(selectOnly("memo", memo.id));
    setEditingMemoId(memo.id);
  };

  const addGroup = (at?: Point) => {
    const index = schema.groups?.length ?? 0;
    const group = makeSchemaGroup(
      `Schema ${index + 1}`,
      at?.x ?? 90 + (index % 3) * 120,
      at?.y ?? 80 + (index % 2) * 120,
      index,
    );
    commit({ ...schema, groups: [...(schema.groups ?? []), group] });
    setSelection(selectOnly("group", group.id));
  };

  const patchGroup = (id: string, patch: Partial<SchemaGroup>) => {
    if (readOnly) return;
    commit({
      ...schema,
      groups: (schema.groups ?? []).map((group) =>
        group.id === id ? { ...group, ...patch } : group,
      ),
    });
  };

  const deleteGroup = (id: string) => {
    if (readOnly) return;
    commit({
      ...schema,
      groups: (schema.groups ?? []).filter((group) => group.id !== id),
      tables: schema.tables.map((table) =>
        table.schemaId === id ? { ...table, schemaId: undefined } : table,
      ),
    });
  };

  /** Tables in `id` whose name does not already open with the group's keyword. */
  const unprefixedTables = (id: string) => {
    const prefix = groupPrefix(
      (schema.groups ?? []).find((group) => group.id === id),
    );
    return prefix
      ? schema.tables.filter(
          (table) =>
            table.schemaId === id &&
            prefixTableName(table.name, prefix) !== table.name,
        )
      : [];
  };

  /**
   * The one bulk rename, and it is always asked for — a keyword never rewrites
   * a name the user already typed as a side effect of being edited. One commit,
   * so a single undo puts every name back.
   */
  const applyGroupKeyword = (id: string) => {
    if (readOnly) return;
    const prefix = groupPrefix(
      (schema.groups ?? []).find((group) => group.id === id),
    );
    const renamed = unprefixedTables(id).length;
    if (!renamed) return;
    commit({
      ...schema,
      tables: schema.tables.map((table) =>
        table.schemaId === id
          ? { ...table, name: prefixTableName(table.name, prefix) }
          : table,
      ),
    });
    toast.success(
      `Prefixed ${renamed} ${renamed === 1 ? "table" : "tables"} with ${prefix}`,
    );
  };

  const assignTableToGroup = (tableId: string, schemaId: string) => {
    if (readOnly) return;
    commit({
      ...schema,
      tables: schema.tables.map((table) =>
        table.id === tableId
          ? { ...table, schemaId: schemaId || undefined }
          : table,
      ),
    });
  };

  const patchMemo = (id: string, patch: Partial<Memo>) =>
    commitWith((current) => ({
      ...current,
      memos: (current.memos ?? []).map((memo) =>
        memo.id === id ? { ...memo, ...patch } : memo,
      ),
    }));

  const deleteMemo = (id: string) => {
    commit({
      ...schema,
      memos: (schema.memos ?? []).filter((memo) => memo.id !== id),
    });
    if (editingMemoId === id) setEditingMemoId(null);
  };

  /** Keyboard parity for positioning a card that has focus. */
  const onCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, tableId: string) => {
      const deltas: Record<string, Vec> = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
      };
      const delta = deltas[event.key];
      if (!delta) return;
      const table = schemaRef.current.tables.find(
        (item) => item.id === tableId,
      );
      if (!table) return;
      event.preventDefault();
      const step = NUDGE * (event.shiftKey ? 3 : 1);
      commitPosition(
        tableId,
        table.x + delta.x * step,
        table.y + delta.y * step,
      );
    },
    [commitPosition],
  );

  /** `tableId` comes from a card's context menu; the menubar and shortcut use the selection. */
  const makeJunction = useCallback(
    (tableId?: string) => {
      const schema = schemaRef.current;
      const left = schema.tables.find(
        (table) => table.id === (tableId ?? selectedIdRef.current),
      );
      if (!left || schema.tables.length < 2) return;
      const right = schema.tables.find((table) => table.id !== left.id);
      if (!right) return;
      const leftPk = primaryKeyColumns(left)[0];
      const rightPk = primaryKeyColumns(right)[0];
      if (!leftPk || !rightPk) return;
      /*
       * The junction belongs to whichever schema the table it was raised from
       * belongs to, and takes that schema's keyword once — built from the
       * stripped halves, so two prefixed parents give `MLL_LANGUAGES_CODES`
       * rather than `MLL_LANGUAGES_MLL_CODES`.
       */
      const prefix = groupPrefix(
        (schema.groups ?? []).find((group) => group.id === left.schemaId),
      );
      const junction = makeTable(
        prefixTableName(
          `${stripTablePrefix(left.name, prefix)}_${stripTablePrefix(right.name, prefix)}`,
          prefix,
        ),
        left.x + 330,
        left.y + 150,
        schema.tables.length,
      );
      junction.schemaId = left.schemaId;
      junction.keyStrategy = "none";
      junction.columns = [
        makeColumn({
          name: `${left.name}_ID`,
          type: leftPk.type,
          size: leftPk.size,
          pk: true,
          notNull: true,
          fk: { tableId: left.id, columnId: leftPk.id },
        }),
        makeColumn({
          name: `${right.name}_ID`,
          type: rightPk.type,
          size: rightPk.size,
          pk: true,
          notNull: true,
          fk: { tableId: right.id, columnId: rightPk.id },
        }),
      ];
      commitWith((current) =>
        normalizeRelationships({
          ...current,
          tables: [...current.tables, junction],
        }),
      );
      selectTable(junction.id);
    },
    [commitWith],
  );

  const copyText = useCallback(
    async (value: string, message = "Link copied.") => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(message);
      } catch {
        toast.error("Clipboard access failed.");
      }
    },
    [],
  );

  /** Card context-menu actions. Stable, so a card can memoize on its props. */
  const editTableInPanel = useCallback((tableId: string) => {
    selectTable(tableId);
    setPanelTab("tables");
    setSidebarOpen(true);
  }, []);

  const copyTableDDL = useCallback(
    (tableId: string) => {
      const table = schemaRef.current.tables.find(
        (item) => item.id === tableId,
      );
      // Relationships to tables outside this subset are dropped by normalization.
      if (table)
        void copyText(generateDDL({ ...schemaRef.current, tables: [table] }));
    },
    [copyText],
  );

  const deleteSelection = () => {
    if (readOnly || !selectionCount(selection)) return;
    commit(removeSelection(schema, selection));
    setSelection(EMPTY_SELECTION);
  };

  /**
   * Copying is the same narrowing either way; only the format differs. DDL is
   * what you paste into a SQL client, JSON is what you paste into another
   * project — the envelope `mergeSchemaJson` reads on the way back in.
   */
  const copySelection = (format: "sql" | "json") => {
    if (!selectionCount(selection)) {
      toast.error("Nothing selected.");
      return;
    }
    const subset = selectionSchema(schema, selection);
    if (format === "sql" && !subset.tables.length) {
      toast.error("Select a table — memos and empty schemas carry no SQL.");
      return;
    }
    void copyText(
      format === "sql" ? generateDDL(subset) : exportSchemaJson(subset),
      format === "sql" ? "SQL copied." : "Copied as JSON.",
    );
  };

  /**
   * Paste rides the browser's own `paste` event rather than a ⌘V chord: it
   * hands us the clipboard text outright, where reading it ourselves needs a
   * permission prompt in Chrome and is refused in Firefox.
   *
   * `mergeSchemaJson` does the rest — it re-mints every id, rewires the foreign
   * keys, brings the groups and memos, and lands the arrivals below whatever is
   * already on the canvas. A table whose name the project already carries is
   * skipped, which is also why pasting back into the project you copied from
   * adds nothing; that is the import path's rule and the toast says so.
   */
  const pasteSelection = (text: string) => {
    const result = mergeSchemaJson(schemaRef.current, text);
    if (!result.schema) {
      toast.error(result.errors.join(" "));
      return;
    }
    commit(result.schema);
    setSelection({
      tables: result.added.map((table) => table.id),
      memos: [],
      groups: [],
    });
    revealTables(result.added);
    toast.success(
      `${result.added.length} table(s) pasted.${result.skipped.length ? ` Already here: ${result.skipped.join(", ")}.` : ""}`,
    );
  };

  /**
   * Copies the given tables -- or the selected ones -- beside themselves, then
   * selects the copies so a drag moves them off their originals. One commit,
   * so one undo removes them all.
   */
  const duplicateSelection = useStableCallback((tableIds?: string[]) => {
    if (readOnly) return;
    const ids = tableIds ?? movingEntities(schemaRef.current, selection).tables;
    const result = duplicateTables(schemaRef.current, [...ids]);
    if (!result.added.length) {
      toast.error("Select a table to duplicate.");
      return;
    }
    commit(result.schema);
    setSelection({ tables: result.added.map((table) => table.id), memos: [], groups: [] });
  });

  /**
   * The listener below is bound once, so it reaches the current closures
   * through refs rather than through its dependency array.
   */

  const stable = {
    deleteGroup: useStableCallback(deleteGroup),
    deleteMemo: useStableCallback(deleteMemo),
    onGroupDown: useStableCallback(onGroupDown),
    onGroupResizeDown: useStableCallback(onGroupResizeDown),
    onMemoDown: useStableCallback(onMemoDown),
    onMemoResizeDown: useStableCallback(onMemoResizeDown),
    patchGroup: useStableCallback(patchGroup),
    patchMemo: useStableCallback(patchMemo),
  };

  /*
   * The card-level handlers the canvas used to build inline, per card, per
   * render. Taking the id (or the entity) as an argument is what lets them be
   * one stable function each.
   */
  const onGroupBodyDown = useStableCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      event.stopPropagation();
      pressSelection(event, "group", id);
    },
  );
  const selectMemo = useStableCallback((id: string) =>
    setSelection(selectOnly("memo", id)),
  );
  const clickMemo = useStableCallback(
    (event: React.MouseEvent, id: string) => {
      event.stopPropagation();
      // The pointerdown already decided this; re-running it here would undo a
      // Shift-click toggle a moment after it landed.
      if (event.shiftKey || event.metaKey || event.ctrlKey) return;
      if (isSelected(selectionRef.current, "memo", id)) return;
      setSelection(selectOnly("memo", id));
    },
  );
  const focusMemoText = useStableCallback((memo: Memo) => {
    setSelection(selectOnly("memo", memo.id));
    setEditingMemoId(memo.id);
    if (memo.text.trim()) memoHadText.current.add(memo.id);
  });
  const changeMemoText = useStableCallback((id: string, value: string) => {
    if (value.trim()) memoHadText.current.add(id);
    patchMemo(id, { text: value });
  });
  const blurMemoText = useStableCallback((memo: Memo) => {
    setEditingMemoId((current) => (current === memo.id ? null : current));
    if (!memo.text.trim() && !memoHadText.current.has(memo.id))
      deleteMemo(memo.id);
  });

  return {
    addGroup,
    addMemo,
    addTable,
    blurMemoText,
    changeMemoText,
    clickMemo,
    focusMemoText,
    selectMemo,
    applyGroupKeyword,
    assignTableToGroup,
    autoLayout,
    canvasPoint,
    canvasRef,
    commitGroupSize,
    commitMemoSize,
    copySelection,
    copyTableDDL,
    deleteGroup: stable.deleteGroup,
    deleteMemo: stable.deleteMemo,
    deleteSelection,
    dragGroupPosition,
    dragPosition,
    dragSelection,
    editTableInPanel,
    editingMemoId,
    finishLinking,
    fitView,
    foreignKeyTarget,
    grabbing,
    linking,
    liveGroup,
    liveMemo,
    livePosition,
    liveWidth,
    makeJunction,
    marquee,
    memoHadText,
    multiFrame,
    onCanvasDown,
    onCanvasDownCapture,
    onCardKeyDown,
    onGroupBodyDown,
    onGroupDown: stable.onGroupDown,
    onGroupResizeDown: stable.onGroupResizeDown,
    onHeaderDown,
    onMemoDown: stable.onMemoDown,
    onMemoResizeDown: stable.onMemoResizeDown,
    onTableResizeDown,
    onTableResizeKeyDown,
    panMode,
    pasteSelection,
    duplicateSelection,
    patchGroup: stable.patchGroup,
    patchMemo: stable.patchMemo,
    peerSelection,
    pressSelection,
    resetTableWidth,
    resizeTable,
    revealTables,
    selected,
    setEditingMemoId,
    setHandMode,
    setLinking,
    setSpaceHeld,
    startLinking,
    unprefixedTables,
    zoomBy,
  };
}
