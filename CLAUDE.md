# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (pinned to `pnpm@11.0.9` via `packageManager`).

```bash
pnpm dev                      # node --import tsx server.ts — Next + the collab socket, one process, port 4000
pnpm start                    # node dist/server.cjs — the compiled server, production mode (after pnpm build); PORT overrides 4000
pnpm build                    # next build --webpack (the flag is required), then scripts/build-server.mjs → dist/server.cjs
pnpm typecheck                # tsc --noEmit
pnpm test                     # vitest run (node environment)
pnpm vitest run -t "detects normalization collisions"   # single test by name
pnpm vitest run tests/oracle.test.ts                    # single file
pnpm drizzle-kit push         # create the auth tables in <DATA_DIR>/auth.db (no npm script exists)
```

`pnpm lint` is **broken** — it runs `next lint`, which Next 16 removed. Use `pnpm typecheck` instead, or fix the script if linting is needed.

The spec's definition of done (`docs/superpowers/specs/`) is: `pnpm test`, `pnpm build`, `pnpm typecheck`, and `git diff --check` all pass.

There is **no database server**. `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `COLLAB_TOKEN_SECRET` are required (the server refuses to start without the last unless `NEXT_PUBLIC_COLLAB=off`); `DATA_DIR` (default `./data`) is where everything durable lives. Auth opens its SQLite file at module load, so importing `app/lib/auth.ts` creates `<DATA_DIR>/auth.db` as a side effect.

## Architecture

An Oracle 12.2+ schema designer: a PLStudio-style canvas where you draw tables, and the app generates Oracle DDL and PL/SQL CRUD packages.

**The domain model is the center of the app.** `app/lib/schema.ts` defines `Schema → Table → Column`, and everything else is a pure function over it:

- `app/lib/validation.ts` — `validateSchema()` returns `ValidationIssue[]`; enforces Oracle identifier rules (128-byte limit, reserved words, post-normalization collisions), per-type precision/size rules (`validateTypeSpec`), and a deliberately narrow CHECK-expression subset (`validateCheckExpression` rejects semicolons, DDL/DML keywords, unbalanced quotes).
- `app/lib/lint.ts` — `lintSchema()` returns `LintFinding[]` (severity `"suggestion"`): design advice that `validateSchema` deliberately does not give, never blocking. Rules are a registry (`LINT_RULES`, grouped by family); `Schema.lint.disabled` turns them off per project and syncs like any other field. A finding's `fix` is *data*, not a closure, because findings come from the deferred schema: `applyLintFix(current, finding)` re-lints `current` and returns it unchanged unless the same finding (`key`) still holds, so a stale click cannot overwrite a collaborator's fix. The Issues drawer lists suggestions under errors and warnings.
- `app/lib/generators.ts` — `generateDDL()` / `generatePLSQL()` / `exportSchema()`.
- `app/lib/bulk-columns.ts` — `findColumns` / `patchColumns` / `renameColumns`, behind the Edit columns dialog (⌘⇧F). Each returns a whole next `Schema`, so a bulk edit is one commit and one undo. `app/lib/palette.ts` builds and ranks the ⌘K palette's items from `SHORTCUTS`, so the palette runs the same `shortcutActions` as the chords and menus.
- `app/lib/parser.ts` — `parseCreateTable()` imports a _subset_ of `CREATE TABLE` SQL back into a `Schema`, returning `{ schema, warnings, errors }`. It only round-trips what the generator emits; unsupported table-level constraints become warnings, not failures.

`normalizeIdentifier()` (uppercase, non-`[A-Z0-9_$#]` → `_`, numeric-leading prefixed `T_`) is applied at generation and validation time, not at edit time — users type freely and normalization happens on the way out. This is why collision detection compares _normalized_ names.

**Deliberate v1 constraints** — do not "fix" these without being asked:

- Foreign keys are single-column only. FKs targeting a composite-PK table are a validation error, and `generateDDL` silently skips them.
- Uniqueness has two forms and they do not overlap: `Column.unique` is a single-column `UNIQUE`, and `Table.uniques` (`UniqueConstraint[]`) is the multi-column one. A composite constraint does *not* set the flag on its members — that would emit one constraint per column. `normalizeTables` prunes a constraint's `columnIds` against the columns that exist, so a deleted column shrinks its constraints rather than breaking them, and `generateDDL` numbers table-level constraints on from the single-column ones so older diagrams generate byte-identical DDL.
- `keyStrategy` is per-table: `"none"` | `"sequence-trigger"` (emits `CREATE SEQUENCE` + a `BEFORE INSERT` trigger) | `"identity"` (emits `GENERATED ALWAYS AS IDENTITY`, no sequence/trigger). Generated strategies require exactly one `NUMBER` PK; otherwise `keyStrategyArtifacts` returns nothing and validation warns.
- `Schema.columnTemplates` (`ColumnTemplate[]`) are the project's own reusable column blocks, beside the code-only `BUILTIN_COLUMN_TEMPLATES`. A template column has no `id` or `fk`; `applyColumnTemplate` mints ids and skips any column whose normalized name the table already has, so applying twice is a no-op. Copy/paste leaves templates behind, like `queries`.
- `Schema.groups` (`SchemaGroup[]`) are canvas regions, not DDL: a table or memo joins one via `schemaId`. A group's `keyword` is an advisory name prefix stamped on tables *created* in it (or by the explicit apply action) and never enforced afterwards.

### UI

The editor is laid out like drawDB's: a provider-only entry point, a shell, and one directory per screen region.

- `app/components/designer.tsx` — mounts the provider stack and nothing else (drawDB's `pages/Editor.jsx`).
- `app/components/designer/workspace.tsx` — the shell (drawDB's `components/Workspace.jsx`). It owns the menu tree, the save pipeline and the two per-row renderers the side panel takes as render props — but not the gesture layer (see below).
- `editor-header/` — `control-panel.tsx` (the appbar) and `modal/`, whose `modal.tsx` switches on the modal union the way drawDB switches on its `MODAL` enum.
- `editor-canvas/` — one file per drawable (`table-card`, `schema-group`, `memo-card`, `relationship-edge`, …) plus `canvas-host` and `use-canvas-gestures.ts`.
- `editor-side-panel/` — `side-panel.tsx` (shell), `code-view`, `issues`, and a folder per tab.
- `designer/constants.ts` and `designer/geometry.ts` — the canvas constants and the pure helpers, dependency-free.

State lives in `designer/context/`, each context paired 1:1 with a hook re-exported from `app/hooks/index.ts` — so components read `useSchema()`, `useSelect()`, `useOverlay()` and so on rather than taking twenty props. `SchemaProvider` wraps `useCollaborativeSchema` and owns the structural mutations and the derived `tablesById`/`issues`/`ddl`; the DDL comes from `use-worker-ddl.ts`, which generates in a Web Worker with the save queue's one-in-flight/coalesce-to-newest shape. `OverlayProvider` derives the query heatmap and column impact analysis from the schema's saved `queries`. Provider order in `designer.tsx` is a dependency order: `SchemaProvider` reads the panel mode and marks the document dirty, and `OverlayProvider` reads `SchemaProvider`.

**High-frequency gesture state (`dragPosition`, `marquee`, the resize values) is deliberately not in a tree-wide context, and not in `workspace.tsx` either** — it lives in `useCanvasGestures`, called by `editor-canvas/canvas-host.tsx`, which sits _below_ the appbar and the side panel. That placement is the whole point: a `pointermove` re-renders the canvas and nothing else. Keeping the hook above them (as it was) re-rendered 25 table editors per frame regardless of how well the children were memoized, because `useContext` re-renders on provider value identity and `React.memo` cannot stop it.

The fifteen commands that genuinely have to cross _upward_ — `addTable`, `addGroup`, `addMemo`, `makeJunction`, `autoLayout`, `fitView`, `zoomBy`, `copySelection`, `deleteSelection`, `duplicateSelection`, `pasteSelection`, `revealTables`, `setHandMode`, `setSpaceHeld`, `assignTableToGroup` — go through `context/canvas-commands-context.tsx`. It is **ref-backed**: `canvas-host` re-registers the live closures in a `useLayoutEffect` on every render, and the context value is built once out of forwarders that read the ref, so consuming it never re-renders anything. Only put a command (a void function) in there — never a rendered value, which would go stale. Commands fired before the canvas mounts are no-ops, which is correct.

Keep the `xRef.current = x` mirrors too: the long-lived pointer/key listeners read them so they never re-subscribe mid-gesture.

Canvas geometry (`TABLE_WIDTH`, `TABLE_COLOR_STRIP_HEIGHT`, `TABLE_HEADER_HEIGHT`, `TABLE_FIELD_HEIGHT`) is defined once in `app/lib/schema.ts` alongside `tableHeight()`; `designer/constants.ts` re-derives `HEADER_HEIGHT`/`ROW_HEIGHT` from it. Relationship anchors are derived from these — if the card's visual layout changes, update the constants rather than hardcoding new offsets.

Cards have two `CardStyle`s: `classic` (colour strip over a white header) and `document` (filled header plus the table comment wrapped beneath it). The canvas draws whichever the user picked in settings; the export always draws `document`. A document card's height depends on its comment, so `tableHeaderHeight(table, style)`/`tableHeight(table, style)` compute the wrap with `commentLines()` rather than measuring the DOM — that is what keeps the canvas, the export and the relationship anchors agreeing. Always pass the style through; the `classic` default is only right for classic cards.

Width follows the same rule: `tableWidth()` fits the card to its widest header or row from Geist/JetBrains Mono advance widths measured once in Chrome (`SANS_ADVANCES` in `schema.ts`), plus the chrome the CSS adds around the text. If you change a row's padding, gaps, icons or fonts, update `ROW_CHROME`/`HEADER_CHROME` with it. The fit is a floor under a manual `width`, which can only add room, and both are capped at `TABLE_MAX_WIDTH`.

Undo/redo is per-user `Y.UndoManager` (see Realtime collaboration), not a local history stack.

Canvas gestures live in `app/lib/motion.ts` (pure, tested): `Spring` (analytic damped oscillator, re-targetable mid-flight), `VelocityTracker`, `project()` for momentum, `rubberClamp()` for soft bounds. Drags do **not** write to `schema` per frame — the live position sits in `dragPosition` state and is committed once on release, so `validateSchema`/`generateDDL` don't rerun every pointermove. Anything reading a table's on-screen position must go through `livePosition(table)`, not `table.x/y`.

The camera follows the same rule one level up. `applyViewport(pan, zoom)` (`context/transform-context.tsx`) writes `panRef`/`zoomRef` and the custom properties `.canvas` and the overlays are positioned from — `--pan-x`, `--pan-y`, `--zoom`, `--inverse-zoom`, and the five `--grid-*` — and touches no state. A pan, a wheel-zoom and the release momentum all drive it per frame and commit to `pan`/`zoom` state exactly once, on settle (`pointerup`, the spring's `onSettle`, or `WHEEL_SETTLE_MS` of wheel idle, since wheel has no end event). So: **anything reading the camera must go through `panRef`/`zoomRef` or a custom property, never `pan`/`zoom` state**, which is a whole gesture behind. React never writes those properties, which is what stops a mid-gesture render from stamping a stale camera; `canvas-host` re-asserts them in a `useLayoutEffect` so a freshly mounted `.canvas-wrap` picks up the live one.

Wheel handling is attached natively with `{ passive: false }` because React registers `wheel` passively, which silently no-ops `preventDefault`. Scroll pans; ctrl/⌘-scroll zooms anchored at the cursor.

`app/globals.css` (~4200 lines) owns all workspace layout, materials, table-card styling, and responsive breakpoints. Its colours are Apple's semantic system roles (`--label*`, `--bg-grouped*`, `--fill-1…4`, `--separator`, `--material-thin/regular/thick`, systemBlue as `--primary`); the older names (`--ink-*`, `--surface-*`, `--brand-*`) are aliases of them. Blur and wide shadows are optional: `<html data-effects="reduced">` (stamped before first paint by the script in `app/layout.tsx`, from `resolveEffects` in `app/lib/effects.ts` — the device when the Effects setting in the account menu is System, otherwise the setting) turns every material opaque in one block at the end of the file. New translucent surfaces should use the `--material-*` tokens so they follow it. Dark mode is `<html data-theme="dark">`, stamped before first paint by `next-themes` (`ThemeProvider` in `app/layout.tsx`, default `system`); the Appearance section of the account menu (`nav-user.tsx`) sets System/Light/Dark. `:root[data-theme="dark"]` restates only the base roles, and Tailwind's `dark:` variant is that same attribute — not a media query and not a `.dark` class. Write new colours as those roles, never hexes. It supports `prefers-reduced-motion` and `prefers-reduced-transparency` — keep new styles consistent with that.

### Persistence

Everything durable lives under `DATA_DIR` (default `./data`), resolved once in `db/paths.ts` so the app, its collab socket and `drizzle.config.ts` cannot drift:

```
<DATA_DIR>/auth.db                    SQLite — Better Auth tables only (db/schema.ts)
<DATA_DIR>/projects/<ownerId>/<projectId>.json   one ProjectRecord each
<DATA_DIR>/yjs/<projectId>.bin                   raw Yjs update log
<DATA_DIR>/shares/<tokenHash>.json               share links
<DATA_DIR>/tls/self-signed.json                  the generated HTTPS certificate (absent with HTTPS_CERT or HTTPS=off)
```

`ownerId` is `organizationId ?? createdBy ?? "_unowned"` (`ownerSegment()`). Callers still address a project by **id alone** — a share link is opened by a non-owner and the collab server knows only the document name — so the store resolves id → owner itself by scanning the owner directories, memoized in a `Map` that is only ever a hint (a stale entry costs one failed read and a rescan). Changing a project's organization or creator therefore *moves* its file: `writeProject` writes the new path before removing the old one. `listProjects({ organizationId })` reads only that organization's directory; the other filters still scan. The dashboards do not call it: they use `listProjectSummaries` (`app/lib/project-summaries.ts`), built on `createProjectIndex`, which caches a derived value per file against its mtime and size so an unchanged project costs a `stat` rather than a parse of its schema.

`db/file-store.ts` is the **only** module that touches project files; `db/index.ts` is the only one that opens SQLite — through `better-sqlite3`, pinned to an exact `12.11.1` because 13.x dropped `prebuild-install` and its prebuilt binaries, which turns `pnpm install` into a from-source `node-gyp` build that fails on any host without a C++ toolchain (Windows, most notably). Do not widen that range. `ProjectRecord` keeps the field names of the old `projects` row (`schemaJson`, `revision`, `schemaFormatVersion`, `organizationId`, `createdBy`, `updatedAt`) so readers are unchanged. Projects are still scoped to Better Auth organizations and addressable at `/[workspace]/[projectId]`.

Three things Postgres used to do implicitly and the store now does explicitly — do not remove them:

- **`withProjectLock(id, fn)`** — a lock directory (`fs.mkdir` is an atomic exclusive create, stale after 10s) plus an in-process promise chain. The collab socket bumps the same `revision`, and although it now runs in the same process it loads its own copy of `db/file-store.ts` (through tsx in dev, inside `dist/server.cjs` in production) while the route handlers use Next's bundled copy — two promise chains — so the lock directory is what actually serializes read-modify-write. `PUT`/`PATCH` re-read the record **inside** the lock; comparing against a pre-lock read races.
- **`writeAtomic`** — temp file + `rename`, so a reader never sees half-written JSON.
- **`deleteProject`** — walks to the Yjs blob and the share file itself, replacing `ON DELETE CASCADE`. `ProjectRecord.shareTokenHash` is the back-pointer that replaces `project_share`'s unique foreign key.

`PUT` implements optimistic concurrency: if the stored `revision` differs from the client's it returns **409 `REVISION_CONFLICT`** with the current record, unless `{ overwrite: true }` is passed. The new revision is `max(stored, incoming) + 1`. `SCHEMA_FORMAT_VERSION` (currently `10`) is stamped server-side on every write — bump it in `app/lib/schema.ts` when the JSON shape changes.

`scripts/migrate-from-neon.ts` imports an existing Postgres database into `DATA_DIR` (`DATABASE_URL=… pnpm tsx scripts/migrate-from-neon.ts`, `--force` to re-import). It reads only, so it can be re-run and verified before anything is dropped. `pg` is a devDependency for its sake alone. `scripts/migrate-storage-layout.ts` (`pnpm tsx scripts/migrate-storage-layout.ts`, `--force` to overwrite a taken destination) renames the older flat `projects/<projectId>.json` files into their owner directory; it only touches top-level `*.json`, so re-running it does nothing.

Because storage is a directory, the app needs a **persistent volume** — it cannot run on an ephemeral-filesystem host. In Docker the single `web` service mounts it at `/data`.

### Realtime collaboration

A self-hosted **Hocuspocus** (Yjs) instance in `collab/hocuspocus.ts` is the source of truth for a project's schema; the project file's `schemaJson` is a **mirror** it rewrites on every store, so the REST routes, share pages, project list and DDL export are unchanged. It opens no database — it reads and writes `DATA_DIR` through `db/file-store.ts` only.

It runs **inside the app's process, on the app's port**. Next has no WebSocket route handlers, so `server.ts` is a custom server (through tsx in dev; in production esbuild bundles it and everything it imports into `dist/server.cjs`, packages left external): `createServer(app.getRequestHandler())` plus one `upgrade` listener that sends `/collab` to Hocuspocus (via a `crossws` node adapter, the same wiring Hocuspocus's own `Server` does) and everything else — Next's HMR socket in dev — to Next. The browser derives `ws(s)://<page host>/collab` at runtime, so there is no collab URL or port to configure. Two private Next members are touched on purpose, and both are load-bearing:

- `didWebSocketSetup = true` stops Next attaching its own `upgrade` listener on the first request. That listener runs the router (and `proxy.ts`) on every non-HMR upgrade and `socket.end()`s when a page matches — `/collab` matches `/[workspace]` — which kills collab sockets.
- `upgradeHandler` (the router-level handler) is what we forward to. The public `getUpgradeHandler()` reaches only the inner page server and never answers HMR, so using it silently breaks hot reload.

The server speaks **HTTPS by default** (`server/tls.ts`): plain http is not a secure context, so `crypto.randomUUID` and the clipboard vanish on a LAN address. A `net` front peeks at each connection's first byte — `0x16` is a TLS handshake and goes to the `https` server, anything else gets a 308 to `https://` — so one port serves both. `HTTPS_CERT`/`HTTPS_KEY` supply a certificate; otherwise a self-signed one covering localhost, the host name and every interface IP is kept in `<DATA_DIR>/tls/self-signed.json` and reissued only near expiry or for a new name. `HTTPS=off` restores plain http, for a reverse proxy that terminates TLS.

On SIGINT/SIGTERM the server closes every room and flushes the debounced stores before exiting.

- `app/lib/collab/ydoc.ts` — pure `schemaFromYDoc()` / `applySchemaToYDoc()`. Imported by *both* browser and server, so the projection can never diverge. Tested in `tests/ydoc.test.ts`.
- `app/lib/collab/useCollaborativeSchema.ts` — owns the `Y.Doc` and presents the designer's old surface (`schema`, `commit(next)`, `undo`, `redo`). Undo is per-user via `Y.UndoManager` tracking this client's origin.
- `app/api/collab/token/route.ts` — the **only** place access is decided, via the same session helpers as the REST routes. It signs a 120s token bound to one `documentName`; the collab socket verifies and trusts it. Read-only shares are enforced on the connection.
- Presence (cursors, selection) rides the Yjs awareness channel — no second transport. Cursor coordinates are canvas space, never screen space. It is split by speed (`app/lib/collab/presence.ts`): the roster `peers` (user, colour, `selectedIds`) is React state in `SchemaContext` and only changes when `samePeers` says it did, while positions go to the `cursors` store that only `PeerCursors` subscribes to (`useSyncExternalStore`). Never put a cursor back into `peers` — that re-renders every `useSchema()` consumer once per frame per moving peer.
- A hidden tab does not project remote updates: the Y.Doc still integrates them, and the schema is re-read once on `visibilitychange`. Local-origin transactions always project.

Collab is on by default. With `NEXT_PUBLIC_COLLAB=off` (build time), or while the socket is unreachable, the app degrades to single-player editing and `PUT` is the only durability path — explicit Save/⌘S, or the queue's debounce when auto-save is on.

**While the socket is connected, the file's `revision` is not the client's to predict**: the collab store bumps it on every mirror write. So the two transports never overlap. Connected, auto-save sends no `PUT` at all — `dirty` clears when the `collabSync` store (`app/lib/collab/sync.ts`: connected, handshaken, zero unacknowledged updates) says the server has everything — and an explicit Save sends `overwrite: true` once synced, because what is on screen is already the merge of every peer; that `PUT` exists to cut a history version. After each store the server broadcasts `{ revision }` as a stateless message, which the hook writes to its `revisionRef` only (never into `schema`, which would re-validate the diagram every few seconds); the queue reads it through `getRevision()`, so the `PUT` fallback after a dropped socket starts from the right number. On reconnect the queue is cancelled and a standing conflict toast withdrawn.

Every write goes through `app/lib/save-queue.ts` (`createSaveQueue`, tested in `tests/save-queue.test.ts`). It is the answer to a specific hazard: `PUT` is optimistic, so firing one save per edit means the second request races the first and 409s against *itself*. The queue keeps exactly one write in flight, coalesces everything queued behind it down to the newest snapshot (the schema is a whole document — intermediate states contribute nothing), and feeds each response's revision into the next request. A 409 therefore only ever means a genuine remote edit, and it **stops** the queue and raises the overwrite toast rather than retrying; a transport failure keeps the snapshot but schedules no retry, so the next edit carries it. `save-queue.ts` is pure of React and of `fetch` — the caller supplies `write`. Saving is explicit (Save button / ⌘S) unless the auto-save setting is on; explicit saves toast on success, and the appbar badge is the running status feedback. Renames go out with that same `PUT`, which persists `schemaJson.name` and the record's `name`; the `PATCH` route is still there but has no client caller.

`nextId()` mints UUIDs because ids must be unique across *clients*, not just per session.

`getDb()` creates `auth.db` if it is missing; every route catches storage failures and returns 503/400 rather than crashing. The client-less `PATCH` rename route uses the same optimistic revision scheme as `PUT`.

## Conventions

- Path alias `@/*` maps to the repo root, configured in both `tsconfig.json` and `vitest.config.ts`.
- Application component filenames use kebab-case (`designer.tsx`, `collab-presence.tsx`, and so on), directories too (`editor-canvas/`, `tables-tab/`). Component identifiers remain PascalCase. This is where we depart from drawDB, which uses PascalCase for both — only the directory _shape_ is borrowed. Shadcn components under `components/ui` are already kebab-case and are left as generated.
- UI components come from shadcn with the `aria-vega` style and Base UI / react-aria-components underneath (`components.json`). Icons are `lucide-react`, imported by their `…Icon` names (`TrashIcon`, not `Trash`); a component that takes an icon as a prop types it `LucideIcon` and renders it as `<Icon />`. The stroke is set once, globally, in `globals.css` (`.lucide`), not per icon. Hugeicons was removed; don't reintroduce it.
- Tests live in `tests/` and target the pure domain layer (generators, parser, validation) — not the React tree.
- Code style is dense: single-line arrow functions and chained array methods over intermediate variables. Match it.
- Commit messages: no `Co-Authored-By` trailers.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
