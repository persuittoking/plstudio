"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { ChevronLeftIcon, CodeXmlIcon, DatabaseIcon, LayoutGridIcon, LinkIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLayout, useSchema } from "@/app/hooks";
import type { PanelMode, PanelTab } from "../constants";
import { Issues } from "./issues";

// The panel opens on the tables tab; the code view and the query workbench load when first shown.
const CodeView = dynamic(() => import("./code-view").then((module) => module.CodeView), { ssr: false });
const QueriesTab = dynamic(() => import("./queries-tab/queries-tab").then((module) => module.QueriesTab), { ssr: false });

export type SidePanelProps = {
  /** Count shown on the relationships tab and in the footer. */
  relationshipCount: number;
  tablesTab: ReactNode;
  relationshipsTab: ReactNode;
  readOnly: boolean;
};

/**
 * The panel shell: the resize grip, the tab strip, and the footer that switches
 * between the structure tabs and the generated code. Which body is showing is
 * decided here, the way drawdb's SidePanel.jsx builds its tab array.
 */
export function SidePanel({
  relationshipCount,
  tablesTab,
  relationshipsTab,
  readOnly,
}: SidePanelProps) {
  const { schema } = useSchema();
  const {
    isResizingSidebar,
    onSidebarResizeStart,
    resetSidebarWidth,
    panelTab,
    setPanelTab,
    panelMode,
    setPanelMode,
  } = useLayout();

  return (
    /* The sidebar sits below the app bar, not against the viewport top. */
    <Sidebar
      className="top-(--appbar-height) h-[calc(100svh-var(--appbar-height))]"
      aria-label="Diagram structure"
    >
      <div
        className={`sidebar-resizer ${isResizingSidebar ? "resizing" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar width"
        title="Drag to resize sidebar · Double-click to reset width"
        onPointerDown={onSidebarResizeStart}
        onDoubleClick={resetSidebarWidth}
      >
        <div className="sidebar-resizer-line" aria-hidden="true" />
      </div>
      <SidebarHeader className="panel-tabs">
        <SidebarTrigger aria-label="Hide side panel">
          <ChevronLeftIcon/>
        </SidebarTrigger>
        <Tabs
          selectedKey={panelTab}
          onSelectionChange={(key) => setPanelTab(key as PanelTab)}
        >
          {/* A segmented control: three views of one diagram. Counts ride
              along in the secondary label colour rather than in brackets. */}
          <TabsList className="panel-segments">
            <TabsTrigger id="tables">
              Tables <span className="panel-segment-count">{schema.tables.length}</span>
            </TabsTrigger>
            <TabsTrigger id="relationships">
              Relationships <span className="panel-segment-count">{relationshipCount}</span>
            </TabsTrigger>
            <TabsTrigger id="queries">
              Queries <span className="panel-segment-count">{(schema.queries ?? []).length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </SidebarHeader>

      <SidebarContent>
        {panelMode === "code" ? (
          <CodeView />
        ) : panelTab === "tables" ? (
          tablesTab
        ) : panelTab === "queries" ? (
          <QueriesTab readOnly={readOnly} />
        ) : (
          relationshipsTab
        )}
      </SidebarContent>

      <SidebarFooter className="p-0">
        <div className="panel-footer">
          <span className="counter">
            <DatabaseIcon aria-hidden="true" />
            {schema.tables.length}
            <span className="sr-only">tables</span>
          </span>
          <span className="counter">
            <LinkIcon aria-hidden="true" />
            {relationshipCount}
            <span className="sr-only">relationships</span>
          </span>
          <ToggleGroup
            aria-label="Panel view"
            className="segmented"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[panelMode]}
            onSelectionChange={(keys) => {
              const [key] = [...keys];
              if (key) setPanelMode(key as PanelMode);
            }}
          >
            <ToggleGroupItem id="structure">
              <LayoutGridIcon data-icon="inline-start" />
              Structure
            </ToggleGroupItem>
            <ToggleGroupItem id="code">
              <CodeXmlIcon data-icon="inline-start" />
              Code
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Issues readOnly={readOnly} />
      </SidebarFooter>
    </Sidebar>
  );
}
