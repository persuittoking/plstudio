"use client";

/**
 * The project's Oracle packages: which tables each one covers, the generated
 * spec/body it produces, and the hand-written subprograms kept beside the
 * generated Ins/Upd/Del. A package is also a card on the canvas; clicking that
 * card opens it here.
 */

import { useState } from "react";
import { PackageIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useLayout, useSchema } from "@/app/hooks";
import { generatePackage } from "@/app/lib/generators";
import { PACKAGE_WIDTH, contentEdges, makePackage, makePackageProcedure, type PackageProcedure, type SchemaPackage } from "@/app/lib/schema";
import { highlightSql } from "../../highlight";

export function PackagesTab({ readOnly }: { readOnly: boolean }) {
  const { schema, commitWith } = useSchema();
  const { openPackageId, setOpenPackageId } = useLayout();
  const [preview, setPreview] = useState<"spec" | "body">("spec");
  const packages = schema.packages ?? [];

  const withPackages = (mutate: (packages: SchemaPackage[]) => SchemaPackage[]) =>
    commitWith((current) => ({ ...current, packages: mutate(current.packages ?? []) }));
  const patch = (id: string, change: Partial<SchemaPackage>) =>
    withPackages((current) => current.map((pkg) => (pkg.id === id ? { ...pkg, ...change } : pkg)));
  const patchProcedure = (pkg: SchemaPackage, id: string, change: Partial<PackageProcedure>) =>
    patch(pkg.id, { procedures: pkg.procedures.map((proc) => (proc.id === id ? { ...proc, ...change } : proc)) });
  const add = () => {
    // Beside the diagram, below its lowest card, one column per package so new cards do not stack.
    const edges = contentEdges(schema);
    const pkg = makePackage(`Package_${packages.length + 1}`, (edges?.left ?? 160) + packages.length * (PACKAGE_WIDTH + 40), (edges?.bottom ?? 80) + 80);
    withPackages((current) => [...current, pkg]);
    setOpenPackageId(pkg.id);
  };
  const toggleTable = (pkg: SchemaPackage, tableId: string) =>
    patch(pkg.id, { tableIds: pkg.tableIds.includes(tableId) ? pkg.tableIds.filter((id) => id !== tableId) : [...pkg.tableIds, tableId] });

  return (
    <ScrollArea className="panel-body queries-panel-body">
      {!readOnly && (
        <div className="queries-toolbar">
          <button type="button" className="row-text-button" onClick={add}>
            <PlusIcon size={14} aria-hidden="true" /> Add package
          </button>
          <span className="hint">{packages.length ? `${packages.length} ${packages.length === 1 ? "package" : "packages"}` : "No packages yet"}</span>
        </div>
      )}

      {packages.length ? (
        packages.map((pkg, index) => {
          const open = openPackageId === pkg.id;
          const label = pkg.name.trim() || `Package ${index + 1}`;
          const generated = open ? generatePackage(schema, pkg, index) : null;
          const unnamed = pkg.procedures.some((proc) => !proc.name.trim());
          return (
            <section className="inset-section" key={pkg.id} aria-label={label}>
              <div className="inset-row query-head">
                <button type="button" className="row-icon-button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} onClick={() => setOpenPackageId(open ? null : pkg.id)}>
                  <PackageIcon size={14} />
                </button>
                <Input
                  className="inset-field leading"
                  aria-label={`Name of ${label}`}
                  placeholder={label}
                  value={pkg.name}
                  disabled={readOnly}
                  onChange={(event) => patch(pkg.id, { name: event.target.value })}
                />
                <span className="query-weight">{pkg.tableIds.length} {pkg.tableIds.length === 1 ? "table" : "tables"}</span>
                {!readOnly && (
                  <button type="button" className="row-icon-button destructive" aria-label={`Delete ${label}`} onClick={() => withPackages((current) => current.filter((item) => item.id !== pkg.id))}>
                    <Trash2Icon size={14} />
                  </button>
                )}
              </div>

              {open && generated && (
                <>
                  <h3 className="inset-group-header">Generated procedures</h3>
                  <div className="inset-group">
                    <label className="inset-row">
                      <input className="package-check" type="checkbox" checked={pkg.includeCrud} disabled={readOnly} onChange={(event) => patch(pkg.id, { includeCrud: event.target.checked })} />
                      <span>Ins / Upd / Del for the tables below</span>
                    </label>
                    {schema.tables.map((table) => (
                      <label className="inset-row" key={table.id}>
                        <input className="package-check" type="checkbox" checked={pkg.tableIds.includes(table.id)} disabled={readOnly} onChange={() => toggleTable(pkg, table.id)} />
                        <code>{table.name.toUpperCase()}</code>
                      </label>
                    ))}
                    {!schema.tables.length && <p className="inset-group-footer">Draw a table to cover it.</p>}
                  </div>

                  <h3 className="inset-group-header">Body declarations</h3>
                  <div className="inset-group">
                    <Textarea aria-label="Package body declarations" wrap="off" className="package-code" placeholder={"g_skip BOOLEAN := FALSE;\nc_limit CONSTANT NUMBER := 50;"} value={pkg.declarations ?? ""} disabled={readOnly} onChange={(event) => patch(pkg.id, { declarations: event.target.value || undefined })} />
                  </div>
                  <p className="inset-group-footer">Variables, constants, exceptions and private helpers. Emitted verbatim at the top of the body, before the subprograms.</p>

                  <h3 className="inset-group-header">Subprograms<span className="inset-group-count">{pkg.procedures.length}</span></h3>
                  <div className="inset-group">
                    {pkg.procedures.map((proc) => (
                      <div className="query-item" key={proc.id}>
                        <div className="inset-row query-head">
                          <select
                            className="package-kind"
                            aria-label="Kind"
                            value={proc.kind}
                            disabled={readOnly}
                            onChange={(event) => {
                              const kind = event.target.value as PackageProcedure["kind"];
                              patchProcedure(pkg, proc.id, { kind, returns: kind === "function" ? proc.returns || "varchar2" : undefined });
                            }}
                          >
                            <option value="procedure">Procedure</option>
                            <option value="function">Function</option>
                          </select>
                          <Input className="inset-field leading" aria-label="Subprogram name" placeholder="Name" value={proc.name} disabled={readOnly} onChange={(event) => patchProcedure(pkg, proc.id, { name: event.target.value })} />
                          {!readOnly && (
                            <button type="button" className="row-icon-button destructive" aria-label={`Delete ${proc.name || "subprogram"}`} onClick={() => patch(pkg.id, { procedures: pkg.procedures.filter((item) => item.id !== proc.id) })}>
                              <Trash2Icon size={14} />
                            </button>
                          )}
                        </div>
                        <div className="inset-row">
                          <Input className="inset-field leading mono" aria-label="Parameters" placeholder="p_id number, p_name varchar2" value={proc.params} disabled={readOnly} onChange={(event) => patchProcedure(pkg, proc.id, { params: event.target.value })} />
                          {proc.kind === "function" && (
                            <label className="package-returns">
                              returns
                              <Input className="inset-field leading mono" aria-label="Return type" placeholder="varchar2" value={proc.returns ?? ""} disabled={readOnly} onChange={(event) => patchProcedure(pkg, proc.id, { returns: event.target.value })} />
                            </label>
                          )}
                        </div>
                        <Textarea aria-label="Body" wrap="off" className="package-code" placeholder={"begin\n  null;\nend;"} value={proc.body} disabled={readOnly} onChange={(event) => patchProcedure(pkg, proc.id, { body: event.target.value })} />
                      </div>
                    ))}
                    {!readOnly && (
                      <div className="inset-row">
                        <button type="button" className="row-text-button" onClick={() => patch(pkg.id, { procedures: [...pkg.procedures, makePackageProcedure("procedure")] })}>
                          <PlusIcon size={14} aria-hidden="true" /> Procedure
                        </button>
                        <button type="button" className="row-text-button" onClick={() => patch(pkg.id, { procedures: [...pkg.procedures, makePackageProcedure("function")] })}>
                          <PlusIcon size={14} aria-hidden="true" /> Function
                        </button>
                      </div>
                    )}
                    {unnamed && <p className="query-unresolved">A subprogram without a name is emitted as “Unnamed”.</p>}
                  </div>

                  <h3 className="inset-group-header">Preview</h3>
                  <div className="inset-group">
                    <div className="inset-row">
                      {(["spec", "body"] as const).map((kind) => (
                        <button type="button" key={kind} className="row-text-button" aria-pressed={preview === kind} onClick={() => setPreview(kind)}>
                          {kind === "spec" ? "Specification" : "Body"}
                        </button>
                      ))}
                    </div>
                    <pre className="code query-sql package-preview">{highlightSql(generated[preview])}</pre>
                  </div>
                </>
              )}
            </section>
          );
        })
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon />
            </EmptyMedia>
            <EmptyTitle>No packages</EmptyTitle>
            <EmptyDescription>
              Group tables into Oracle packages, generate their Ins/Upd/Del procedures and add your own subprograms. Until you add one, the export keeps a single derived package.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </ScrollArea>
  );
}
