"use client";

import { SearchIcon, ShareIcon } from "lucide-react";
import BrandMark from "@/app/components/brand-mark";
import { PeerAvatars } from "@/app/components/collab-presence";
import NavUser from "@/app/components/nav-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CollabUser } from "@/app/lib/collab/useCollaborativeSchema";
import { selfAlias } from "@/app/lib/collab/presence";
import { useLayout, useSaveState, useSchema } from "@/app/hooks";
import { Menu, Menubar, type MenuItem } from "../primitives";

export type ControlPanelProps = {
  /**
   * The menu tree still belongs to `Workspace`: its entries close over the
   * commands (import, export, auto-layout, …) that live there. The header only
   * renders what it is handed.
   */
  menus: { name: string; items: MenuItem[] }[];
  save: () => Promise<void> | void;
  workspaceSlug?: string;
  readOnly: boolean;
  user?: (CollabUser & { email?: string | null }) | null;
};

export function ControlPanel({
  menus,
  save,
  workspaceSlug,
  readOnly,
  user,
}: ControlPanelProps) {
  const { schema, commitWith, peers, self, collabStatus } = useSchema();
  const { openMenu, setOpenMenu, setModal, userMenuOpen, setUserMenuOpen } =
    useLayout();
  const { saveState, dirty } = useSaveState();

  return (
    <header className="appbar items-center">
      <a className="appbar-brand" aria-label="PLStudio home" href="/">
        <BrandMark compact />
      </a>
      {/* One row, the macOS unified toolbar: the document's identity, then
          its menus, then its state and sharing at the trailing edge. */}
      <div className="appbar-title">
          <a
            className="appbar-crumb"
            href={workspaceSlug ? `/${workspaceSlug}` : "/"}
          >
            {workspaceSlug ? "Diagrams" : "My diagrams"}
          </a>
          <span className="appbar-slash">/</span>
          <Input
            className="appbar-name"
            aria-label="Diagram name"
            value={schema.name}
            onChange={(event) => {
              if (readOnly) return;
              commitWith((current) => ({
                ...current,
                name: event.target.value,
              }));
            }}
          />
          {/* Which database the diagram is for; switched from the File menu. */}
          <span
            className="ml-1 shrink-0 rounded-md bg-(--fill-4) px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            title="The database this diagram is designed for. Switch it from the File menu."
          >
            {schema.dialect === "postgres" ? "PostgreSQL" : "Oracle"}
          </span>
      </div>
      <span className="appbar-divider" aria-hidden="true" />
      <Menubar
          label="Diagram menus"
          count={menus.length}
          isOpen={openMenu !== null}
          onStepOpen={(direction) => {
            const current = menus.findIndex((menu) => menu.name === openMenu);
            setOpenMenu(
              menus[(current + direction + menus.length) % menus.length].name,
            );
          }}
        >
          {menus.map((menu, index) => (
            <Menu
              key={menu.name}
              name={menu.name}
              index={index}
              items={menu.items}
              open={openMenu === menu.name}
              anyOpen={openMenu !== null}
              onOpenChange={setOpenMenu}
            />
          ))}
      </Menubar>
      <div className="appbar-actions">
        {/*
         * Feedback for save state: displays whether changes are saved,
         * unsaved, saving, or encountered a conflict/error. Clicking when
         * dirty saves the project.
         */}
        <Badge
          variant={
            saveState === "conflict" || saveState === "failed"
              ? "destructive"
              : dirty
                ? "secondary"
                : "ghost"
          }
          className={dirty && !readOnly ? "cursor-pointer select-none" : ""}
          onClick={dirty && !readOnly ? () => void save() : undefined}
          title={dirty && !readOnly ? "Click to save changes (⌘S)" : undefined}
        >
          {saveState === "saving"
            ? "Saving…"
            : saveState === "conflict"
              ? "Conflict"
              : saveState === "failed"
                ? "Not saved"
                : dirty
                  ? "Unsaved changes"
                  : "Saved"}
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Search commands, tables and columns"
          onClick={() => setModal("palette")}
        >
          <SearchIcon />
        </Button>
        <PeerAvatars peers={peers} self={self} status={collabStatus} />
        <Button size="sm" className="share-btn" onClick={() => setModal("share")}>
          <ShareIcon data-icon="inline-start" /> Share
        </Button>
        <NavUser
          user={user}
          alias={selfAlias(self, peers)}
          isOpen={userMenuOpen}
          onOpenChange={setUserMenuOpen}
        />
      </div>
    </header>
  );
}
