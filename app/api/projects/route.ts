import { createProject, listProjects } from "@/db/file-store";
import { makeEmptySchema, SCHEMA_FORMAT_VERSION } from "@/app/lib/schema";
import { requireSession, requireWorkspace } from "@/app/lib/session";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const workspace = new URL(request.url).searchParams.get("workspace"); if (!workspace) return Response.json({ error: "workspace is required" }, { status: 400 }); const { organization } = await requireWorkspace(workspace); return Response.json(await listProjects({ organizationId: organization.id })); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Project storage unavailable" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try { const input = (await request.json()) as { workspace?: string; name?: string; dialect?: string }; if (!input.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 }); const workspaceAccess = input.workspace ? await requireWorkspace(input.workspace) : null; const session = workspaceAccess?.session ?? await requireSession(); const starter = makeEmptySchema(input.name.trim(), crypto.randomUUID(), input.dialect === "postgres" ? "postgres" : "oracle"); await createProject({ id: starter.id, name: starter.name, organizationId: workspaceAccess?.organization.id ?? null, createdBy: session.user.id, schemaJson: starter, revision: 1, schemaFormatVersion: SCHEMA_FORMAT_VERSION }); return Response.json(starter, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not create project" }, { status: 400 }); }
}
