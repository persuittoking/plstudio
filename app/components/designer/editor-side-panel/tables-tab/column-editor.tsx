"use client";

/**
 * One column in the side panel, as a row in an inset grouped list.
 *
 * The row is for scanning: name, type and constraint glyphs, the way the
 * canvas card shows them. Editing is one press deeper -- the detail opens
 * under the row, one column at a time, so a twelve-column table reads as a
 * list of twelve rows rather than ninety fields.
 */

import { memo, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRightIcon, FingerprintIcon, GripVerticalIcon, KeyRoundIcon, LinkIcon, TargetIcon, Trash2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Column, type Table, typeSizePlaceholder } from "@/app/lib/schema";
import { choiceOf, choicePatch, choicePlaceholder, choiceTakesSize, typeChoiceGroups, typeName } from "@/app/lib/dialect";
import { useDialect } from "@/app/components/designer/context/dialect-context";

const NO_REFERENCE = "__no_reference__";
type ForeignKeyTarget = { table: Table; target: Column };

export const ColumnEditor = memo(function ColumnEditor({
  table,
  column,
  position,
  expanded,
  onToggle,
  readOnly,
  patchColumn,
  deleteColumn,
  compatibleForeignKeyTargets,
  onShowImpact,
  onGrab,
  onGrabKeyDown,
}: {
  table: Table;
  column: Column;
  /** 1-based place in the column list, read out on the drag handle. */
  position?: string;
  expanded: boolean;
  onToggle: (columnId: string) => void;
  readOnly: boolean;
  patchColumn: (tableId: string, columnId: string, patch: Partial<Column>) => void;
  deleteColumn: (tableId: string, columnId: string) => void;
  compatibleForeignKeyTargets: (column: Column) => ForeignKeyTarget[];
  /** Shows on the canvas everything that depends on this column. */
  onShowImpact: (tableId: string, columnId: string) => void;
  /** Absent when the diagram is read-only — then no handle is rendered at all. */
  onGrab?: (event: ReactPointerEvent<HTMLButtonElement>, columnId: string) => void;
  onGrabKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, columnId: string) => void;
}) {
  const patch = (changes: Partial<Column>) => patchColumn(table.id, column.id, changes);
  // `VARCHAR2(100)` in an Oracle diagram, `varchar(100)` in a PostgreSQL one; the picker offers that database's types.
  const dialect = useDialect();
  const choice = choiceOf(column, dialect);
  const detailId = `column-detail-${column.id}`;
  const name = column.name.toUpperCase() || "Untitled";
  const flags = new Set([column.pk && "pk", !column.notNull && "null", column.unique && "unique"].filter(Boolean) as string[]);
  return (
    <div className={`column-item ${expanded ? "expanded" : ""}`}>
      <div className="inset-row column-row">
        {onGrab ? (
          <button
            type="button"
            className="column-grip"
            aria-label={`Reorder column ${column.name}${position ? `, ${position}` : ""}. Press the up or down arrow to move it.`}
            onPointerDown={(event) => onGrab(event, column.id)}
            onKeyDown={(event) => onGrabKeyDown?.(event, column.id)}
          >
            <GripVerticalIcon size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className="column-grip-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className="column-disclosure"
          aria-expanded={expanded}
          aria-controls={expanded ? detailId : undefined}
          onClick={() => onToggle(column.id)}
        >
          <span className="column-row-name">{name}</span>
          <span className="column-row-type">{typeName(column, dialect)}</span>
          <span className="column-row-flags">
            {column.pk && <KeyRoundIcon size={13} className="pk" aria-label="Primary key" />}
            {column.fk && <LinkIcon size={13} aria-label="Foreign key" />}
            {column.unique && <FingerprintIcon size={13} aria-label="Unique" />}
            {!column.notNull && !column.pk && <span className="column-row-null" aria-label="Nullable">?</span>}
          </span>
          <ChevronRightIcon size={14} className="column-row-chevron" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="column-detail" id={detailId} role="group" aria-label={`Column ${name}`}>
          <div className="column-detail-inner">
            <label className="inset-row">
              <span className="inset-row-label">Name</span>
              <Input className="inset-field mono" autoFocus={!column.name} disabled={readOnly} value={column.name} onChange={(event) => patch({ name: event.target.value })} />
            </label>
            <div className="inset-row">
              <span className="inset-row-label">Type</span>
              <Select
                className="inset-row-value"
                aria-label={`Datatype for ${column.name}`}
                isDisabled={readOnly}
                selectedKey={choice}
                onSelectionChange={(key) => patch(choicePatch(String(key), column, dialect))}
              >
                <SelectTrigger className="inset-field mono"><SelectValue /></SelectTrigger>
                <SelectContent className="code-menu">
                  {typeChoiceGroups(dialect).map((group) => (
                    <SelectGroup key={group.label || "types"}>
                      {group.label && <SelectLabel>{group.label}</SelectLabel>}
                      {group.choices.map(([id, label]) => <SelectItem key={id} id={id}>{label}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {choiceTakesSize(choice, dialect) && (
              <label className="inset-row">
                <span className="inset-row-label">Size</span>
                <Input className="inset-field mono" disabled={readOnly} placeholder={choicePlaceholder(choice, dialect, typeSizePlaceholder)} value={column.size} onChange={(event) => patch({ size: event.target.value })} />
              </label>
            )}
            <div className="inset-row">
              <span className="inset-row-label">Constraints</span>
              <span className="inset-row-value">
                <ToggleGroup
                  className="segmented"
                  aria-label={`Constraints for ${column.name}`}
                  selectionMode="multiple"
                  spacing={0}
                  isDisabled={readOnly}
                  selectedKeys={flags}
                  onSelectionChange={(keys) => {
                    const pk = keys.has("pk");
                    patch({ pk, fk: pk ? null : column.fk, notNull: !keys.has("null"), unique: keys.has("unique") });
                  }}
                >
                  <ToggleGroupItem id="pk" aria-label="Primary key"><KeyRoundIcon aria-hidden="true" />PK</ToggleGroupItem>
                  <ToggleGroupItem id="null">Null</ToggleGroupItem>
                  <ToggleGroupItem id="unique">Unique</ToggleGroupItem>
                </ToggleGroup>
              </span>
            </div>
            <label className="inset-row">
              <span className="inset-row-label">Default</span>
              <Input className="inset-field mono" disabled={readOnly} placeholder="None" value={column.defaultValue} onChange={(event) => patch({ defaultValue: event.target.value })} />
            </label>
            <label className="inset-row">
              <span className="inset-row-label">Check</span>
              <Input className="inset-field mono" disabled={readOnly} placeholder="None" value={column.check} onChange={(event) => patch({ check: event.target.value })} />
            </label>
            {/* Prose, not a value: stacked, full width, and growing with what is written. */}
            <label className="inset-row stacked">
              <span className="inset-row-label">Comment</span>
              <Textarea className="inset-textarea" disabled={readOnly} placeholder="What this column holds" value={column.comment ?? ""} onChange={(event) => patch({ comment: event.target.value })} />
            </label>
            {!column.pk && (
              <div className="inset-row">
                <span className="inset-row-label">References</span>
                <Select
                  className="inset-row-value"
                  aria-label={`Foreign key for ${column.name}`}
                  isDisabled={readOnly}
                  selectedKey={column.fk ? `${column.fk.tableId}::${column.fk.columnId}` : NO_REFERENCE}
                  onSelectionChange={(key) => {
                    const [tableId, columnId] = String(key).split("::");
                    patch({ fk: tableId && columnId ? { tableId, columnId } : null });
                  }}
                >
                  <SelectTrigger className="inset-field mono"><SelectValue /></SelectTrigger>
                  <SelectContent className="code-menu"><SelectGroup>
                    <SelectItem id={NO_REFERENCE} className="code-menu-prose">None</SelectItem>
                    {compatibleForeignKeyTargets(column).map(({ table: target, target: field }) => (
                      <SelectItem key={`${target.id}::${field.id}`} id={`${target.id}::${field.id}`}>
                        {target.name.toUpperCase()}.{field.name.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectGroup></SelectContent>
                </Select>
              </div>
            )}
            <div className="inset-row column-detail-actions">
              <button type="button" className="row-text-button" onClick={() => onShowImpact(table.id, column.id)}>
                <TargetIcon size={14} aria-hidden="true" />
                Show dependents
              </button>
              {!readOnly && (
                <button type="button" className="row-text-button destructive" onClick={() => deleteColumn(table.id, column.id)}>
                  <Trash2Icon size={14} aria-hidden="true" />
                  Delete column
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
