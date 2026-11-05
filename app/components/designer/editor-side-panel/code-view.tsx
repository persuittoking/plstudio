"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useSchema } from "@/app/hooks";
import { useMemo } from "react";
import { highlightSql } from "../highlight";
import { generatePostgres } from "@/app/lib/postgres";

/**
 * The generated DDL, shown in place of the structure tabs. `ddl` is only
 * generated while this view is the visible one — see `SchemaContext`.
 */
export function CodeView() {
  const { ddl, schema } = useSchema();
  // A PostgreSQL diagram reads as its PostgreSQL script; the Oracle DDL stays one click away in Export.
  const postgres = useMemo(() => (schema.dialect === "postgres" ? generatePostgres(schema).sql : null), [schema]);
  return (
    <ScrollArea className="panel-code">
      <pre>
        <code>{highlightSql(postgres ?? ddl)}</code>
      </pre>
    </ScrollArea>
  );
}
