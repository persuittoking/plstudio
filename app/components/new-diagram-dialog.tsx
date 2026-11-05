"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DatabaseIcon } from "lucide-react";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Dialect, Schema } from "@/app/lib/schema";
import { cn } from "@/lib/utils";

const CHOICES: { id: Dialect; name: string; hint: string; types: string }[] = [
  { id: "oracle", name: "Oracle", hint: "Oracle types, sequences and triggers, PL/SQL packages.", types: "VARCHAR2 · NUMBER · DATE · CLOB" },
  { id: "postgres", name: "PostgreSQL", hint: "PostgreSQL types and identity keys. The Oracle DDL stays available in Export.", types: "varchar · bigint · timestamp · uuid" },
];

/**
 * "New diagram" asks first which database the diagram is for, then creates it
 * and opens it. Used by the dashboard's button and the editor's File menu.
 */
export function NewDiagramDialog({ isOpen, onOpenChange, workspace }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The workspace to create it in; absent for a personal project. */
  workspace?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Dialect | null>(null);

  const create = async (dialect: Dialect) => {
    setBusy(dialect);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(workspace ? { workspace } : {}), name: "Untitled Diagram", dialect }),
      });
      if (!response.ok) throw new Error();
      const created = (await response.json()) as Schema;
      onOpenChange(false);
      router.push(workspace ? `/${workspace}/${created.id}` : `/project/${created.id}`);
    } catch {
      toast.error("Could not create project.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New diagram</DialogTitle>
        <DialogDescription>Which database is it for? You can switch later from the File menu.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Database">
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            data-dialect={choice.id}
            disabled={busy !== null}
            onClick={() => create(choice.id)}
            className={cn(
              "flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60",
              busy === choice.id && "border-primary bg-primary/10",
            )}
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              <DatabaseIcon className="size-4 text-primary" aria-hidden="true" />
              {choice.name}
            </span>
            <span className="text-sm text-muted-foreground">{busy === choice.id ? "Creating…" : choice.hint}</span>
            <span className="text-xs text-muted-foreground/80" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{choice.types}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
