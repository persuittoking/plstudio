"use client";

/**
 * A list of named column sets on one table -- the shape unique constraints and
 * indexes share.
 *
 * A set is made of the table's own columns, so it is edited as chips plus an
 * "add a column" menu rather than as free text: a name that does not match a
 * column is not a thing the user can express here, and the schema never holds
 * an id nothing answers to.
 */

import { useDialect } from "@/app/components/designer/context/dialect-context";
import { typeName } from "@/app/lib/dialect";
import { memo } from "react";
import { Button as AriaButton } from "react-aria-components";
import { CircleXIcon, PlusIcon, Trash2Icon, type LucideIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { type Table, type TableIndex, type UniqueConstraint } from "@/app/lib/schema";

type ColumnSet = UniqueConstraint | TableIndex;

export type ColumnSetsProps = {
  table: Table;
  readOnly: boolean;
  sets: ColumnSet[];
  /** "Unique constraint", "Index" -- numbered for a set with no name. */
  noun: string;
  legend: string;
  icon: LucideIcon;
  /** The name the generator mints for the set at `index`. */
  placeholder: (index: number) => string;
  /** A note under a set, or `null`. */
  hint?: (set: ColumnSet) => string | null;
  onAdd: (tableId: string) => void;
  onPatch: (tableId: string, setId: string, patch: Partial<ColumnSet>) => void;
  onDelete: (tableId: string, setId: string) => void;
};

export const ColumnSets = memo(function ColumnSets({
  table,
  readOnly,
  sets,
  noun,
  legend,
  icon,
  placeholder,
  hint,
  onAdd,
  onPatch,
  onDelete,
}: ColumnSetsProps) {
  const dialect = useDialect();
  const Icon = icon;
  const columnName = (columnId: string) => table.columns.find((column) => column.id === columnId)?.name.toUpperCase() ?? columnId;
  if (readOnly && !sets.length) return null;
  return (
    <section className="inset-section" aria-label={legend}>
      <h3 className="inset-group-header">
        {legend}
        {Boolean(sets.length) && <span className="inset-group-count">{sets.length}</span>}
        {!readOnly && (
          <button type="button" className="row-icon-button tint" aria-label={`Add ${noun.toLowerCase()} to ${table.name}`} onClick={() => onAdd(table.id)}>
            <PlusIcon size={16} />
          </button>
        )}
      </h3>
      {sets.map((set, index) => {
        const label = set.name?.trim() || `${noun} ${index + 1}`;
        const available = table.columns.filter((column) => !set.columnIds.includes(column.id));
        const note = hint?.(set);
        return (
          <div className="inset-section" key={set.id}>
            <div className="inset-group">
              <div className="inset-row">
                <Icon size={15} className="inset-row-icon" aria-hidden="true" />
                <Input
                  className="inset-field mono leading"
                  aria-label={`Name of ${label} on ${table.name}`}
                  placeholder={placeholder(index)}
                  value={set.name ?? ""}
                  disabled={readOnly}
                  onChange={(event) => onPatch(table.id, set.id, { name: event.target.value })}
                />
                {!readOnly && (
                  <button type="button" className="row-icon-button destructive" aria-label={`Delete ${label} on ${table.name}`} onClick={() => onDelete(table.id, set.id)}>
                    <Trash2Icon size={15} />
                  </button>
                )}
              </div>
              <div className="inset-row unique-columns">
                {set.columnIds.map((columnId) => (
                  <span className="unique-chip" key={columnId}>
                    {columnName(columnId)}
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={`Remove ${columnName(columnId)} from ${label}`}
                        onClick={() => onPatch(table.id, set.id, { columnIds: set.columnIds.filter((id) => id !== columnId) })}
                      >
                        <CircleXIcon size={13} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                ))}
                {/*
                  A pull-down, not a pop-up: this is an action ("add"), not a
                  value to choose. A select had to carry a fake "Add column"
                  option to show as checked, and -- placing its checked row
                  over the trigger -- opened upwards across the list above.
                  A menu opens below, holds only real columns, and sizes to
                  the longest name instead of clipping it.
                */}
                {!readOnly && Boolean(available.length) && (
                  <DropdownMenuTrigger>
                    <AriaButton className="unique-add" aria-label={`Add a column to ${label}`}>
                      <PlusIcon size={13} aria-hidden="true" />
                      Add column
                    </AriaButton>
                    <DropdownMenu placement="bottom start" className="unique-add-menu code-menu w-auto max-h-72" aria-label={`Columns to add to ${label}`}>
                      {available.map((column) => (
                        <DropdownMenuItem
                          key={column.id}
                          id={column.id}
                          textValue={column.name}
                          onAction={() => onPatch(table.id, set.id, { columnIds: [...set.columnIds, column.id] })}
                        >
                          <span className="unique-add-name">{column.name.toUpperCase()}</span>
                          <span className="unique-add-type">{typeName(column, dialect)}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenu>
                  </DropdownMenuTrigger>
                )}
              </div>
            </div>
            {note && <p className="inset-group-footer">{note}</p>}
          </div>
        );
      })}
    </section>
  );
});
