import {
  TABLE_COLOR_STRIP_HEIGHT,
  TABLE_HEADER_HEIGHT,
  TABLE_FIELD_HEIGHT,
  type MemoColor,
} from "@/app/lib/schema";

/** Header offset for row anchors: the colour strip sits above the title bar. */
export const HEADER_HEIGHT = TABLE_COLOR_STRIP_HEIGHT + TABLE_HEADER_HEIGHT;
export const ROW_HEIGHT = TABLE_FIELD_HEIGHT;
/**
 * There is no world. Coordinates are unbounded in every direction, negatives
 * included, and nothing is clamped: the camera is free and cards rest wherever
 * they are dropped. `.canvas` carries no width or height for the same reason —
 * a sized element is a wall, and a wall is what a diagram grows into.
 *
 * The grid is drawn from these two, matching drawDB's `gridSize` and
 * `gridCircleRadius`, and is anchored to canvas coordinates rather than to the
 * viewport, so the lattice tiles forever without an element to size.
 */
export const GRID_SIZE = 24;
export const GRID_DOT_RADIUS = 0.85;
/**
 * Below `GRID_FADE_END` a 24px lattice is denser than the pixels available to
 * draw it and reads as a grey wash, so it fades out instead. Nothing to see
 * out here is the honest signal — not a smeared texture.
 */
export const GRID_FADE_START = 0.35;
export const GRID_FADE_END = 0.15;
/**
 * The floor is low because the canvas has no ceiling: a diagram can outgrow any
 * particular framing, and `fitView` has to be able to frame it.
 */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 1.8;
/**
 * Wheel deltas arrive in three units (pixels, lines, pages) and at wildly
 * different magnitudes: a trackpad pinch reports a few pixels per event, one
 * mouse notch reports 100 at once. Both are normalised to pixels, then a single
 * event's contribution is capped at `ZOOM_STEP_LIMIT` so a notch scales by a
 * smooth ~13% instead of jumping by `exp(1)`.
 */
export const WHEEL_LINE_HEIGHT = 16;
export const WHEEL_PAGE_HEIGHT = 400;
export const ZOOM_SENSITIVITY = 0.005;
export const ZOOM_STEP_LIMIT = 24;
/**
 * How long after the last wheel event the camera is committed to React state.
 * Wheel has no end event, so this timer plays the part `pointerup` plays for a
 * pan: until it fires, the camera lives in `panRef`/`zoomRef` and the DOM only.
 * Long enough that a continuous scroll never commits mid-gesture, short enough
 * that the dock's zoom readout still reads as live.
 */
export const WHEEL_SETTLE_MS = 120;
/** Movement before a press is treated as a drag rather than a tap. */
export const DRAG_THRESHOLD = 4;
/** Arrow-key nudge for keyboard positioning. */
export const NUDGE = 8;
export const MEMO_MIN_WIDTH = 180;
export const MEMO_MIN_HEIGHT = 100;
export const MEMO_MAX_WIDTH = 560;
export const MEMO_MAX_HEIGHT = 520;
export const GROUP_MIN_WIDTH = 360;
export const GROUP_MIN_HEIGHT = 260;
export const GROUP_HEADER_HEIGHT = 42;
/** Clearance kept between two table cards when a drop is resolved. */
export const TABLE_GAP = 18;
/** How far an edge runs straight out of its anchor before it may turn. Long
 *  enough to clear the cardinality marker that sits on that run. */
export const EDGE_STUB = 44;
/** Cardinality markers sit on that stub, short of the bend. */
export const MARKER_DISTANCE = 28;
/**
 * Spacing between two edges' vertical trunks. Wide enough that two adjacent
 * 2.5px strokes read as two lines rather than one thick one, narrow enough that
 * a dozen edges sharing a corridor still fit inside it.
 */
export const LANE_PITCH = 14;
/** Slack on the "do these two trunks overlap" test, so trunks that merely meet
 *  end to end still count -- they would draw as one unbroken stroke. */
export const LANE_SHARE_MARGIN = 6;
/** Clearance kept between a trunk and the card it routes past. */
export const EDGE_CARD_CLEARANCE = 10;
/** How far past its anchors a trunk may be pushed to find a clearer lane. */
export const EDGE_MAX_DETOUR = 320;
/**
 * What a lane costs, in pixels of detour. Crossing a card is worth a long walk
 * around it; sharing a lane with an overlapping trunk is worth a shorter one.
 */
export const EDGE_CROSS_PENALTY = 1000;
export const EDGE_SHARE_PENALTY = 260;
/** Candidate lanes examined per edge, so a wide corridor stays O(1) to search. */
export const EDGE_LANE_SAMPLES = 64;
/**
 * Spacing between edges that share one port (same card, row and flank), fanned
 * across the row instead of drawn on top of each other. Squeezed for a crowded
 * port so every end stays inside its row's band, clear of the rows beside it.
 */
export const PORT_PITCH = 8;
export const PORT_ROW_MARGIN = 6;
/** How far a fanned end's cardinality pill steps out along its line, so pills
 *  on neighbouring ends sit side by side rather than stacked on each other. */
export const PORT_MARKER_STEP = 26;
export const MEMO_COLORS: {
  id: MemoColor;
  label: string;
  background: string;
  border: string;
}[] = [
  {
    id: "yellow",
    label: "Yellow",
    background: "var(--memo-yellow-surface)",
    border: "var(--memo-yellow-edge)",
  },
  {
    id: "blue",
    label: "Blue",
    background: "var(--memo-blue-surface)",
    border: "var(--memo-blue-edge)",
  },
  {
    id: "green",
    label: "Green",
    background: "var(--memo-green-surface)",
    border: "var(--memo-green-edge)",
  },
  {
    id: "pink",
    label: "Pink",
    background: "var(--memo-pink-surface)",
    border: "var(--memo-pink-edge)",
  },
];

/** How far one arrow-key press resizes a handle; Shift takes a coarse step. */
export const RESIZE_STEP = 8;
export const RESIZE_STEP_COARSE = 32;

export type PanelTab = "tables" | "relationships" | "queries" | "packages";
export type PanelMode = "structure" | "code";

/** Select needs a real key for "no selection", since null renders the placeholder. */
export const NO_GROUP = "__ungrouped__";
export const NO_REFERENCE = "__no_reference__";
