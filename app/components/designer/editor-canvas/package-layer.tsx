"use client";

import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PackageIcon } from "lucide-react";
import { useLayout, useSchema, useTransformControls } from "@/app/hooks";
import {
  PACKAGE_HEADER_HEIGHT,
  PACKAGE_ROW_HEIGHT,
  PACKAGE_WIDTH,
  packageHeight,
  tableHeight,
  tableWidth,
  type CardStyle,
  type SchemaPackage,
  type Table,
} from "@/app/lib/schema";

/** Pointer travel (screen px) below which a press is a click, not a drag. */
const DRAG_SLOP = 4;

type ItemProps = {
  pkg: SchemaPackage;
  tables: Table[];
  livePosition: (table: Table) => { x: number; y: number };
  cardStyle: CardStyle;
  readOnly: boolean;
};

/**
 * One package: its card and the dashed links to the tables it covers. The drag
 * offset is local to the item, so a move re-renders this package and nothing
 * else, and is committed once on release like every other drawable.
 */
function PackageItemComponent({ pkg, tables, livePosition, cardStyle, readOnly }: ItemProps) {
  const { commitWith } = useSchema();
  const { openPackageId, setOpenPackageId, setPanelTab, setSidebarOpen } = useLayout();
  const { zoomRef } = useTransformControls();
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const x = pkg.x + (offset?.x ?? 0);
  const y = pkg.y + (offset?.y ?? 0);
  const height = packageHeight(pkg);
  const covered = new Set(pkg.tableIds);
  const rows = [
    ...(pkg.includeCrud ? tables.filter((table) => covered.has(table.id)).map((table) => ({ key: table.id, label: table.name.toUpperCase(), note: "Ins · Upd · Del" })) : []),
    ...pkg.procedures.map((proc) => ({ key: proc.id, label: proc.name.trim() || "Unnamed", note: proc.kind })),
  ];
  const open = openPackageId === pkg.id;
  const show = () => {
    setOpenPackageId(pkg.id);
    setPanelTab("packages");
    setSidebarOpen(true);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // The canvas would otherwise start a marquee or a pan from this press.
    event.stopPropagation();
    press.current = { x: event.clientX, y: event.clientY, moved: false };
    if (!readOnly) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = press.current;
    if (!start || readOnly) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    start.moved = true;
    const zoom = zoomRef.current || 1;
    setOffset({ x: dx / zoom, y: dy / zoom });
  };
  const onPointerUp = () => {
    const start = press.current;
    press.current = null;
    if (!start?.moved) return show();
    if (!offset) return;
    const { x: dx, y: dy } = offset;
    setOffset(null);
    commitWith((current) => ({
      ...current,
      packages: (current.packages ?? []).map((item) => (item.id === pkg.id ? { ...item, x: Math.max(0, Math.round(item.x + dx)), y: Math.max(0, Math.round(item.y + dy)) } : item)),
    }));
  };

  const cx = x + PACKAGE_WIDTH / 2;
  const cy = y + height / 2;
  return (
    <>
      <svg className="package-links" aria-hidden="true">
        {tables.filter((table) => covered.has(table.id)).map((table) => {
          const at = livePosition(table);
          return <line key={table.id} x1={cx} y1={cy} x2={at.x + tableWidth(table) / 2} y2={at.y + tableHeight(table, cardStyle) / 2} />;
        })}
      </svg>
      <article
        className={`package-card ${open ? "selected" : ""}`}
        data-package-id={pkg.id}
        role="group"
        tabIndex={0}
        aria-label={`Package ${pkg.name || "unnamed"}`}
        style={{ transform: `translate3d(${x}px, ${y}px, 0)`, width: PACKAGE_WIDTH, height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { press.current = null; setOffset(null); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") return show();
          if (readOnly || (event.key !== "Delete" && event.key !== "Backspace")) return;
          event.preventDefault();
          event.stopPropagation();
          commitWith((current) => ({ ...current, packages: (current.packages ?? []).filter((item) => item.id !== pkg.id) }));
        }}
      >
        <header className="package-head" style={{ height: PACKAGE_HEADER_HEIGHT }}>
          <PackageIcon size={14} aria-hidden="true" />
          <span className="package-name">{pkg.name.trim() || "Unnamed package"}</span>
        </header>
        {rows.length ? rows.map((row) => (
          <div className="package-row" key={row.key} style={{ height: PACKAGE_ROW_HEIGHT }}>
            <span className="package-row-label">{row.label}</span>
            <span className="package-row-note">{row.note}</span>
          </div>
        )) : (
          <div className="package-row" style={{ height: PACKAGE_ROW_HEIGHT }}><span className="package-row-note">Empty — open it to add tables</span></div>
        )}
      </article>
    </>
  );
}

const PackageItem = memo(PackageItemComponent);

export function PackageLayer({ packages, tables, livePosition, cardStyle, readOnly }: Omit<ItemProps, "pkg"> & { packages: SchemaPackage[] }) {
  return packages.map((pkg) => <PackageItem key={pkg.id} pkg={pkg} tables={tables} livePosition={livePosition} cardStyle={cardStyle} readOnly={readOnly} />);
}
