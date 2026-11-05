"use client";

/**
 * Find columns anywhere in the diagram, tick the ones to change, then set their
 * shared properties or rename them by find-and-replace. Every apply is a single
 * commit, so one undo takes the whole edit back.
 *
 * The ticked set survives a change of filter on purpose: narrowing the list to
 * find the next few columns should not forget the ones already chosen.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { findColumns, patchColumns, renameColumns, type BulkColumnPatch, type ColumnRef } from "@/app/lib/bulk-columns";
import { type OracleType } from "@/app/lib/schema";
import { choiceOf, choiceTakesSize, dialectOf, PG_TYPE_OPTIONS, typeChoices, typeName } from "@/app/lib/dialect";
import { useSchema } from "@/app/hooks";

export type BulkColumnsModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
};

/** The "leave it alone" choice in every select, never a real value. */
const KEEP = "__keep";
const ANY = "__any";
type Mode = "set" | "rename";
type Nullability = typeof KEEP | "required" | "optional";

export function BulkColumnsModal({ isOpen, onOpenChange, readOnly }: BulkColumnsModalProps) {
  const { schema, commit } = useSchema();
  // A PostgreSQL diagram filters and sets by PostgreSQL's names; each stands for the Oracle type it is stored as.
  const dialect = dialectOf(schema);
  const [text, setText] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ANY);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<Mode>("set");
  const [type, setType] = useState<string>(KEEP);
  const [size, setSize] = useState("");
  const [nullability, setNullability] = useState<Nullability>(KEEP);
  const [defaultValue, setDefaultValue] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const shown = useMemo(
    () => {
      const found = findColumns(schema, { text, type: typeFilter === ANY || dialect === "postgres" ? undefined : (typeFilter as OracleType) });
      if (typeFilter === ANY || dialect !== "postgres") return found;
      const columns = new Map(schema.tables.flatMap((table) => table.columns.map((column) => [column.id, column] as const)));
      return found.filter((ref) => choiceOf(columns.get(ref.columnId)!, dialect) === typeFilter);
    },
    [dialect, schema, text, typeFilter],
  );
  const rows = useMemo(() => {
    const tables = new Map(schema.tables.map((table) => [table.id, table]));
    return shown.flatMap((ref) => {
      const table = tables.get(ref.tableId);
      const column = table?.columns.find((item) => item.id === ref.columnId);
      return table && column ? [{ ref, table, column }] : [];
    });
  }, [schema.tables, shown]);
  // Ticked columns a collaborator has since deleted drop out here rather than lingering in the count.
  const refs = useMemo<ColumnRef[]>(
    () => schema.tables.flatMap((table) => table.columns.filter((column) => chosen.has(column.id)).map((column) => ({ tableId: table.id, columnId: column.id }))),
    [schema.tables, chosen],
  );

  const patch: BulkColumnPatch = {
    ...(type !== KEEP && { type: dialect === "postgres" ? PG_TYPE_OPTIONS.find((option) => option.id === type)!.oracle : (type as OracleType) }),
    // `bigint` and `uuid` are a type and a fixed size together.
    ...(type !== KEEP && dialect === "postgres" && PG_TYPE_OPTIONS.find((option) => option.id === type)?.size !== undefined && { size: PG_TYPE_OPTIONS.find((option) => option.id === type)!.size }),
    // `jsonb` and the other PostgreSQL-only types are remembered beside the Oracle type they are stored as.
    ...(type !== KEEP && { postgresType: dialect === "postgres" && PG_TYPE_OPTIONS.find((option) => option.id === type)?.extra ? type : undefined }),
    ...(size.trim() && { size: size.trim() }),
    ...(nullability !== KEEP && { notNull: nullability === "required" }),
    ...(defaultValue.trim() && { defaultValue: defaultValue.trim() }),
  };
  const rename = useMemo(() => renameColumns(schema, refs, find, replace, { regex, caseSensitive }), [schema, refs, find, replace, regex, caseSensitive]);

  const shownChosen = rows.filter((row) => chosen.has(row.column.id)).length;
  const toggle = (ids: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const canApply = !readOnly && refs.length > 0 && (mode === "set" ? Object.keys(patch).length > 0 : rename.renames.length > 0 && !rename.error);
  const apply = () => {
    if (!canApply) return;
    if (mode === "set") {
      commit(patchColumns(schema, refs, patch));
      toast.success(`Updated ${refs.length} column(s).`);
    } else {
      commit(rename.schema);
      toast.success(`Renamed ${rename.renames.length} column(s).`);
    }
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Edit columns</DialogTitle>
        <DialogDescription>Find columns across every table, tick the ones to change, then set their properties or rename them. One undo reverts the whole edit.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-2">
        <Input autoFocus aria-label="Filter columns" placeholder="Filter by TABLE.COLUMN" value={text} onChange={(event) => setText(event.target.value)} />
        <Select aria-label="Filter by type" className="w-56 shrink-0" selectedKey={typeFilter} onSelectionChange={(key) => setTypeFilter(String(key))}>
          <SelectTrigger className="mono w-full"><SelectValue /></SelectTrigger>
          <SelectContent className="code-menu"><SelectGroup>
            <SelectItem id={ANY}>Any type</SelectItem>
            {typeChoices(dialect).map(([id, label]) => <SelectItem key={id} id={id}>{label}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-2xl ring-1 ring-foreground/10">
        <div className="sticky top-0 flex items-center gap-3 bg-popover px-3 py-2 text-xs text-muted-foreground">
          <Checkbox
            aria-label="Tick every column shown"
            isSelected={rows.length > 0 && shownChosen === rows.length}
            isIndeterminate={shownChosen > 0 && shownChosen < rows.length}
            isDisabled={!rows.length}
            onChange={(on) => toggle(rows.map((row) => row.column.id), on)}
          />
          <span>{rows.length} shown · {refs.length} ticked</span>
          {refs.length > 0 && (
            <button type="button" className="ml-auto text-primary" onClick={() => setChosen(new Set())}>
              Clear
            </button>
          )}
        </div>
        {rows.map(({ table, column }) => (
          <div key={column.id} className="flex items-center gap-3 px-3 py-1.5">
            <Checkbox aria-label={`${table.name}.${column.name}`} isSelected={chosen.has(column.id)} onChange={(on) => toggle([column.id], on)} />
            <span className="code-menu min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">{table.name}.</span>
              {column.name}
            </span>
            <span className="code-menu text-xs text-muted-foreground">{typeName(column, dialect)}</span>
            <span className="w-16 text-right text-xs text-muted-foreground">{column.notNull ? "NOT NULL" : "NULL"}</span>
          </div>
        ))}
        {!rows.length && <p className="px-3 py-6 text-center text-muted-foreground">No columns match.</p>}
      </div>

      <Tabs selectedKey={mode} onSelectionChange={(key) => setMode(key as Mode)}>
        <TabsList>
          <TabsTrigger id="set">Set properties</TabsTrigger>
          <TabsTrigger id="rename">Rename</TabsTrigger>
        </TabsList>
        <TabsContent id="set" className="grid grid-cols-2 gap-2 pt-3">
          <Select aria-label="New type" className="w-full" selectedKey={type} onSelectionChange={(key) => setType(String(key))}>
            <SelectTrigger className="mono w-full"><SelectValue /></SelectTrigger>
            <SelectContent className="code-menu"><SelectGroup>
              <SelectItem id={KEEP}>Keep type</SelectItem>
              {typeChoices(dialect).map(([id, label]) => <SelectItem key={id} id={id}>{label}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <Input
            aria-label="New size"
            className="mono"
            placeholder="Keep size"
            disabled={type !== KEEP && !choiceTakesSize(type, dialect)}
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
          <Select aria-label="Nullability" className="w-full" selectedKey={nullability} onSelectionChange={(key) => setNullability(key as Nullability)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem id={KEEP}>Keep nullability</SelectItem>
              <SelectItem id="required">NOT NULL</SelectItem>
              <SelectItem id="optional">NULL allowed</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
          <Input aria-label="New default" className="mono" placeholder="Keep default" value={defaultValue} onChange={(event) => setDefaultValue(event.target.value)} />
        </TabsContent>
        <TabsContent id="rename" className="grid gap-2 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Find" className="mono" placeholder="Find" value={find} onChange={(event) => setFind(event.target.value)} />
            <Input aria-label="Replace with" className="mono" placeholder={regex ? "Replace ($1 for a group)" : "Replace"} value={replace} onChange={(event) => setReplace(event.target.value)} />
          </div>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-2"><Checkbox aria-label="Regular expression" isSelected={regex} onChange={setRegex} />Regular expression</span>
            <span className="flex items-center gap-2"><Checkbox aria-label="Match case" isSelected={caseSensitive} onChange={setCaseSensitive} />Match case</span>
          </div>
          {rename.error ? (
            <p className="text-xs text-destructive">{rename.error}</p>
          ) : (
            find && (
              <ul className="code-menu max-h-32 overflow-y-auto text-xs">
                {rename.renames.map((item) => (
                  <li key={item.columnId}>
                    <span className="text-muted-foreground">{item.before}</span> → {item.after}
                  </li>
                ))}
                {!rename.renames.length && <li className="text-muted-foreground">No ticked column matches.</li>}
              </ul>
            )
          )}
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Done
        </Button>
        <Button isDisabled={!canApply} onClick={apply}>
          {mode === "set" ? `Apply to ${refs.length}` : `Rename ${rename.renames.length}`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
