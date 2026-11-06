import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import crossws from "crossws/adapters/node";
import { readProject, readYDoc, updateProject, withProjectLock, writeYDoc } from "@/db/file-store";
import { projectIdFrom, verifyCollabToken } from "@/app/lib/collab/token";
import { migrateLegacyDocumentation, schemaFromYDoc } from "@/app/lib/collab/ydoc";
import { SCHEMA_FORMAT_VERSION, type Schema } from "@/app/lib/schema";

/** Same-origin path the browser connects to; see `collabUrl()` in `useCollaborativeSchema`. */
export const COLLAB_PATH = "/collab";

type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => unknown;

export function createCollab(secret: string) {
  return new Hocuspocus({
    // Store on a trailing edge so a burst of edits is one write, but never let a
    // busy room go more than 20s without being durable. Each store re-projects
    // the whole document and rewrites two files, so with several rooms active
    // on one host this is the server's main recurring cost; shutdown flushes
    // whatever is pending, and Save/⌘S still writes through `PUT`.
    debounce: 4000,
    maxDebounce: 20000,
    quiet: true,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const claims = verifyCollabToken(token, secret);
      if (!claims || claims.documentName !== documentName) throw new Error("Not authorized for this project");
      // Enforced here, not in the client: a read-only share must stay read-only
      // even against a patched browser.
      connectionConfig.readOnly = claims.readOnly;
      return { userId: claims.sub, name: claims.name, image: claims.image, readOnly: claims.readOnly };
    },

    // Before any client has the room: see `migrateLegacyDocumentation`.
    async afterLoadDocument({ document }) {
      migrateLegacyDocumentation(document);
    },

    extensions: [
      new Database({
        fetch: async ({ documentName }) => readYDoc(projectIdFrom(documentName)),

        store: async ({ documentName, state, document }) => {
          const projectId = projectIdFrom(documentName);
          await writeYDoc(projectId, state);

          // Mirror the document back into the project's `schemaJson` so the REST
          // routes, share pages, project list and DDL export keep reading what they
          // always did. The route handlers run from Next's bundle — a second copy of
          // file-store with its own in-process chain — so the lock directory is what
          // serializes this read-modify-write of `revision` against their PUT.
          const schema = schemaFromYDoc(document, { id: projectId });
          const revision = await withProjectLock(projectId, async () => {
            const stored = await readProject(projectId);
            if (!stored) return null;
            const mirrored: Schema = { ...schema, revision: stored.revision + 1, schemaFormatVersion: SCHEMA_FORMAT_VERSION };
            await updateProject(projectId, { name: mirrored.name, schemaJson: mirrored, revision: mirrored.revision, schemaFormatVersion: SCHEMA_FORMAT_VERSION });
            return mirrored.revision;
          });
          // That bump is ours, not a peer's edit. Tell the room, or the next `PUT`
          // from any of them would arrive a revision behind and 409 against it.
          if (revision !== null) document.broadcastStateless(JSON.stringify({ revision }));
        },
      }),
    ],
  });
}

/**
 * Serves `hocuspocus` on `COLLAB_PATH` of an existing HTTP server and hands every
 * other upgrade (Next's HMR socket, in dev) to `fallback`. This is the wiring
 * Hocuspocus's own `Server` does around its private `crossws`, minus the port.
 */
export function attachCollab(server: HttpServer | HttpsServer, hocuspocus: Hocuspocus, fallback: UpgradeHandler) {
  const connections = new WeakMap<object, ReturnType<Hocuspocus["handleConnection"]>>();
  const ws = crossws({
    hooks: {
      open: (peer) => void connections.set(peer, hocuspocus.handleConnection(peer.websocket as WebSocket, peer.request)),
      message: (peer, message) => connections.get(peer)?.handleMessage(message.uint8Array()),
      close: (peer, event) => connections.get(peer)?.handleClose({ code: event.code ?? 1000, reason: event.reason ?? "" }),
      error: (peer, error) => console.error(`collab: socket error for peer ${peer.id}`, error),
    },
  });

  server.on("upgrade", (req, socket, head) =>
    new URL(req.url ?? "/", "http://localhost").pathname === COLLAB_PATH ? ws.handleUpgrade(req, socket, head) : fallback(req, socket, head),
  );

  /** Closes every room and waits for the pending debounced stores to land, as `Server.destroy()` does. */
  return () =>
    new Promise<void>((resolve) => {
      if (hocuspocus.getDocumentsCount() === 0) return resolve();
      hocuspocus.configuration.extensions.push({ afterUnloadDocument: async () => void (hocuspocus.getDocumentsCount() === 0 && resolve()) });
      hocuspocus.closeConnections();
      hocuspocus.flushPendingStores();
    });
}
