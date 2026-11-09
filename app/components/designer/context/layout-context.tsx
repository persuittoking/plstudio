"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { PanelMode, PanelTab } from "../constants";

/** The side panel refuses to become uselessly narrow or to swallow the canvas. */
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 417;
const SIDEBAR_WIDTH_KEY = "drawsql_sidebar_width";

export type DesignerModal = "export" | "import" | "share" | "shortcuts" | "history" | "bulk-columns" | "palette" | null;

export type LayoutContextValue = {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarWidth: number;
  isResizingSidebar: boolean;
  onSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Double-clicking the resizer returns the panel to its shipped width. */
  resetSidebarWidth: () => void;
  panelTab: PanelTab;
  setPanelTab: React.Dispatch<React.SetStateAction<PanelTab>>;
  panelMode: PanelMode;
  setPanelMode: React.Dispatch<React.SetStateAction<PanelMode>>;
  modal: DesignerModal;
  setModal: React.Dispatch<React.SetStateAction<DesignerModal>>;
  openMenu: string | null;
  setOpenMenu: React.Dispatch<React.SetStateAction<string | null>>;
  userMenuOpen: boolean;
  setUserMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  issuesOpen: boolean;
  setIssuesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tableQuery: string;
  setTableQuery: React.Dispatch<React.SetStateAction<string>>;
  relationshipQuery: string;
  setRelationshipQuery: React.Dispatch<React.SetStateAction<string>>;
  openRelationshipId: string | null;
  /** The package expanded in the Packages tab; a canvas card sets it. */
  openPackageId: string | null;
  setOpenPackageId: React.Dispatch<React.SetStateAction<string | null>>;
  setOpenRelationshipId: React.Dispatch<React.SetStateAction<string | null>>;
  collapsedGroupIds: Set<string>;
  setCollapsedGroupIds: React.Dispatch<React.SetStateAction<Set<string>>>;
};

export const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarResizingRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const [panelTab, setPanelTab] = useState<PanelTab>("tables");
  const [panelMode, setPanelMode] = useState<PanelMode>("structure");
  const [modal, setModal] = useState<DesignerModal>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [tableQuery, setTableQuery] = useState("");
  const [relationshipQuery, setRelationshipQuery] = useState("");
  const [openPackageId, setOpenPackageId] = useState<string | null>(null);
  const [openRelationshipId, setOpenRelationshipId] = useState<string | null>(
    null,
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (
          !isNaN(parsed) &&
          parsed >= MIN_SIDEBAR_WIDTH &&
          parsed <= MAX_SIDEBAR_WIDTH
        ) {
          setSidebarWidth(parsed);
        }
      }
    } catch {}
  }, []);

  const updateSidebarWidth = useCallback((width: number) => {
    const clamped = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, width),
    );
    setSidebarWidth(clamped);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, clamped.toString());
    } catch {}
  }, []);

  const resetSidebarWidth = useCallback(
    () => updateSidebarWidth(DEFAULT_SIDEBAR_WIDTH),
    [updateSidebarWidth],
  );

  const onSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      sidebarResizingRef.current = {
        startX: event.clientX,
        startWidth: sidebarWidth,
      };
      setIsResizingSidebar(true);
    },
    [sidebarWidth],
  );

  useEffect(() => {
    if (!isResizingSidebar) return;
    const move = (event: PointerEvent) => {
      const ref = sidebarResizingRef.current;
      if (!ref) return;
      const deltaX = event.clientX - ref.startX;
      updateSidebarWidth(ref.startWidth + deltaX);
    };
    const release = () => {
      if (sidebarResizingRef.current) {
        sidebarResizingRef.current = null;
        setIsResizingSidebar(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [isResizingSidebar, updateSidebarWidth]);

  const value = useMemo(
    () => ({
      sidebarOpen,
      setSidebarOpen,
      sidebarWidth,
      isResizingSidebar,
      onSidebarResizeStart,
      resetSidebarWidth,
      panelTab,
      setPanelTab,
      panelMode,
      setPanelMode,
      modal,
      setModal,
      openMenu,
      setOpenMenu,
      userMenuOpen,
      setUserMenuOpen,
      issuesOpen,
      setIssuesOpen,
      tableQuery,
      setTableQuery,
      relationshipQuery,
      setRelationshipQuery,
      openRelationshipId,
      setOpenRelationshipId,
      openPackageId,
      setOpenPackageId,
      collapsedGroupIds,
      setCollapsedGroupIds,
    }),
    [
      sidebarOpen,
      sidebarWidth,
      isResizingSidebar,
      onSidebarResizeStart,
      resetSidebarWidth,
      panelTab,
      panelMode,
      modal,
      openMenu,
      userMenuOpen,
      issuesOpen,
      tableQuery,
      relationshipQuery,
      openRelationshipId,
      openPackageId,
      collapsedGroupIds,
    ],
  );
  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
}
