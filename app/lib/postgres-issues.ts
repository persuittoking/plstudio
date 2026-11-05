import { generatePostgres } from "./postgres";
import { normalizeIdentifier, type Schema } from "./schema";
import { validateSchema, type ValidationIssue } from "./validation";

/** Oracle's own limits, which a PostgreSQL script does not have: it quotes reserved words and shortens long names itself. */
const ORACLE_ONLY = /exceeds Oracle|reserved Oracle word/;

/**
 * The Issues drawer of a PostgreSQL diagram: the diagram's own problems (an
 * empty name, a broken reference, a bad CHECK) without Oracle's limits, and
 * then what PostgreSQL would refuse or read differently, each with its fix --
 * the same warnings the PostgreSQL tab of Export lists.
 */
export function postgresIssues(schema: Schema): ValidationIssue[] {
  const own = validateSchema(schema).filter((issue) => !ORACLE_ONLY.test(issue.message));
  const tableIds = new Map(schema.tables.map((table) => [normalizeIdentifier(table.name).toLowerCase(), table.id]));
  const postgres = generatePostgres(schema).notes
    .filter((note) => note.level === "warning")
    .map((note): ValidationIssue => ({
      severity: "warning",
      message: `PostgreSQL — ${note.table ? `${note.table.toUpperCase()}: ` : ""}${note.message}`,
      tableId: note.table ? tableIds.get(note.table.replace(/"/g, "").toLowerCase()) : undefined,
    }));
  return [...own, ...postgres];
}
