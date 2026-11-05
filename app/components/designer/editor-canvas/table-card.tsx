"use client";

/**
 * One table on the canvas. This is the component that decides whether dragging
 * feels smooth: the designer re-renders on every frame of a gesture, and each
 * card carries a context menu and one HoverCard per column, so a diagram of
 * twenty ten-column tables was reconciling a couple of hundred popover
 * instances sixty times a second.
 *
 * Every prop is therefore either a primitive or an identity that only changes
 * when the schema does. In particular the live position arrives as two numbers,
 * not an object, and the collaborator holding the card as a name and a colour
 * rather than the peer record — a peer's cursor moves every frame, and passing
 * the record would defeat the memo it is here to enable.
 */

import { useDialect } from "@/app/components/designer/context/dialect-context";
import { typeName } from "@/app/lib/dialect";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CopyIcon, CopyPlusIcon, FingerprintIcon, GitMergeIcon, GripVerticalIcon, KeyRoundIcon, LinkIcon, ListPlusIcon, MoveHorizontalIcon, PanelLeftOpenIcon, TargetIcon, Trash2Icon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HoverCard } from "@/components/ui/hover-card";
import { DOCUMENT_HEADER_HEIGHT, TABLE_FIELD_HEIGHT, commentLines, inkOn, keyStrategyTag, tableHeaderHeight, tableHeight, uniqueGroupColumnIds, type CardStyle, type Column, type SchemaGroup, type Table } from "@/app/lib/schema";
import { typeColorVar } from "@/app/lib/datatype-color";
import { ColumnCard, ShortcutKeys, TableSummaryCard } from "../primitives";

type ForeignKeyTarget = (column: Column) => { table: Table; column: Column } | undefined;

/**
 * A single column line. Split out so that editing one column does not re-render
 * its siblings, and so the hover card's contents are built by a component that
 * can skip the work rather than eagerly on every parent render.
 */
const ColumnRow = memo(function ColumnRow({
  table,
  column,
  columnIndex,
  totalColumns,
  inUniqueGroup,
  isDocument,
  hoverDisabled,
  readOnly,
  foreignKeyTarget,
  onStartLink,
  onGrabRow,
  onRowKeyDown,
}: {
  table: Table;
  column: Column;
  columnIndex: number;
  totalColumns: number;
  /** Whether one of the table's multi-column unique constraints names it. */
  inUniqueGroup: boolean;
  /** Document cards badge the key columns in text and spell names as the DDL does. */
  isDocument: boolean;
  hoverDisabled: boolean;
  readOnly: boolean;
  foreignKeyTarget: ForeignKeyTarget;
  onStartLink: (event: ReactPointerEvent, tableId: string, columnId: string, columnIndex: number) => void;
  onGrabRow?: (event: ReactPointerEvent<HTMLButtonElement>, columnId: string, columnIndex: number) => void;
  onRowKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, columnId: string, columnIndex: number) => void;
}) {
  const dialect = useDialect();
  const type = typeName(column, dialect);
  return (
    <HoverCard
      className="table-row"
      data-table-id={table.id}
      data-column-id={column.id}
      isDisabled={hoverDisabled}
      // A thunk, so resolving the foreign key happens when a row is actually
      // pointed at rather than for every row of every card on every render.
      content={() => (
        <ColumnCard
          table={table}
          column={column}
          reference={foreignKeyTarget(column)}
        />
      )}
    >
      <span
        className="row-grip"
        role="button"
        tabIndex={0}
        aria-label={`Link ${table.name}.${column.name}`}
        // Alt-click is "show impact" anywhere on the row; the card handles it, so no link starts.
        onPointerDown={(event) => !event.altKey && onStartLink(event, table.id, column.id, columnIndex)}
        aria-hidden="false"
      />
      {isDocument && (
        // Always present, even empty, so every name starts at the same x.
        <span className="row-badge" data-kind={column.pk ? "pk" : column.fk ? "fk" : column.unique || inUniqueGroup ? "uq" : undefined}>
          {column.pk ? "PK" : column.fk ? "FK" : column.unique || inUniqueGroup ? "UQ" : ""}
        </span>
      )}
      <span className="row-name">{isDocument ? column.name.toLowerCase() : column.name.toUpperCase()}</span>
      <span className="row-meta">
        {!isDocument && column.pk && <KeyRoundIcon size={13} aria-hidden="true" />}
        {!isDocument && column.fk && (
          <LinkIcon size={13} className="fk-dot" aria-hidden="true" />
        )}
        {/* The same glyph the side panel's Unique flag uses; the tint is what
            separates a column's own unique from one inside a group. */}
        {!isDocument && (column.unique || inUniqueGroup) && !column.pk && (
          <FingerprintIcon size={13}
            className={inUniqueGroup ? "uk-group" : "uk-dot"}
            aria-hidden="true"
          />
        )}
        <span className="row-type" style={{ color: typeColorVar(column.type) }}>
          {isDocument || dialect === "postgres" ? type.toLowerCase() : type}
        </span>
        {/* After the type, as an optional is written (`String?`), and in a slot
            that is always there: every type then ends on the same x, and the
            marks line up in a column instead of floating with each type's width. */}
        <span className="row-nullable">
          {!column.notNull && !column.pk && <><span className="sr-only">Nullable</span>?</>}
        </span>
        {!readOnly && totalColumns > 1 && onGrabRow && (
          <button
            type="button"
            className="row-reorder-grip"
            aria-label={`Reorder column ${column.name}, position ${columnIndex + 1} of ${totalColumns}. Press Up or Down arrow keys to move.`}
            onPointerDown={(event) => onGrabRow(event, column.id, columnIndex)}
            onKeyDown={(event) => onRowKeyDown?.(event, column.id, columnIndex)}
          >
            <GripVerticalIcon size={13} aria-hidden="true" />
          </button>
        )}
      </span>
    </HoverCard>
  );
});

export const TableCard = memo(function TableCard({
  table,
  x,
  y,
  width,
  moving,
  selected,
  multiSelected,
  resizing,
  hoverDisabled,
  heldByName,
  heldByColor,
  group,
  relationshipCount,
  foreignKeyTarget,
  readOnly,
  isMac,
  onSelect,
  onHeaderDown,
  onResizeDown,
  onResizeKeyDown,
  onResetWidth,
  onKeyDown,
  onStartLink,
  onEditInPanel,
  onCopyDDL,
  onAddColumn,
  onMakeJunction,
  onDuplicate,
  onDeleteTable,
  onShowImpact,
  reorderColumns,
  cardStyle,
}: {
  table: Table;
  x: number;
  y: number;
  /** Live during a resize, so it arrives as a number rather than off `table`. */
  width: number;
  moving: boolean;
  selected: boolean;
  /**
   * One of several things selected together. Kept apart from `selected` so the
   * shared ring reads as "part of this set" rather than as the single-selection
   * accent — the whole point of the ring is that it looks the same on a table,
   * a memo and a group.
   */
  multiSelected: boolean;
  /**
   * True for the card whose width grip is in flight. Pointer capture takes the
   * pointer off the card, so hover cannot be what keeps the grip lit.
   */
  resizing: boolean;
  /** Hover cards stay shut during gestures — a popover mid-drag is noise. */
  hoverDisabled: boolean;
  heldByName?: string;
  heldByColor?: string;
  group?: SchemaGroup;
  relationshipCount: number;
  foreignKeyTarget: ForeignKeyTarget;
  readOnly: boolean;
  isMac: boolean;
  onSelect: (tableId: string) => void;
  onHeaderDown: (event: ReactPointerEvent<HTMLDivElement>, tableId: string) => void;
  onResizeDown: (event: ReactPointerEvent<HTMLButtonElement>, tableId: string) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLButtonElement>, tableId: string) => void;
  onResetWidth: (tableId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, tableId: string) => void;
  onStartLink: (event: ReactPointerEvent, tableId: string, columnId: string, columnIndex: number) => void;
  onEditInPanel: (tableId: string) => void;
  onCopyDDL: (tableId: string) => void;
  onAddColumn: (tableId: string) => void;
  onMakeJunction: (tableId: string) => void;
  onDuplicate: (tableIds: string[]) => void;
  onDeleteTable: (tableId: string) => void;
  /** Alt-click on a row, or the row's context-menu item. */
  onShowImpact: (tableId: string, columnId: string) => void;
  cardStyle: CardStyle;
  reorderColumns?: (tableId: string, from: number, to: number) => void;
}) {
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** The row a context menu was opened on, so the menu can offer that column's impact. */
  const [menuColumnId, setMenuColumnId] = useState<string | null>(null);
  const menuColumn = table.columns.find((column) => column.id === menuColumnId);
  // Built once per card rather than scanned per row: a card is redrawn on every
  // drag frame and the constraints change about once a session.
  const uniqueGroups = useMemo(() => uniqueGroupColumnIds(table), [table]);
  const isDocument = cardStyle === "document";
  const comment = useMemo(() => (isDocument ? commentLines(table) : []), [isDocument, table]);
  const rowSlotsRef = useRef(new Map<string, HTMLDivElement>());
  const gestureRef = useRef<{
    pointerId: number;
    columnId: string;
    from: number;
    to: number;
    startY: number;
    offset: number;
  } | null>(null);

  const setRowSlot = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) rowSlotsRef.current.set(id, node);
    else rowSlotsRef.current.delete(id);
  }, []);

  const paintRows = useCallback((from: number, to: number, offset: number, columns: Column[]) => {
    const rowHeight = TABLE_FIELD_HEIGHT;
    columns.forEach((col, index) => {
      const node = rowSlotsRef.current.get(col.id);
      if (!node) return;
      if (index === from) {
        node.style.transform = `translate3d(0, ${offset}px, 0)`;
      } else {
        let shift = 0;
        if (to > from && index > from && index <= to) shift = -rowHeight;
        else if (to < from && index >= to && index < from) shift = rowHeight;
        node.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
      }
    });
  }, []);

  const clearRowTransforms = useCallback(() => {
    rowSlotsRef.current.forEach((node) => {
      node.style.transform = "";
    });
  }, []);

  const finishRowDrag = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    clearRowTransforms();
    setDraggingColumnId(null);
    if (gesture.to !== gesture.from && reorderColumns) {
      reorderColumns(table.id, gesture.from, gesture.to);
    }
  }, [clearRowTransforms, reorderColumns, table.id]);

  const onGrabRow = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, columnId: string, columnIndex: number) => {
      if (readOnly || event.button !== 0 || table.columns.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = {
        pointerId: event.pointerId,
        columnId,
        from: columnIndex,
        to: columnIndex,
        startY: event.clientY,
        offset: 0,
      };
      setDraggingColumnId(columnId);
    },
    [readOnly, table.columns.length],
  );

  const onRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, columnId: string, columnIndex: number) => {
      if (readOnly || !reorderColumns) return;
      const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (!delta) return;
      const to = columnIndex + delta;
      if (to < 0 || to >= table.columns.length) return;
      event.preventDefault();
      event.stopPropagation();
      reorderColumns(table.id, columnIndex, to);
      setAnnouncement(
        `${table.columns[columnIndex].name.toUpperCase()} moved to position ${to + 1} of ${table.columns.length}.`,
      );
    },
    [readOnly, reorderColumns, table.columns, table.id],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const offset = event.clientY - gesture.startY;
      const rowHeight = TABLE_FIELD_HEIGHT;
      const slotShift = Math.round(offset / rowHeight);
      const to = Math.max(0, Math.min(table.columns.length - 1, gesture.from + slotShift));
      gesture.offset = offset;
      gesture.to = to;
      paintRows(gesture.from, gesture.to, gesture.offset, table.columns);
    };
    const release = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      finishRowDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [finishRowDrag, paintRows, table.columns]);

  return (
    <ContextMenuTrigger onOpenChange={(open) => open && onSelect(table.id)}>
      <div
        className={`table-card ${isDocument ? "document" : ""} ${selected ? "selected" : ""} ${multiSelected ? "multi-selected" : ""} ${moving ? "moving" : ""} ${heldByName ? "peer-held" : ""}`}
        // Focus dimming finds cards by attribute rather than by prop, so a card
        // outside the neighbourhood is never re-rendered to be dimmed.
        data-table-id={table.id}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`Table ${table.name}, ${table.columns.length} columns.${heldByName ? ` Selected by ${heldByName}.` : ""} Arrow keys move it.`}
        style={{
          transform: `translate3d(${x}px, ${y}px, 0)`,
          width,
          /*
           * Paired with `content-visibility: auto` in globals.css. Width is
           * already explicit above, so only the height is a guess -- and it is
           * not really a guess: `tableHeight` is the same function the
           * relationship anchors are derived from, so a skipped card reserves
           * exactly the box it will occupy when it scrolls back into view.
           */
          containIntrinsicHeight: `${tableHeight(table, cardStyle)}px`,
          willChange: moving ? "transform" : undefined,
          ...(heldByColor ? ({ "--peer-color": heldByColor } as React.CSSProperties) : {}),
          ...(isDocument ? ({ "--card-color": table.color.a, "--card-ink": inkOn(table.color.a) } as React.CSSProperties) : {}),
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          const row = event.altKey ? (event.target as Element).closest?.(".table-row[data-column-id]") : null;
          if (row) onShowImpact(table.id, row.getAttribute("data-column-id")!);
          onSelect(table.id);
        }}
        onContextMenuCapture={(event) =>
          setMenuColumnId((event.target as Element).closest?.(".table-row[data-column-id]")?.getAttribute("data-column-id") ?? null)
        }
        onKeyDown={(event) => onKeyDown(event, table.id)}
      >
        <div className="table-strip" style={{ background: table.color.a }} aria-hidden="true" />
        <HoverCard
          className="table-head"
          isDisabled={hoverDisabled || draggingColumnId !== null}
          onPointerDown={(event) => onHeaderDown(event, table.id)}
          content={
            <TableSummaryCard
              table={table}
              group={group}
              relationshipCount={relationshipCount}
            />
          }
        >
          <span className="table-name">{isDocument ? table.name.toLowerCase() : table.name.toUpperCase()}</span>
          <span className="table-strategy">{keyStrategyTag(table.keyStrategy)}</span>
        </HoverCard>
        {/* Sized from the same function the anchors are, so edges land on their rows. */}
        {isDocument && comment.length > 0 && (
          <div className="table-comment" style={{ height: tableHeaderHeight(table, cardStyle) - DOCUMENT_HEADER_HEIGHT }}>
            {comment.map((line, index) => <span key={index}>{line}</span>)}
          </div>
        )}
        {table.columns.map((column, columnIndex) => (
          <div
            key={column.id}
            ref={(node) => setRowSlot(column.id, node)}
            className={`table-row-slot ${draggingColumnId === column.id ? "lifted" : ""}`}
          >
            <ColumnRow
              table={table}
              column={column}
              columnIndex={columnIndex}
              totalColumns={table.columns.length}
              inUniqueGroup={uniqueGroups.has(column.id)}
              isDocument={isDocument}
              hoverDisabled={hoverDisabled || draggingColumnId !== null}
              readOnly={readOnly}
              foreignKeyTarget={foreignKeyTarget}
              onStartLink={onStartLink}
              onGrabRow={onGrabRow}
              onRowKeyDown={onRowKeyDown}
            />
          </div>
        ))}
        {announcement && (
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        )}
        {!readOnly && (
          <button
            type="button"
            className={`table-resize ${resizing ? "resizing" : ""}`}
            aria-label={`Resize ${table.name}. Left and Right arrows resize, Shift for larger steps. Double-click to fit the content.`}
            title="Drag to resize · double-click to reset"
            onPointerDown={(event) => onResizeDown(event, table.id)}
            onKeyDown={(event) => onResizeKeyDown(event, table.id)}
            onDoubleClick={() => onResetWidth(table.id)}
          >
            <span className="table-resize-grip" aria-hidden="true" />
          </button>
        )}
      </div>
      <ContextMenu className="w-auto">
        <ContextMenuLabel className="code-menu">{table.name.toUpperCase()}</ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem onAction={() => onEditInPanel(table.id)}>
            <PanelLeftOpenIcon/>
            Edit in side panel
          </ContextMenuItem>
          <ContextMenuItem onAction={() => onCopyDDL(table.id)}>
            <CopyIcon/>
            Copy CREATE TABLE
          </ContextMenuItem>
          {menuColumn && (
            <ContextMenuItem onAction={() => onShowImpact(table.id, menuColumn.id)}>
              <TargetIcon/>
              Show impact of {menuColumn.name.toUpperCase()}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem isDisabled={readOnly} onAction={() => onAddColumn(table.id)}>
            <ListPlusIcon/>
            Add column
            <ContextMenuShortcut>
              <ShortcutKeys id="addColumn" isMac={isMac} />
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            isDisabled={readOnly || table.width === undefined}
            onAction={() => onResetWidth(table.id)}
          >
            <MoveHorizontalIcon/>
            Reset width
          </ContextMenuItem>
          <ContextMenuItem isDisabled={readOnly} onAction={() => onMakeJunction(table.id)}>
            <GitMergeIcon/>
            Add junction table
            <ContextMenuShortcut>
              <ShortcutKeys id="junction" isMac={isMac} />
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem isDisabled={readOnly} onAction={() => onDuplicate([table.id])}>
            <CopyPlusIcon/>
            Duplicate
            <ContextMenuShortcut>
              <ShortcutKeys id="duplicate" isMac={isMac} />
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            variant="destructive"
            isDisabled={readOnly}
            onAction={() => onDeleteTable(table.id)}
          >
            <Trash2Icon/>
            Delete table
            <ContextMenuShortcut>
              <ShortcutKeys id="deleteSelection" isMac={isMac} />
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenu>
    </ContextMenuTrigger>
  );
});
