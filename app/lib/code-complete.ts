import { normalizeIdentifier, type Schema } from "@/app/lib/schema";

/**
 * Suggestions for the word being typed in a Document code block: the diagram's
 * tables and columns, the identifiers the document already uses, and the
 * keywords of the language the block reads as. Pure, so the editor plugin only
 * has to say where the cursor is.
 */
export type CompletionKind = "table" | "column" | "word" | "keyword";
export type CompletionItem = { label: string; insert: string; kind: CompletionKind; detail?: string };

export type CompletionSource = {
  schema: Pick<Schema, "tables">;
  /** Identifiers the document already uses in its code. */
  words: string[];
  /** The block's language, as `detectLanguage` names it; `""` counts as SQL. */
  language: string;
};

const SQL = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "EXISTS", "BETWEEN", "LIKE", "DISTINCT", "AS",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "MERGE", "USING", "MATCHED", "RETURNING",
  "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "ON", "GROUP", "BY", "ORDER", "HAVING", "UNION", "ALL", "ASC", "DESC",
  "CREATE", "REPLACE", "ALTER", "DROP", "TRUNCATE", "TABLE", "VIEW", "INDEX", "SEQUENCE", "SYNONYM", "GRANT",
  "PACKAGE", "BODY", "PROCEDURE", "FUNCTION", "TRIGGER", "RETURN", "IS", "BEGIN", "END", "DECLARE", "EXCEPTION",
  "WHEN", "THEN", "ELSE", "ELSIF", "CASE", "IF", "LOOP", "FOR", "WHILE", "EXIT", "CURSOR", "OPEN", "FETCH", "CLOSE",
  "BULK", "COLLECT", "FORALL", "PRAGMA", "AUTONOMOUS_TRANSACTION", "COMMIT", "ROLLBACK", "SAVEPOINT",
  "CONSTRAINT", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK", "DEFAULT", "CASCADE",
  "VARCHAR2", "NVARCHAR2", "CHAR", "NUMBER", "INTEGER", "DATE", "TIMESTAMP", "CLOB", "BLOB", "BOOLEAN", "ROWTYPE",
  "NVL", "NVL2", "COALESCE", "DECODE", "COUNT", "SUM", "MAX", "MIN", "AVG", "SYSDATE", "SYSTIMESTAMP", "ROWNUM", "DUAL",
  "RAISE", "RAISE_APPLICATION_ERROR", "NO_DATA_FOUND", "TOO_MANY_ROWS", "OTHERS", "SQLERRM", "SQLCODE",
  "DBMS_OUTPUT", "PUT_LINE", "TO_CHAR", "TO_DATE", "TO_NUMBER", "TRIM", "UPPER", "LOWER", "SUBSTR", "INSTR",
];
const SCRIPT = ["const", "let", "function", "return", "import", "export", "default", "from", "async", "await", "class", "extends", "new", "this", "true", "false", "null", "undefined", "console", "document", "window"];
const KEYWORDS: Record<string, string[]> = {
  sql: SQL,
  "": SQL,
  javascript: SCRIPT,
  typescript: [...SCRIPT, "interface", "type", "implements", "readonly", "string", "number", "boolean", "unknown", "never"],
  java: ["public", "private", "protected", "static", "final", "void", "class", "interface", "extends", "implements", "return", "new", "this", "String", "Integer", "List", "Map", "System", "println", "throws", "try", "catch"],
  python: ["def", "class", "return", "import", "from", "self", "None", "True", "False", "elif", "else", "for", "while", "with", "lambda", "print"],
};
const UPPER_CASE_KEYWORDS = new Set(["sql", ""]);

const KIND_ORDER: Record<CompletionKind, number> = { table: 0, column: 1, word: 2, keyword: 3 };
const LIMIT = 8;

/** The word right before the cursor: `owner` is what precedes a dot (`TABLE.` + `col`), `prefix` what is typed after it. */
export function wordAt(lineBefore: string): { owner: string; prefix: string } {
  const match = lineBefore.match(/(?:([A-Za-z_$#][\w$#]*)\.)?([A-Za-z_$#][\w$#]*)?$/);
  return { owner: match?.[1] ?? "", prefix: match?.[2] ?? "" };
}

/** Identifiers worth offering again: four characters or more, so `id` and `set` do not crowd the list. */
export function collectWords(code: string): string[] {
  return [...new Set(code.match(/[A-Za-z_$#][\w$#]*(?:\.[A-Za-z_$#][\w$#]*)*/g) ?? [])].filter((word) => word.length >= 4);
}

const sameWord = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What to offer for the word before the cursor, best first; empty when there is nothing worth showing. */
export function completions(lineBefore: string, source: CompletionSource): CompletionItem[] {
  const { owner, prefix } = wordAt(lineBefore);
  const starts = (label: string) => label.toLowerCase().startsWith(prefix.toLowerCase()) && !sameWord(label, prefix);

  // After `TABLE.`: that table's columns, and what the document writes after the same name.
  if (owner) {
    const table = source.schema.tables.find((item) => normalizeIdentifier(item.name) === normalizeIdentifier(owner));
    const columns: CompletionItem[] = (table?.columns ?? []).map((column) => ({ label: column.name, insert: column.name, kind: "column", detail: column.type }));
    const words: CompletionItem[] = source.words
      .filter((word) => word.toLowerCase().startsWith(`${owner.toLowerCase()}.`))
      .map((word) => word.slice(owner.length + 1).split(".")[0])
      .map((rest) => ({ label: rest, insert: rest, kind: "word" }));
    return rank(dedupe([...columns, ...words]).filter((item) => starts(item.label)));
  }

  if (prefix.length < 2) return [];
  const tables: CompletionItem[] = source.schema.tables.map((table) => ({ label: table.name, insert: table.name, kind: "table", detail: `${table.columns.length} col.` }));
  const columns: CompletionItem[] = source.schema.tables.flatMap((table) =>
    table.columns.map((column) => ({ label: column.name, insert: column.name, kind: "column" as const, detail: table.name })));
  const words: CompletionItem[] = source.words.map((word) => ({ label: word, insert: word, kind: "word" }));
  const upper = UPPER_CASE_KEYWORDS.has(source.language);
  // A keyword is written in the case it is being typed in: `sel` gives `select`, `SEL` gives `SELECT`.
  const lowerTyped = prefix === prefix.toLowerCase();
  const keywords: CompletionItem[] = (KEYWORDS[source.language] ?? []).map((keyword) => {
    const written = upper && lowerTyped ? keyword.toLowerCase() : keyword;
    return { label: written, insert: written, kind: "keyword" };
  });
  return rank(dedupe([...tables, ...columns, ...words, ...keywords]).filter((item) => starts(item.label)));
}

/** One entry per spelling, keeping the first (the more specific kind). */
const dedupe = (items: CompletionItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.label.toLowerCase()) && seen.add(item.label.toLowerCase()));
};

/** The diagram's own names first (tables, columns), then the document's words, then keywords; shorter first within each. */
const rank = (items: CompletionItem[]) =>
  [...items]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.length - b.label.length || a.label.localeCompare(b.label))
    .slice(0, LIMIT);
