"use client";

/**
 * Small presentation pieces lifted out of `Designer`. They are memoized because
 * the designer owns every piece of canvas state and re-renders on each frame of
 * a gesture; without a memo boundary these re-render with it.
 *
 * Nothing here holds state or reads the schema — props in, markup out.
 */

import { useDialect } from "@/app/components/designer/context/dialect-context";
import { typeName } from "@/app/lib/dialect";
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { Focusable } from "react-aria-components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import {
  primaryKeyColumns,
  type Column,
  type KeyStrategy,
  type SchemaGroup,
  type Table,
} from "@/app/lib/schema";
import { typeColorVar } from "@/app/lib/datatype-color";
import { chordParts, shortcutById, type ShortcutId } from "@/app/lib/shortcuts";

export type MenuItem =
  | { label: string; onSelect: () => void; disabled?: boolean; hint?: string }
  | { separator: true };

type MenuAction = Exclude<MenuItem, { separator: true }>;

export const KEY_STRATEGY_LABEL: Record<KeyStrategy, string> = {
  "sequence-trigger": "Sequence + trigger",
  identity: "Generated identity",
  none: "Manual / none",
};

export const Detail = memo(function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
});

/** Summary for the table header, so the whole card need not be read column by column. */
export const TableSummaryCard = memo(function TableSummaryCard({
  table,
  group,
  relationshipCount,
}: {
  table: Table;
  group?: SchemaGroup;
  relationshipCount: number;
}) {
  const pk = primaryKeyColumns(table);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <strong className="min-w-0 truncate">{table.name.toUpperCase()}</strong>
        <span className="shrink-0 text-xs text-muted-foreground">
          {table.columns.length} columns
        </span>
      </div>
      <Separator />
      <div className="flex flex-col gap-1 text-xs">
        <Detail
          label="Primary key"
          value={
            pk.length
              ? pk.map((column) => column.name.toUpperCase()).join(", ")
              : "None"
          }
        />
        <Detail label="Keys" value={KEY_STRATEGY_LABEL[table.keyStrategy]} />
        <Detail label="Schema group" value={group?.name ?? "Ungrouped"} />
        <Detail label="Relationships" value={String(relationshipCount)} />
        {table.comment?.trim() && (
          <Detail label="Comment" value={table.comment} />
        )}
      </div>
    </div>
  );
});

/** The hover card mirrors what the side panel shows, without a round trip. */
export const ColumnCard = memo(function ColumnCard({
  table,
  column,
  reference,
}: {
  table: Table;
  column: Column;
  reference?: { table: Table; column: Column };
}) {
  const dialect = useDialect();
  const inUniqueGroup = (table.uniques ?? []).some((constraint) => constraint.columnIds.includes(column.id));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <strong className="min-w-0 truncate">
          {column.name.toUpperCase()}
        </strong>
        <span
          className="shrink-0 font-mono text-xs"
          style={{ color: typeColorVar(column.type) }}
        >
          {typeName(column, dialect)}
        </span>
      </div>
      {(column.pk || column.unique || column.notNull || column.fk || inUniqueGroup) && (
        <div className="flex flex-wrap gap-1">
          {column.pk && <Badge variant="secondary">Primary key</Badge>}
          {column.fk && <Badge variant="secondary">Foreign key</Badge>}
          {column.unique && <Badge variant="secondary">Unique</Badge>}
          {inUniqueGroup && <Badge variant="secondary">Unique group</Badge>}
          {column.notNull && <Badge variant="secondary">Not null</Badge>}
        </div>
      )}
      <Separator />
      <div className="flex flex-col gap-1 text-xs">
        <Detail label="Table" value={table.name.toUpperCase()} />
        {reference && (
          <Detail
            label="References"
            value={`${reference.table.name.toUpperCase()}(${reference.column.name.toUpperCase()})`}
          />
        )}
        {column.defaultValue.trim() && (
          <Detail label="Default" value={column.defaultValue} />
        )}
        {column.check.trim() && <Detail label="Check" value={column.check} />}
        {column.comment?.trim() && (
          <Detail label="Comment" value={column.comment} />
        )}
      </div>
    </div>
  );
});

/**
 * Dock controls are icon-only, so each one carries its name as a tooltip — a
 * name, not a sentence. The chord rides along as keycaps from the one shortcut
 * table, which is both shorter to read and impossible to let drift from the key
 * that actually fires.
 *
 * The label is also the accessible name, so it must never carry state: a toggle
 * says so through `aria-pressed`, and spelling it into the name as well makes a
 * screen reader announce the state twice.
 */
export const DockButton = memo(function DockButton({
  label,
  icon,
  shortcut,
  isMac,
  isActive,
  isDisabled,
  disabledReason,
  onClick,
  children,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  shortcut?: ShortcutId;
  isMac?: boolean;
  /** Toggles rather than commands: renders pressed and announces its state. */
  isActive?: boolean;
  isDisabled?: boolean;
  /** What the control is waiting for. Replaces the chord while disabled. */
  disabledReason?: string;
  onClick: () => void;
  /** Drawn in place of the icon -- the zoom readout is a button showing a number. */
  children?: ReactNode;
  className?: string;
}) {
  const Icon = icon;
  const content = children ?? (Icon && <Icon />);
  const tooltip = (
    <Tooltip>
      {label}
      {isDisabled
        ? disabledReason && (
            <span className="dock-tip-reason">{disabledReason}</span>
          )
        : shortcut && <ShortcutKeys id={shortcut} isMac={!!isMac} />}
    </Tooltip>
  );
  /*
   * A `disabled` button receives no pointer events, so its tooltip can never
   * open and the greyed control cannot say what it is waiting for. Soft-disable
   * instead: `aria-disabled` on a focusable wrapper keeps it hoverable and
   * tabbable — and therefore able to explain itself — while staying unpressable.
   */
  if (isDisabled)
    return (
      <TooltipTrigger>
        <Focusable>
          <span
            role="button"
            aria-disabled="true"
            aria-label={label}
            className={buttonVariants({
              variant: "ghost",
              size: "icon",
              className: `dock-disabled ${className ?? ""}`,
            })}
          >
            {content}
          </span>
        </Focusable>
        {tooltip}
      </TooltipTrigger>
    );
  return (
    <TooltipTrigger>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={isActive}
        className={className}
        onClick={onClick}
      >
        {content}
      </Button>
      {tooltip}
    </TooltipTrigger>
  );
});

/** A chord as keycaps, one per token. Shared by the menus and the shortcuts sheet. */
export const ShortcutKeys = memo(function ShortcutKeys({
  id,
  isMac,
}: {
  id: ShortcutId;
  isMac: boolean;
}) {
  const chord = shortcutById(id)?.chords[0];
  if (!chord) return null;
  return (
    <KbdGroup>
      {chordParts(chord, isMac).map((part) => (
        <Kbd key={part}>{part}</Kbd>
      ))}
    </KbdGroup>
  );
});

/** Separators delimit groups rather than being items, which is what MenuSection expects. */
const groupBySeparator = (items: MenuItem[]) =>
  items
    .reduce<MenuAction[][]>(
      (groups, item) => {
        if ("separator" in item) groups.push([]);
        else groups[groups.length - 1].push(item);
        return groups;
      },
      [[]],
    )
    .filter((group) => group.length > 0);

/** A menubar menu. Opens on click, closes on select, Escape, or outside press. */
/**
 * The row of menus. react-aria-components ships no Menubar and shadcn's is
 * Radix-only, so the pattern is assembled here rather than dragging a second
 * menu stack in beside the React Aria dropdowns this app already uses.
 *
 * Typed as a toolbar rather than a menubar: `role="menubar"` obliges its
 * children to be `menuitem`, and React Aria's Button does not accept a `role`.
 * A toolbar of menu buttons is the honest description — each trigger already
 * carries aria-haspopup/aria-expanded from MenuTrigger — and it expects exactly
 * the keyboard this implements: one tab stop for the whole bar via a roving
 * tabindex, arrows to move along it.
 *
 * One handler covers both open and closed because React events propagate along
 * the React tree, not the DOM one — so keys pressed inside a portalled popover
 * still arrive here.
 */
export function Menubar({
  label,
  count,
  isOpen,
  onStepOpen,
  children,
}: {
  label: string;
  count: number;
  /** Arrows walk between menus when one is open, and between triggers when not. */
  isOpen: boolean;
  onStepOpen: (direction: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const focusItem = useCallback(
    (index: number) => {
      const wrapped = (index + count) % count;
      setActive(wrapped);
      ref.current
        ?.querySelectorAll<HTMLElement>("[data-menubar-item]")
        [wrapped]?.focus();
    },
    [count],
  );
  return (
    <MenubarContext.Provider value={{ active, setActive }}>
      <div
        ref={ref}
        className="menubar -mx-2"
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={label}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          /* Up/down belong to the open menu's own items; only the horizontal
             axis is the bar's to claim. */
          if (step) isOpen ? onStepOpen(step) : focusItem(active + step);
          else if (!isOpen && event.key === "Home") focusItem(0);
          else if (!isOpen && event.key === "End") focusItem(count - 1);
          else return;
          event.preventDefault();
        }}
      >
        {children}
      </div>
    </MenubarContext.Provider>
  );
}

const MenubarContext = createContext<{
  active: number;
  setActive: (index: number) => void;
} | null>(null);

export const Menu = memo(function Menu({
  name,
  index,
  items,
  open,
  anyOpen,
  onOpenChange,
}: {
  name: string;
  /** Position in the bar, for the roving tabindex. */
  index: number;
  items: MenuItem[];
  open: boolean;
  /** Once one menu is open, hovering the others switches between them. */
  anyOpen: boolean;
  onOpenChange: (name: string | null) => void;
}) {
  const menubar = useContext(MenubarContext);
  return (
    <DropdownMenuTrigger
      isOpen={open}
      onOpenChange={(next) => onOpenChange(next ? name : null)}
    >
      <Button
        variant="ghost"
        size="sm"
        data-menubar-item=""
        /* React Aria owns the tab index, so the roving one is expressed its
           way: every trigger but the active one steps out of the tab order. */
        excludeFromTabOrder={menubar ? menubar.active !== index : false}
        onFocus={() => menubar?.setActive(index)}
        onPointerEnter={() => anyOpen && onOpenChange(name)}
      >
        {name}
      </Button>
      <DropdownMenu className="w-auto min-w-52">
        {groupBySeparator(items).map((group, index) => (
          <Fragment key={group[0].label}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {group.map((item) => (
                <DropdownMenuItem
                  key={item.label}
                  isDisabled={item.disabled}
                  onAction={() => void item.onSelect()}
                >
                  {item.label}
                  {item.hint && (
                    <DropdownMenuShortcut>{item.hint}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
});
