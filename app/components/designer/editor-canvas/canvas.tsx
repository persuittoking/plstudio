"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { ClipboardIcon, DatabaseIcon, Grid3x3Icon, MaximizeIcon, SquareDashedMousePointerIcon, StickyNoteIcon, TableIcon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PeerCursors } from "@/app/components/collab-presence";
import { displayName, type Peer } from "@/app/lib/collab/presence";
import {
  tableHeight,
  tableWidth,
  type Column,
  type Memo,
  type Relationship,
  type SchemaGroup,
  type Table,
} from "@/app/lib/schema";
import type { Rect } from "@/app/lib/selection";
import { isSelected, selectOnly } from "@/app/lib/selection";
import type { ShortcutId } from "@/app/lib/shortcuts";
import { enclosedBy, relationshipCardinalities } from "../geometry";
import { fanPorts, idealBend, routeEdges, type EdgeInput } from "../edge-routing";
import { ShortcutKeys } from "../primitives";
import { useDesignerSettings, useOverlay, useSchema, useSelect } from "@/app/hooks";
import { Dock } from "./dock";
import { Minimap } from "./minimap";
import { MemoCard } from "./memo-card";
import { PackageLayer } from "./package-layer";
import { HeatLegend, IndexSuggestions } from "./index-suggestions";
import { ImpactPanel } from "./impact-panel";
import { CrowMarkers, RelationshipEdge } from "./relationship-edge";
import { SchemaGroupCard, SchemaGroupMenu } from "./schema-group";
import { SelectionToolbar } from "./selection-toolbar";
import { TableCard } from "./table-card";

type TableCardProps = ComponentProps<typeof TableCard>;
type MemoCardProps = ComponentProps<typeof MemoCard>;
type SchemaGroupCardProps = ComponentProps<typeof SchemaGroupCard>;

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
type EdgePoint = Point & { direction: 1 | -1 };

/**
 * The camera, straight from the custom properties `applyViewport` writes. A
 * constant string: nothing here is interpolated from React state, which is the
 * point — see the rule in `context/transform-context`.
 */
const VIEWPORT_TRANSFORM =
  "translate3d(var(--pan-x), var(--pan-y), 0) scale(var(--zoom))";


/** A link being dragged from a column towards a drop target. */
export type Linking = {
  pointerId: number;
  sourceTableId: string;
  sourceColumnId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

/** One resolved edge: both endpoints, already looked up. */
export type CanvasRelationship = {
  id: string;
  from: Table;
  fromIndex: number;
  to: Table;
  toIndex: number;
  relationship: Relationship;
};

/**
 * Everything the canvas needs that is *not* already in a context. It is one
 * object rather than forty props because it is one thing: the gesture surface.
 *
 * `canvas-host` builds it one level up, and that is as far as it travels. The
 * fourteen commands the appbar's menus and the global key handler also fire
 * reach them through `CanvasCommandsContext` instead, so nothing above the
 * canvas holds a value that changes every frame. Dissolving the rest of this
 * object into a canvas-scoped context is a separate refactor.
 */
export type CanvasGestures = {
  canvasRef: RefObject<HTMLDivElement | null>;
  grabbing: boolean;
  panMode: boolean;
  dragPosition: { id: string; x: number; y: number } | null;
  dragGroupPosition: { id: string } | null;
  dragSelection: unknown | null;
  marquee: Rect | null;
  resizeTable: { id: string; width: number } | null;
  linking: Linking | null;
  multiFrame: Box | null;
  peerSelection: Map<string, Peer>;

  onCanvasDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onCanvasDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  finishLinking: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;

  livePosition: (table: Table) => Point;
  liveWidth: (table: Table) => number;
  liveMemo: (memo: Memo) => Box;
  liveGroup: (group: SchemaGroup) => Box;

  editingMemoId: string | null;
  setEditingMemoId: React.Dispatch<React.SetStateAction<string | null>>;
  memoHadText: RefObject<Set<string>>;

  pressSelection: (
    event: ReactPointerEvent<HTMLElement>,
    kind: "table" | "memo" | "group",
    id: string,
  ) => void;
  startLinking: TableCardProps["onStartLink"];
  onHeaderDown: TableCardProps["onHeaderDown"];
  onTableResizeDown: TableCardProps["onResizeDown"];
  onTableResizeKeyDown: TableCardProps["onResizeKeyDown"];
  onCardKeyDown: TableCardProps["onKeyDown"];
  onMemoDown: MemoCardProps["onPointerDown"];
  onMemoResizeDown: MemoCardProps["onResizePointerDown"];
  onGroupDown: SchemaGroupCardProps["onHeadPointerDown"];
  onGroupResizeDown: SchemaGroupCardProps["onResizePointerDown"];
  onGroupBodyDown: SchemaGroupCardProps["onPointerDown"];
  selectMemo: MemoCardProps["onSelect"];
  clickMemo: MemoCardProps["onClick"];
  focusMemoText: MemoCardProps["onFocusText"];
  changeMemoText: MemoCardProps["onChangeText"];
  blurMemoText: MemoCardProps["onBlurText"];

  resetTableWidth: (id: string) => void;
  commitGroupSize: (id: string, width: number, height: number) => void;
  commitMemoSize: (id: string, width: number, height: number) => void;
  patchGroup: (id: string, patch: Partial<SchemaGroup>) => void;
  deleteGroup: (id: string) => void;
  applyGroupKeyword: (id: string) => void;
  unprefixedTables: (id: string) => Table[];
  patchMemo: (id: string, patch: Partial<Memo>) => void;
  deleteMemo: (id: string) => void;

  relationships: CanvasRelationship[];
  relationshipPoint: (
    table: Table,
    columnIndex: number,
    other: Table,
    key: string,
  ) => EdgePoint;
  relationshipCounts: Map<string, number>;
  foreignKeyTarget: TableCardProps["foreignKeyTarget"];

  /** `at` is canvas space — where a context menu was opened. */
  addTable: (groupId?: string, at?: Point) => void;
  editTableInPanel: (tableId: string) => void;
  copyTableDDL: (tableId: string) => void;
  makeJunction: () => void;

  zoomBy: (delta: number) => void;
  fitView: () => void;
  addGroup: (at?: Point) => void;
  addMemo: (at?: Point, schemaId?: string) => void;
  autoLayout: () => void;
  onToggleHand: () => void;

  hint: (id: ShortcutId) => string;
  /** Fires the same closure the chord does, so a menu row cannot drift from it. */
  runShortcut: (id: ShortcutId) => void;
  copySelection: (format: "sql" | "json") => void;
  deleteSelection: () => void;
  duplicateSelection: (tableIds?: string[]) => void;
  selectGroupMembers: (groupId: string) => void;
  canvasPoint: (event: { clientX: number; clientY: number }) => Point;
  pasteSelection: (text: string) => void;
};

export type CanvasProps = {
  readOnly: boolean;
  save: () => Promise<void> | void;
  gestures: CanvasGestures;
};

export function Canvas({ readOnly, save, gestures: g }: CanvasProps) {
  const { schema, groupsById, peers, self, cursors, addColumn, addIndex, deleteTable, reorderColumns } =
    useSchema();
  const { heatmap, analysis, setImpactTarget } = useOverlay();
  const showImpact = useCallback(
    (tableId: string, columnId: string) => setImpactTarget({ tableId, columnId }),
    [setImpactTarget],
  );
  const {
    selection,
    single,
    selectedId,
    selectedGroupId,
    selectedMemoId,
    setSelection,
    selectTable,
  } = useSelect();
  const { settings, isMac } = useDesignerSettings();
  /** Where the background menu was opened, in canvas space. */
  const contextPointRef = useRef<Point>({ x: 0, y: 0 });
  /** The group the menu was opened over, if any — see `groupUnder` below. */
  const [contextGroupId, setContextGroupId] = useState<string | null>(null);
  const contextGroup = (schema.groups ?? []).find(
    (group) => group.id === contextGroupId,
  );

  /*
   * Both ends of every edge, resolved once. `relationshipPoint` keeps per-anchor
   * hysteresis in a ref, so it is called on every render rather than inside a
   * memo -- skipping a render would freeze the flank an edge leaves from.
   */
  const edges = g.relationships.map((relationship) => ({
    id: relationship.id,
    relationship: relationship.relationship,
    from: {
      ...g.relationshipPoint(
        relationship.from,
        relationship.fromIndex,
        relationship.to,
        `${relationship.id}:from`,
      ),
      tableId: relationship.from.id,
    },
    to: {
      ...g.relationshipPoint(
        relationship.to,
        relationship.toIndex,
        relationship.from,
        `${relationship.id}:to`,
      ),
      tableId: relationship.to.id,
    },
  }));

  /*
   * Routing is the one thing here that reads the whole diagram, so it is keyed
   * on *committed* geometry: a drag moves cards a hundred times a second and
   * re-routing all of them per frame is exactly the cost the gesture layer was
   * moved down here to avoid. The signature only changes when a position is
   * committed, so a drag reuses the map it started with and the trunks re-settle
   * once, on release.
   */
  // Itself memoized on the committed identities: building it is O(tables +
  // edges) of string work, which is not free to redo on every pointermove.
  const routeSignature = useMemo(
    () =>
      [
        schema.tables
          .map((table) => `${table.id}@${table.x},${table.y}`)
          .join("|"),
        g.relationships
          .map((edge) => `${edge.id}:${edge.fromIndex}:${edge.toIndex}`)
          .join("|"),
      ].join("#"),
    [schema.tables, g.relationships],
  );
  const routes = useMemo(
    () =>
      routeEdges(
        edges.map(({ id, from, to }) => ({ id, from, to })),
        schema.tables.map((table) => ({
          id: table.id,
          x: table.x,
          y: table.y,
          width: tableWidth(table),
          height: tableHeight(table),
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature is
    // the dependency; `edges` is rebuilt every render by design (see above).
    [routeSignature],
  );

  /*
   * A card in flight has moved out from under the routed map, so its edges fall
   * back to the bend they can derive on their own until the position is
   * committed and everything re-routes. The fan reads the same bend the edge
   * draws with, so its slot order always matches the trunks on screen.
   */
  const bendOf = ({ id, from, to }: EdgeInput) =>
    g.dragPosition?.id === from.tableId || g.dragPosition?.id === to.tableId
      ? idealBend(from, to)
      : (routes.get(id) ?? idealBend(from, to));
  const fanned = fanPorts(edges.map(({ id, from, to }) => ({ id, from, to })), bendOf);

  /*
   * A group's body is `pointer-events: none` so the canvas can be panned and
   * marquee-selected straight through it, which means a right-click inside one
   * lands on the canvas and never reaches the group at all. Only the head and
   * the resize handle can be found by walking up the DOM; the body has to be
   * found geometrically, against the same live rect the group is drawn at.
   */
  const groupUnder = (event: ReactMouseEvent, point: Point) => {
    const target = event.target as Element | null;
    // A card inside a group opens its own menu, and claims the selection with
    // it -- the group underneath it is not what was right-clicked.
    if (target?.closest?.(".table-card, .memo-card")) return null;
    return (
      target?.closest?.("[data-group-id]")?.getAttribute("data-group-id") ??
      [...(schema.groups ?? [])]
        .reverse()
        .find((group) => enclosedBy(g.liveGroup(group), point.x, point.y))
        ?.id ??
      null
    );
  };

  /*
   * The ⌘V path rides the window's `paste` event, which carries the clipboard
   * with it. A menu item has no such event, so it has to ask -- and the ask can
   * be refused, which is the one case worth telling the user about.
   */
  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) g.pasteSelection(text);
    } catch {
      toast.error("Clipboard access was blocked. Press ⌘V instead.");
    }
  };

  return (
    /*
     * Wrapping the frame, not sitting inside it: the trigger renders as a
     * `display: contents` wrapper, and `.canvas` is a zero-size absolute box,
     * so a right-click on the empty grid targets the frame itself and would
     * never reach a handler mounted below it.
     */
    <ContextMenuTrigger>
      <div
        ref={g.canvasRef}
        className={`canvas-wrap ${g.grabbing ? "grabbing" : ""} ${g.grabbing || g.dragPosition || g.marquee || g.dragSelection ? "gesturing" : ""} ${g.panMode ? "pan-mode" : ""} ${g.linking ? "linking" : ""}`}
        onPointerDownCapture={g.onCanvasDownCapture}
        onPointerDown={g.onCanvasDown}
        onPointerMove={g.onPointerMove}
        onPointerLeave={g.onPointerLeave}
        onPointerUp={g.finishLinking}
        onPointerCancel={g.onPointerCancel}
        /*
         * Captured, so the point is recorded before the trigger below opens the
         * menu — and in canvas space, since that is where a new card is placed.
         */
        onContextMenuCapture={(event) => {
          const point = g.canvasPoint(event);
          contextPointRef.current = point;
          const groupId = groupUnder(event, point);
          setContextGroupId(groupId);
          if (groupId) setSelection(selectOnly("group", groupId));
        }}
      >
        <div
          className="canvas"
          /*
           * Read from custom properties rather than from `pan`/`zoom` state, so
           * the string here is a constant and a mid-gesture render can never
           * stamp a stale camera over the live one. `applyViewport` is the only
           * writer; see `context/transform-context`.
           */
          style={{
            transform: VIEWPORT_TRANSFORM,
            willChange: g.grabbing || g.dragPosition ? "transform" : undefined,
          }}
        >
          {(schema.groups ?? []).map((group) => (
            <SchemaGroupCard
              key={group.id}
              group={group}
              position={g.liveGroup(group)}
              isSelected={selectedGroupId === group.id}
              inMultiSelection={
                !single && isSelected(selection, "group", group.id)
              }
              isMoving={g.dragGroupPosition?.id === group.id}
              readOnly={readOnly}
              onPointerDown={g.onGroupBodyDown}
              onHeadPointerDown={g.onGroupDown}
              onResizePointerDown={g.onGroupResizeDown}
              onPatch={g.patchGroup}
              onDelete={g.deleteGroup}
              onResizeCommit={g.commitGroupSize}
            />
          ))}
          {(schema.memos ?? []).map((memo) => (
            <MemoCard
              key={memo.id}
              memo={memo}
              position={g.liveMemo(memo)}
              isSelected={selectedMemoId === memo.id}
              inMultiSelection={
                !single && isSelected(selection, "memo", memo.id)
              }
              isEditing={g.editingMemoId === memo.id}
              onPointerDown={g.onMemoDown}
              onResizePointerDown={g.onMemoResizeDown}
              onSelect={g.selectMemo}
              onClick={g.clickMemo}
              onPatch={g.patchMemo}
              onDelete={g.deleteMemo}
              onResizeCommit={g.commitMemoSize}
              onFocusText={g.focusMemoText}
              onChangeText={g.changeMemoText}
              onBlurText={g.blurMemoText}
            />
          ))}
          <PackageLayer
            packages={schema.packages ?? []}
            tables={schema.tables}
            livePosition={g.livePosition}
            cardStyle={settings.cardStyle}
            readOnly={readOnly}
          />
          {/*
          No width or height: the overlay is pinned to the canvas origin
          and paints outside its own box (`overflow: visible`), so an edge
          between two cards a long way out still draws.
        */}
          <svg className={`edges ${settings.cardStyle === "document" ? "document" : ""}`} aria-hidden="true">
            {settings.cardStyle === "document" && <CrowMarkers />}
            {fanned.map(({ id, from, to }, index) => {
              const { relationship } = edges[index];
              const [fromCardinality, toCardinality] =
                relationshipCardinalities(relationship);
              return (
                <RelationshipEdge
                  key={id}
                  edgeId={id}
                  fromX={from.x}
                  fromY={from.y}
                  fromDirection={from.direction}
                  toX={to.x}
                  toY={to.y}
                  toDirection={to.direction}
                  fromMarkerShift={from.markerShift}
                  toMarkerShift={to.markerShift}
                  bendX={bendOf({ id, from, to })}
                  fromCardinality={fromCardinality}
                  toCardinality={toCardinality}
                  label={relationship.name}
                  active={
                    selectedId === from.tableId || selectedId === to.tableId
                  }
                  showCardinality={settings.showCardinality}
                  showLabel={settings.showRelationshipLabels}
                  curved={settings.cardStyle === "document"}
                />
              );
            })}
          </svg>
          {schema.tables.map((table) => {
            const position = g.livePosition(table);
            const moving = g.dragPosition?.id === table.id;
            const heldBy = g.peerSelection.get(table.id);
            return (
              <TableCard
                key={table.id}
                table={table}
                x={position.x}
                y={position.y}
                width={g.liveWidth(table)}
                moving={moving}
                selected={selectedId === table.id}
                multiSelected={
                  !single && isSelected(selection, "table", table.id)
                }
                resizing={g.resizeTable?.id === table.id}
                hoverDisabled={moving || g.grabbing || g.linking !== null}
                heldByName={heldBy && displayName(heldBy, peers, self)}
                heldByColor={heldBy?.color}
                group={
                  table.schemaId ? groupsById.get(table.schemaId) : undefined
                }
                relationshipCount={g.relationshipCounts.get(table.id) ?? 0}
                foreignKeyTarget={g.foreignKeyTarget}
                readOnly={readOnly}
                isMac={isMac}
                onSelect={selectTable}
                onHeaderDown={g.onHeaderDown}
                onResizeDown={g.onTableResizeDown}
                onResizeKeyDown={g.onTableResizeKeyDown}
                onResetWidth={g.resetTableWidth}
                onKeyDown={g.onCardKeyDown}
                onStartLink={g.startLinking}
                onEditInPanel={g.editTableInPanel}
                onCopyDDL={g.copyTableDDL}
                onAddColumn={addColumn}
                onMakeJunction={g.makeJunction}
                onDuplicate={g.duplicateSelection}
                onDeleteTable={deleteTable}
                onShowImpact={showImpact}
                cardStyle={settings.cardStyle}
                reorderColumns={reorderColumns}
              />
            );
          })}
          {g.multiFrame && (
            <div
              className="selection-frame"
              aria-hidden="true"
              style={{
                transform: `translate3d(${g.multiFrame.x}px, ${g.multiFrame.y}px, 0)`,
                width: g.multiFrame.width,
                height: g.multiFrame.height,
              }}
            />
          )}
          {g.marquee && (
            <div
              className="marquee"
              aria-hidden="true"
              style={{
                transform: `translate3d(${g.marquee.x}px, ${g.marquee.y}px, 0)`,
                width: g.marquee.width,
                height: g.marquee.height,
              }}
            />
          )}
          {heatmap && (
            <IndexSuggestions
              tables={schema.tables}
              suggestions={analysis.suggestions}
              readOnly={readOnly}
              livePosition={g.livePosition}
              liveWidth={g.liveWidth}
              onAdd={addIndex}
            />
          )}
          <PeerCursors peers={peers} self={self} cursors={cursors} />
        </div>
        {heatmap && <HeatLegend />}
        <ImpactPanel />

        {/*
        Anchored to the frame but drawn in screen space and never scaled:
        a toolbar that shrank with the zoom would be unreadable at the point
        you most need it. Hidden mid-gesture — chrome that follows a drag is
        noise, and the frame is doing the work of showing what is held.
      */}
        {g.multiFrame && !g.dragSelection && !g.marquee && (
          <SelectionToolbar
            frame={g.multiFrame}
            readOnly={readOnly}
            hint={g.hint}
            onCopy={g.copySelection}
            onDuplicate={() => g.duplicateSelection()}
            onDelete={g.deleteSelection}
          />
        )}

        {g.linking && <LinkingOverlay linking={g.linking} />}

        {/*
        Grouped by what each control changes: the viewport, then history,
        then what the diagram contains, then the document as a whole.
        Proximity is a claim about relationship, so a command that moves the
        camera cannot sit among the ones that add tables.
      */}
        {/*
        The add commands are called, never passed: they take an optional canvas
        point, and a click handler would hand them the DOM event as one.
      */}
        {settings.showMinimap && (
          <Minimap
            tables={schema.tables}
            groups={schema.groups}
            memos={schema.memos}
            cardStyle={settings.cardStyle}
          />
        )}
        <Dock
          panMode={g.panMode}
          onToggleHand={g.onToggleHand}
          zoomBy={g.zoomBy}
          fitView={g.fitView}
          addTable={() => g.addTable()}
          addGroup={() => g.addGroup()}
          addMemo={() => g.addMemo()}
          makeJunction={g.makeJunction}
          hasSelectedTable={Boolean(selectedId)}
          autoLayout={g.autoLayout}
          save={save}
        />
        <ContextMenu className="w-auto">
          {contextGroup ? (
            <SchemaGroupMenu
              group={contextGroup}
              pendingPrefix={g.unprefixedTables(contextGroup.id).length}
              readOnly={readOnly}
              onPatch={g.patchGroup}
              onDelete={g.deleteGroup}
              onAddTable={(groupId) =>
                g.addTable(groupId, contextPointRef.current)
              }
              onAddMemo={(groupId) =>
                g.addMemo(contextPointRef.current, groupId)
              }
              onSelectMembers={g.selectGroupMembers}
              onApplyKeyword={g.applyGroupKeyword}
            />
          ) : (
            <>
              <ContextMenuGroup>
                <ContextMenuItem
                  isDisabled={readOnly}
                  onAction={() =>
                    g.addTable(undefined, contextPointRef.current)
                  }
                >
                  <TableIcon/>
                  Add table here
                  <ContextMenuShortcut>
                    <ShortcutKeys id="addTable" isMac={isMac} />
                  </ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  isDisabled={readOnly}
                  onAction={() => g.addGroup(contextPointRef.current)}
                >
                  <DatabaseIcon/>
                  Add schema group here
                  <ContextMenuShortcut>
                    <ShortcutKeys id="addGroup" isMac={isMac} />
                  </ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  isDisabled={readOnly}
                  onAction={() => g.addMemo(contextPointRef.current)}
                >
                  <StickyNoteIcon/>
                  Add memo here
                  <ContextMenuShortcut>
                    <ShortcutKeys id="addMemo" isMac={isMac} />
                  </ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem
                  isDisabled={readOnly}
                  onAction={() => void pasteFromClipboard()}
                >
                  <ClipboardIcon/>
                  Paste
                  <ContextMenuShortcut>
                    <ShortcutKeys id="pasteSelection" isMac={isMac} />
                  </ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  isDisabled={
                    !schema.tables.length &&
                    !(schema.groups ?? []).length &&
                    !(schema.memos ?? []).length
                  }
                  onAction={() => g.runShortcut("selectAll")}
                >
                  <SquareDashedMousePointerIcon/>
                  Select all
                  <ContextMenuShortcut>
                    <ShortcutKeys id="selectAll" isMac={isMac} />
                  </ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem onAction={g.fitView}>
                  <MaximizeIcon/>
                  Fit to screen
                  <ContextMenuShortcut>
                    <ShortcutKeys id="fitView" isMac={isMac} />
                  </ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  isDisabled={readOnly || !schema.tables.length}
                  onAction={() => g.runShortcut("tidyLayout")}
                >
                  <Grid3x3Icon/>
                  Tidy up layout
                  <ContextMenuShortcut>
                    <ShortcutKeys id="tidyLayout" isMac={isMac} />
                  </ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuGroup>
            </>
          )}
        </ContextMenu>
      </div>
    </ContextMenuTrigger>
  );
}

/** The rubber band drawn from a column to the pointer while a link is dragged. */
function LinkingOverlay({
  linking,
}: {
  linking: { startX: number; startY: number; x: number; y: number };
}) {
  return (
    <svg
      className="linking-overlay"
      style={{ transform: VIEWPORT_TRANSFORM }}
      aria-hidden="true"
    >
      <path
        d={`M ${linking.startX} ${linking.startY} L ${linking.x} ${linking.y}`}
      />
    </svg>
  );
}
