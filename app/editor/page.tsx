import { redirect } from "next/navigation";
import { createProject } from "@/db/file-store";
import { makeEmptySchema, SCHEMA_FORMAT_VERSION } from "@/app/lib/schema";
import { requireSession } from "@/app/lib/session";

export default async function NewEditorPage({ searchParams }: { searchParams: Promise<{ dialect?: string }> }) {
  const { dialect } = await searchParams;
  const session = await requireSession();
  const starter = makeEmptySchema("Untitled Diagram", crypto.randomUUID(), dialect === "postgres" ? "postgres" : "oracle");
  await createProject({ id: starter.id, name: starter.name, organizationId: null, createdBy: session.user.id, schemaJson: starter, revision: 1, schemaFormatVersion: SCHEMA_FORMAT_VERSION });
  redirect(`/project/${starter.id}`);
}
