import Link from "next/link";
import { auth } from "@/app/lib/auth";
import { listProjectSummaries } from "@/app/lib/project-summaries";
import { listUserWorkspaces } from "@/app/lib/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import PendingInvitations from "@/app/components/pending-invitations";
import ProjectCard from "@/app/components/project-card";
import NewProjectButton from "@/app/components/new-project-button";
import SchemaPreview from "@/app/components/schema-preview";
import WorkspaceTopbar from "@/app/components/workspace-topbar";
import { formatRelative, formatTimestamp } from "@/app/lib/format";
import { Identicon } from "@/app/components/identicon";
import { buttonVariants } from "@/components/ui/button-variants";
import { ChevronRightIcon, LayoutDashboardIcon, PlusIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const [workspaces, personalProjects] = await Promise.all([
    listUserWorkspaces(session.user.id),
    listProjectSummaries({ createdBy: session.user.id, personalOnly: true }),
  ]);
  return (
    <main className="dashboard-shell">
      <WorkspaceTopbar
        workspaces={workspaces}
        current={null}
        links={[
          { href: "/", label: "Personal projects", current: true },
        ]}
        user={{ name: session.user.name, email: session.user.email, image: session.user.image }}
      />
      <header className="dashboard-header">
        <div>
          {/* No eyebrow here: the switcher in the bar already says which space
              this is, and repeating it makes the label read as decoration. */}
          <h1>Projects</h1>
          <p className="dashboard-subtitle">
            {personalProjects.length} {personalProjects.length === 1 ? "diagram" : "diagrams"}
            {workspaces.length > 0 && <> · {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}</>}
          </p>
        </div>
        <div className="dashboard-actions">
          <NewProjectButton><PlusIcon data-icon="inline-start" />New Diagram</NewProjectButton>
          <Link data-slot="button" className={buttonVariants({ variant: "outline" })} href="/onboarding">New Workspace</Link>
        </div>
      </header>
      <PendingInvitations />
      {workspaces.length > 0 && (
        <section className="dashboard-section">
          <h2 className="dashboard-section-title">Workspaces</h2>
          {/* An inset grouped list, the System Settings pattern: rows that
              navigate end in a disclosure chevron. */}
          <ul className="grouped-list">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link href={`/${workspace.slug}`} className="grouped-row">
                  <Identicon seed={workspace.id} className="grouped-row-icon" />
                  <span className="grouped-row-title">{workspace.name}</span>
                  <span className="grouped-row-detail">{workspace.role}</span>
                  <ChevronRightIcon className="grouped-row-chevron" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {personalProjects.length ? (
        <section className="dashboard-section">
          {/* The h1 covers everything on the page, workspaces included, so the
              grid gets its own name rather than sitting unlabelled under theirs. */}
          <h2 className="dashboard-section-title">
            Personal diagrams <span className="dashboard-section-count">{personalProjects.length}</span>
          </h2>
          <div className="project-grid">
            {personalProjects.map((project) => {
              /* No author here: every project in the personal space is yours, so
                 the name would be the same string on every card. */
              return <ProjectCard key={project.id} projectId={project.id} href={`/project/${project.id}`} name={project.name} tableCount={project.tables} updatedAt={formatTimestamp(project.updatedAt)} updatedLabel={formatRelative(project.updatedAt)} preview={<SchemaPreview preview={project.preview} />} />;
            })}
          </div>
        </section>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><LayoutDashboardIcon /></EmptyMedia>
            <EmptyTitle>Draw your first diagram</EmptyTitle>
            <EmptyDescription>
              Start modeling tables and relationships without creating a workspace.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewProjectButton>Open a blank editor</NewProjectButton>
          </EmptyContent>
        </Empty>
      )}
    </main>
  );
}
