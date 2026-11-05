"use client";
import { useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { NewDiagramDialog } from "./new-diagram-dialog";

/**
 * Every "new diagram" button: it opens the window that asks Oracle or
 * PostgreSQL, and that window creates the diagram. No `workspace` means a
 * personal diagram.
 */
export default function NewProjectButton({ workspace, children = "New Diagram", variant = "default" }: {
  workspace?: string;
  children?: ReactNode;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-slot="button" className={buttonVariants({ variant })} onClick={() => setOpen(true)}>
        {children}
      </button>
      <NewDiagramDialog isOpen={open} onOpenChange={setOpen} workspace={workspace} />
    </>
  );
}
