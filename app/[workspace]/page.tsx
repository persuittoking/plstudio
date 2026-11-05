import Link from "next/link";
import { LayoutDashboardIcon } from "lucide-react";
import { listProjectSummaries } from "@/app/lib/project-summaries";
import { listUserWorkspaces, lookupUserNames, requireWorkspace } from "@/app/lib/session";
import NewProjectButton from "@/app/components/new-project-button";
import ProjectCard from "@/app/components/project-card";
import SchemaPreview from "@/app/components/schema-preview";
import WorkspaceTopbar from "@/app/components/workspace-topbar";
import { formatRelative, formatTimestamp } from "@/app/lib/format";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function WorkspacePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { organization, session } = await requireWorkspace(workspace);
  const [rows, workspaces] = await Promise.all([listProjectSummaries({ organizationId: organization.id }), listUserWorkspaces(session.user.id)]);
  // A workspace's projects come from several members, so the authors are looked up in one batch.
  const authors = await lookupUserNames(rows.map((project) => project.createdBy ?? ""));
  return (
    <main className="dashboard-shell">
      <WorkspaceTopbar
        workspaces={workspaces}
        current={workspace}
        links={[
          { href: `/${workspace}`, label: "Projects", current: true },
          { href: `/${workspace}/settings`, label: "Settings" },
        ]}
        user={{ name: session.user.name, email: session.user.email, image: session.user.image }}
      />
      <header className="dashboard-header">
        <div>
          <h1>{organization.name}</h1>
          <p className="dashboard-subtitle">{rows.length} {rows.length === 1 ? "diagram" : "diagrams"}</p>
        </div>
        <div className="dashboard-actions">
          <NewProjectButton variant="outline">Personal Diagram</NewProjectButton>
          <NewProjectButton workspace={workspace} />
        </div>
      </header>
      {rows.length ? (
        <section className="dashboard-section project-grid">
          {rows.map((project) => {
            return <ProjectCard key={project.id} projectId={project.id} href={`/${workspace}/${project.id}`} name={project.name} tableCount={project.tables} updatedAt={formatTimestamp(project.updatedAt)} updatedLabel={formatRelative(project.updatedAt)} author={project.createdBy ? authors.get(project.createdBy) : undefined} workspace={workspace} preview={<SchemaPreview preview={project.preview} />} />;
          })}
        </section>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><LayoutDashboardIcon /></EmptyMedia>
            <EmptyTitle>Create your first diagram</EmptyTitle>
            <EmptyDescription>
              Draw tables on the canvas and PLStudio writes the Oracle DDL for you.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewProjectButton workspace={workspace} />
          </EmptyContent>
        </Empty>
      )}
    </main>
  );
}
