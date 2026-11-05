"use client";

/**
 * The Columns header's template menu: insert a block of columns (the built-ins,
 * then the project's own), save some of this table's columns as a new one, or
 * remove one the project keeps.
 *
 * Templates the project keeps live in the schema, so they reach every
 * collaborator and travel with a JSON export like any other edit.
 */

import { useDialect } from "@/app/components/designer/context/dialect-context";
import { typeName } from "@/app/lib/dialect";
import { memo, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { LayoutTemplateIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { BUILTIN_COLUMN_TEMPLATES, makeColumnTemplate, type ColumnTemplate, type Table } from "@/app/lib/schema";

export type ColumnTemplatesMenuProps = {
  table: Table;
  templates: ColumnTemplate[];
  applyTemplate: (tableId: string, template: ColumnTemplate) => void;
  saveTemplate: (template: ColumnTemplate) => void;
  deleteTemplate: (templateId: string) => void;
};

/** Says what a template adds, so the menu is readable without opening anything. */
const summary = (template: ColumnTemplate) => template.columns.map((column) => column.name).join(", ");

export const ColumnTemplatesMenu = memo(function ColumnTemplatesMenu({
  table,
  templates,
  applyTemplate,
  saveTemplate,
  deleteTemplate,
}: ColumnTemplatesMenuProps) {
  const [saving, setSaving] = useState(false);
  const item = (template: ColumnTemplate) => (
    <DropdownMenuItem key={template.id} id={template.id} textValue={template.name} onAction={() => applyTemplate(table.id, template)}>
      <span className="flex min-w-0 flex-col">
        <span>{template.name}</span>
        <span className="truncate text-xs text-muted-foreground">{summary(template)}</span>
      </span>
    </DropdownMenuItem>
  );
  return (
    <>
      <DropdownMenuTrigger>
        <AriaButton className="row-icon-button tint" aria-label={`Insert template columns into ${table.name}`}>
          <LayoutTemplateIcon size={16} aria-hidden="true" />
        </AriaButton>
        <DropdownMenu placement="bottom end" className="w-auto max-w-80" aria-label="Column templates">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Built in</DropdownMenuLabel>
            {BUILTIN_COLUMN_TEMPLATES.map(item)}
          </DropdownMenuGroup>
          {templates.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>This project</DropdownMenuLabel>
              {templates.map(item)}
            </DropdownMenuGroup>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem textValue="Save columns as template" isDisabled={!table.columns.length} onAction={() => setSaving(true)}>
            <SaveIcon />
            Save columns as template…
          </DropdownMenuItem>
          {templates.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger textValue="Remove a template">
                <Trash2Icon />
                Remove a template
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent aria-label="Templates to remove">
                {templates.map((template) => (
                  <DropdownMenuItem key={template.id} id={template.id} textValue={template.name} variant="destructive" onAction={() => deleteTemplate(template.id)}>
                    {template.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenu>
      </DropdownMenuTrigger>
      {/* Keyed on the table so reopening it for another table starts from that table's columns. */}
      {saving && <SaveTemplateDialog key={table.id} table={table} onClose={() => setSaving(false)} onSave={saveTemplate} />}
    </>
  );
});

function SaveTemplateDialog({ table, onClose, onSave }: { table: Table; onClose: () => void; onSave: (template: ColumnTemplate) => void }) {
  const dialect = useDialect();
  const [name, setName] = useState("");
  // The key is the table's own business; what usually repeats is everything after it.
  const [chosen, setChosen] = useState(() => new Set(table.columns.filter((column) => !column.pk).map((column) => column.id)));
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const columns = table.columns.filter((column) => chosen.has(column.id));
  const canSave = Boolean(name.trim()) && columns.length > 0;
  const save = () => {
    if (!canSave) return;
    onSave(makeColumnTemplate(name.trim(), columns));
    onClose();
  };
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>Save columns as template</DialogTitle>
        <DialogDescription>Saved with this project, so everyone editing it can insert them. Foreign keys are not kept.</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Input autoFocus aria-label="Template name" placeholder="Template name" value={name} onChange={(event) => setName(event.target.value)} />
        <div className="grid max-h-64 gap-2 overflow-y-auto">
          {table.columns.map((column) => (
            <div key={column.id} className="flex items-center gap-2">
              <Checkbox aria-label={column.name} isSelected={chosen.has(column.id)} onChange={(on) => toggle(column.id, on)} />
              <span className="code-menu">{column.name}</span>
              <span className="text-xs text-muted-foreground">{typeName(column, dialect)}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={!canSave}>
            Save template
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
