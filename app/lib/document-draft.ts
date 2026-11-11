import type { DocLang } from "@/app/lib/document-i18n";
import { postgresIssues } from "@/app/lib/postgres-issues";
import { currentTableColor, normalizeIdentifier, normalizeRelationships, primaryKeyColumns, type KeyStrategy, type Schema, type Table } from "@/app/lib/schema";
import { validateSchema } from "@/app/lib/validation";

/**
 * The document a diagram starts with: written from the diagram itself, not
 * prompts to fill in. It counts what is there, says how keys are made, which
 * table points at which and in what order they are created, and lists what the
 * checks would flag -- in the document's language and in the diagram's
 * database (Oracle or PostgreSQL), with the same highlights and blocks a person
 * would use, so every part stays editable.
 *
 * Written to be easy on the eye: short lines with a bold label each, badges
 * for kinds and warnings, the yellow marker only on the numbers that matter,
 * table names in their card's colour (a coloured chip in headings and cards,
 * coloured bold words inside sentences), and a rule between table sections.
 */

type Db = "Oracle" | "PostgreSQL";

type Words = {
  kicker: (db: Db) => string;
  intro: (name: string, db: Db) => string;
  counts: (tables: number, relationships: number, columns: number) => string;
  generated: string;
  central: (table: string, count: number) => string;
  widest: (table: string, count: number) => string;
  stats: { tables: [string, string]; relationships: [string, string]; columns: [string, string]; required: [string, string] };
  glance: string;
  rules: string;
  keyLabel: string;
  keyKinds: Record<KeyStrategy, string>;
  foreignKeysLabel: string;
  foreignKeys: (count: number) => string;
  cascade: (count: number) => string;
  noForeignKeys: string;
  constraintsLabel: string;
  unique: (count: number) => string;
  checks: (count: number) => string;
  defaults: (count: number) => string;
  er: string;
  erText: string;
  tablesTitle: string;
  heading: (table: string) => string;
  columnsLabel: string;
  columnsFact: (columns: number, required: number) => string;
  key: string;
  noKey: string;
  pointsTo: string;
  pointedBy: string;
  relationships: string;
  relationshipsText: (count: number) => string;
  flow: string;
  flowText: string;
  order: string;
  orderText: string;
  createdAfter: (table: string, parents: string) => string;
  createdFirst: (table: string) => string;
  review: string;
  error: string;
  warning: string;
  noComment: (table: string) => string;
  noCommentBadge: string;
  clean: string;
  notes: string;
};

const code = (name: string) => `\`${name}\``;
const list = (names: string[], and: string) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const UZ: Words = {
  kicker: (db) => `${db} · ma'lumotlar bazasi arxitekturasi`,
  intro: (name, db) => `Bu hujjat **${name}** sxemasini tasvirlaydi — ${db} uchun.`,
  counts: (tables, relationships, columns) => `Unda ==${tables} ta jadval==, ==${relationships} ta bog'lanish== va ${columns} ta ustun bor.`,
  generated: "Matn diagrammadan avtomatik tuzildi. Uni bemalol tahrirlang — har bir qism o'zgartiriladi.",
  central: (table, count) => `**Markaziy jadval — ${table}.** Unga ==${count} ta jadval== murojaat qiladi: uni o'zgartirishdan oldin bog'lanishlarni tekshiring.`,
  widest: (table, count) => `**Eng katta jadval — ${table}** (==${count} ta ustun==).`,
  stats: { tables: ["Jadval", "Diagrammada"], relationships: ["Bog'lanish", "Tashqi kalitlar"], columns: ["Ustun", "Barcha jadvallarda"], required: ["Majburiy", "NOT NULL ustunlar"] },
  glance: "Bir qarashda",
  rules: "Asosiy qoidalar",
  keyLabel: "Kalitlar",
  keyKinds: { "sequence-trigger": "sequence + trigger", identity: "IDENTITY", none: "ilova beradi" },
  foreignKeysLabel: "Tashqi kalitlar",
  foreignKeys: (count) => `==${count} ta==`,
  cascade: (count) => `${count} tasi CASCADE`,
  noForeignKeys: "jadvallar orasida yo'q",
  constraintsLabel: "Cheklovlar",
  unique: (count) => `${count} UNIQUE`,
  checks: (count) => `${count} CHECK`,
  defaults: (count) => `${count} DEFAULT`,
  er: "ER diagramma",
  erText: "Jadvallar va ular orasidagi bog'lanishlar — kanvasdagi kabi.",
  tablesTitle: "Jadvallar",
  heading: (table) => `### ${table} ustunlari`,
  columnsLabel: "Ustunlar",
  columnsFact: (columns, required) => `${columns} ta${required ? ` · ${required} tasi majburiy` : ""}`,
  key: "Kalit",
  noKey: "[[-birlamchi kalit yo'q]]",
  pointsTo: "Bog'lanadi →",
  pointedBy: "Murojaat qiladi ←",
  relationships: "Bog'lanishlar",
  relationshipsText: (count) => `Diagrammada ==${count} ta bog'lanish== bor; har birining qoidalari quyida.`,
  flow: "Ma'lumot oqimi",
  flowText: "Strelka asosiy jadvaldan unga bog'langan jadvalga qarab chizilgan:",
  order: "Yaratish tartibi",
  orderText: "Tashqi kalitlar ishlashi uchun jadvallar shu tartibda yaratiladi:",
  createdAfter: (table, parents) => `${table} — ${parents} dan keyin`,
  createdFirst: (table) => `${table} — [[+birinchi]] hech narsaga bog'liq emas`,
  review: "Tekshirish kerak bo'lgan joylar",
  error: "XATO",
  warning: "OGOHLANTIRISH",
  noComment: (table) => `${table} jadvaliga izoh yozilmagan.`,
  noCommentBadge: "IZOH YO'Q",
  clean: "**Hammasi joyida:** diagrammada xato topilmadi.",
  notes: "Izohlar",
};

const RU: Words = {
  kicker: (db) => `${db} · архитектура базы данных`,
  intro: (name, db) => `Документ описывает схему **${name}** для ${db}.`,
  counts: (tables, relationships, columns) => `В ней таблиц — ==${tables}==, связей — ==${relationships}==, столбцов — ${columns}.`,
  generated: "Текст составлен по диаграмме автоматически. Смело редактируйте — меняется любая часть.",
  central: (table, count) => `**Центральная таблица — ${table}.** На неё ссылаются ==${count} табл.==: перед изменением проверьте связи.`,
  widest: (table, count) => `**Самая большая таблица — ${table}** (==${count} столб.==).`,
  stats: { tables: ["Таблицы", "На диаграмме"], relationships: ["Связи", "Внешние ключи"], columns: ["Столбцы", "Во всех таблицах"], required: ["Обязательные", "Столбцы NOT NULL"] },
  glance: "Коротко",
  rules: "Основные правила",
  keyLabel: "Ключи",
  keyKinds: { "sequence-trigger": "sequence + trigger", identity: "IDENTITY", none: "задаёт приложение" },
  foreignKeysLabel: "Внешние ключи",
  foreignKeys: (count) => `==${count}==`,
  cascade: (count) => `${count} с CASCADE`,
  noForeignKeys: "между таблицами нет",
  constraintsLabel: "Ограничения",
  unique: (count) => `${count} UNIQUE`,
  checks: (count) => `${count} CHECK`,
  defaults: (count) => `${count} DEFAULT`,
  er: "ER-диаграмма",
  erText: "Таблицы и связи между ними — как на холсте.",
  tablesTitle: "Таблицы",
  heading: (table) => `### Столбцы ${table}`,
  columnsLabel: "Столбцы",
  columnsFact: (columns, required) => `${columns}${required ? ` · обязательных ${required}` : ""}`,
  key: "Ключ",
  noKey: "[[-нет первичного ключа]]",
  pointsTo: "Ссылается на →",
  pointedBy: "На неё ссылаются ←",
  relationships: "Связи",
  relationshipsText: (count) => `На диаграмме ==${count} связ.==; правила каждой — ниже.`,
  flow: "Поток данных",
  flowText: "Стрелка идёт от основной таблицы к таблице, которая на неё ссылается:",
  order: "Порядок создания",
  orderText: "Чтобы внешние ключи работали, таблицы создаются в таком порядке:",
  createdAfter: (table, parents) => `${table} — после ${parents}`,
  createdFirst: (table) => `${table} — [[+первой]] ни от чего не зависит`,
  review: "Что стоит проверить",
  error: "ОШИБКА",
  warning: "ВНИМАНИЕ",
  noComment: (table) => `У таблицы ${table} нет комментария.`,
  noCommentBadge: "НЕТ КОММЕНТАРИЯ",
  clean: "**Всё в порядке:** ошибок на диаграмме нет.",
  notes: "Заметки",
};

const EN: Words = {
  kicker: (db) => `${db} · database architecture`,
  intro: (name, db) => `This document describes the **${name}** schema, for ${db}.`,
  counts: (tables, relationships, columns) => `It has ==${plural(tables, "table", "tables")}==, ==${plural(relationships, "relationship", "relationships")}== and ${plural(columns, "column", "columns")}.`,
  generated: "Written from the diagram automatically. Edit it freely — every part can be changed.",
  central: (table, count) => `**The central table is ${table}.** ==${plural(count, "table refers", "tables refer")}== to it: check those links before changing it.`,
  widest: (table, count) => `**The largest table is ${table}** (==${plural(count, "column", "columns")}==).`,
  stats: { tables: ["Tables", "On the diagram"], relationships: ["Relationships", "Foreign keys"], columns: ["Columns", "Across all tables"], required: ["Required", "NOT NULL columns"] },
  glance: "At a glance",
  rules: "Main rules",
  keyLabel: "Keys",
  keyKinds: { "sequence-trigger": "sequence + trigger", identity: "IDENTITY", none: "set by the app" },
  foreignKeysLabel: "Foreign keys",
  foreignKeys: (count) => `==${count}==`,
  cascade: (count) => `${count} CASCADE`,
  noForeignKeys: "none between the tables",
  constraintsLabel: "Constraints",
  unique: (count) => `${count} UNIQUE`,
  checks: (count) => `${count} CHECK`,
  defaults: (count) => `${count} DEFAULT`,
  er: "ER diagram",
  erText: "The tables and how they connect — as on the canvas.",
  tablesTitle: "Tables",
  heading: (table) => `### ${table} columns`,
  columnsLabel: "Columns",
  columnsFact: (columns, required) => `${columns}${required ? ` · ${required} required` : ""}`,
  key: "Key",
  noKey: "[[-no primary key]]",
  pointsTo: "Refers to →",
  pointedBy: "Referred to by ←",
  relationships: "Relationships",
  relationshipsText: (count) => `The diagram has ==${plural(count, "relationship", "relationships")}==; the rules of each are below.`,
  flow: "Data flow",
  flowText: "Each arrow runs from a table to the table that refers to it:",
  order: "Creation order",
  orderText: "For the foreign keys to work, the tables are created in this order:",
  createdAfter: (table, parents) => `${table} — after ${parents}`,
  createdFirst: (table) => `${table} — [[+first]] depends on nothing`,
  review: "Worth checking",
  error: "ERROR",
  warning: "WARNING",
  noComment: (table) => `${table} has no comment.`,
  noCommentBadge: "NO COMMENT",
  clean: "**All clear:** no problems on the diagram.",
  notes: "Notes",
};

const WORDS: Record<DocLang, Words> = { uz: UZ, ru: RU, en: EN };
const AND: Record<DocLang, string> = { uz: "va", ru: "и", en: "and" };

/** Tables in an order where every table comes after the tables it refers to; a cycle keeps the rest in diagram order. */
function creationOrder(tables: Table[], parentsOf: Map<string, Set<string>>) {
  const done = new Set<string>();
  const order: Table[] = [];
  let progress = true;
  while (order.length < tables.length && progress) {
    progress = false;
    for (const table of tables) {
      if (done.has(table.id) || [...(parentsOf.get(table.id) ?? [])].some((parent) => parent !== table.id && !done.has(parent))) continue;
      done.add(table.id); order.push(table); progress = true;
    }
  }
  return [...order, ...tables.filter((table) => !done.has(table.id))];
}

/** The starting document for `schema`, in `lang`. */
export function draftDocument(input: Schema, lang: DocLang = "uz"): string {
  const words = WORDS[lang];
  const and = AND[lang];
  const postgres = input.dialect === "postgres";
  const db: Db = postgres ? "PostgreSQL" : "Oracle";
  const schema = normalizeRelationships(input);
  const tables = schema.tables;
  const relationships = schema.relationships ?? [];
  const name = (table: Table) => normalizeIdentifier(table.name);
  const byId = new Map(tables.map((table) => [table.id, table]));
  const parentsOf = new Map<string, Set<string>>();
  const childrenOf = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!parentsOf.has(rel.startTableId)) parentsOf.set(rel.startTableId, new Set());
    if (!childrenOf.has(rel.endTableId)) childrenOf.set(rel.endTableId, new Set());
    parentsOf.get(rel.startTableId)!.add(rel.endTableId);
    childrenOf.get(rel.endTableId)!.add(rel.startTableId);
  }
  const colorOf = (table: Table) => {
    const color = currentTableColor(table.color).a;
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "";
  };
  /** A table's name as a chip in its card's colour -- for headings and cards, where it should stand out. */
  const chip = (table: Table) => (colorOf(table) ? `**=={${colorOf(table)}}${name(table)}==**` : code(name(table)));
  /** The same name inside a sentence: bold words in the card's colour, lighter on the eye than a chip. */
  const ref = (table: Table) => (colorOf(table) ? `**!!{${colorOf(table)}}${name(table)}!!**` : code(name(table)));
  const names = (ids: Iterable<string>) => list([...ids].map((id) => byId.get(id)).filter((table): table is Table => Boolean(table)).map(ref), and);
  const columns = tables.flatMap((table) => table.columns);
  const degree = (table: Table) => (childrenOf.get(table.id)?.size ?? 0) + (parentsOf.get(table.id)?.size ?? 0);
  /** How a table's key is made, as PostgreSQL or Oracle makes it: PostgreSQL turns sequence + trigger into an identity. */
  const strategyOf = (table: Table): KeyStrategy => {
    const strategy = table.keyStrategy ?? "none";
    return postgres && strategy === "sequence-trigger" ? "identity" : strategy;
  };
  const kindBadge = (strategy: KeyStrategy) => (strategy === "none" ? `[[${words.keyKinds.none}]]` : `[[+${words.keyKinds[strategy]}]]`);

  const out: string[] = [`^ ${words.kicker(db)}`, `# ${schema.name}`, ""];
  out.push(`${words.intro(schema.name, db)} ${words.counts(tables.length, relationships.length, columns.length)}`, "");

  // The table the others lean on, or failing that the largest.
  const central = [...tables].sort((a, b) => (childrenOf.get(b.id)?.size ?? 0) - (childrenOf.get(a.id)?.size ?? 0))[0];
  const widest = [...tables].sort((a, b) => b.columns.length - a.columns.length)[0];
  if (central && childrenOf.get(central.id)?.size) out.push(`!> ${words.central(chip(central), childrenOf.get(central.id)!.size)}`, "");
  else if (widest) out.push(`!> ${words.widest(chip(widest), widest.columns.length)}`, "");

  if (tables.length) {
    const stat = ([title, text]: [string, string], value: number) => [`### ${value} | ${title}`, text];
    out.push(":::stats", ...stat(words.stats.tables, tables.length), ...stat(words.stats.relationships, relationships.length),
      ...stat(words.stats.columns, columns.length), ...stat(words.stats.required, columns.filter((column) => column.notNull).length), ":::", "");

    // Rules: one bold label per line, the kinds as badges.
    out.push(`## ${words.rules}`, "");
    const strategies: KeyStrategy[] = ["sequence-trigger", "identity", "none"];
    const byStrategy = new Map<KeyStrategy, Table[]>();
    for (const table of tables) {
      if (!primaryKeyColumns(table).length) continue;
      byStrategy.set(strategyOf(table), [...(byStrategy.get(strategyOf(table)) ?? []), table]);
    }
    for (const strategy of strategies) {
      const using = byStrategy.get(strategy);
      if (using?.length) out.push(`- **${words.keyLabel}:** ${kindBadge(strategy)} ${list(using.map(ref), and)}`);
    }
    const cascade = relationships.filter((rel) => rel.deleteConstraint === "Cascade").length;
    out.push(`- **${words.foreignKeysLabel}:** ${relationships.length ? `${words.foreignKeys(relationships.length)}${cascade ? ` [[-${words.cascade(cascade)}]]` : ""}` : words.noForeignKeys}`);
    const unique = columns.filter((column) => column.unique).length + tables.reduce((sum, table) => sum + (table.uniques?.length ?? 0), 0);
    const checks = columns.filter((column) => column.check.trim()).length;
    const defaults = columns.filter((column) => column.defaultValue.trim()).length;
    const constraints = [unique && `[[${words.unique(unique)}]]`, checks && `[[${words.checks(checks)}]]`, defaults && `[[${words.defaults(defaults)}]]`].filter(Boolean);
    if (constraints.length) out.push(`- **${words.constraintsLabel}:** ${constraints.join(" ")}`);
    out.push("");

    // Cards for the most connected tables.
    const key = [...tables].sort((a, b) => degree(b) - degree(a) || b.columns.length - a.columns.length).slice(0, 4);
    out.push(`## ${words.glance}`, "", ":::cards", ...key.flatMap((table) => {
      const pk = primaryKeyColumns(table).map((column) => normalizeIdentifier(column.name));
      const summary = `**${words.columnsLabel}:** ${words.columnsFact(table.columns.length, table.columns.filter((column) => column.notNull).length)}${pk.length ? ` · ${kindBadge(strategyOf(table))}` : ` · ${words.noKey}`}`;
      return [`### ${chip(table)}`, ...(pk.length ? [`\`${pk.join(", ")}\``] : []), table.comment?.trim() || summary];
    }), ":::", "");

    out.push(`## ${words.er}`, "", words.erText, "", "{{er}}", "");

    // One section per table: its comment, then one short labelled line per fact, then its columns.
    out.push(`## ${words.tablesTitle}`, "");
    tables.forEach((table, index) => {
      const pk = primaryKeyColumns(table).map((column) => code(normalizeIdentifier(column.name)));
      const facts = [
        `- **${words.columnsLabel}:** ${words.columnsFact(table.columns.length, table.columns.filter((column) => column.notNull).length)}`,
        `- **${words.key}:** ${pk.length ? `${pk.join(", ")} ${kindBadge(strategyOf(table))}` : words.noKey}`,
        ...(parentsOf.get(table.id)?.size ? [`- **${words.pointsTo}** ${names(parentsOf.get(table.id)!)}`] : []),
        ...(childrenOf.get(table.id)?.size ? [`- **${words.pointedBy}** ${names(childrenOf.get(table.id)!)}`] : []),
      ];
      if (index > 0) out.push("---", "");
      out.push(words.heading(chip(table)), "", ...(table.comment?.trim() ? [`>{${colorOf(table) || "#6366f1"}} ${table.comment.trim()}`, ""] : []), ...facts, "", `{{columns ${name(table)}}}`, "");
    });
  }

  if (relationships.length) {
    out.push(`## ${words.relationships}`, "", words.relationshipsText(relationships.length), "", "{{relationships}}", "");
    // The same links as a flow, parent to child; Mermaid ids are positional so any name is safe.
    const id = new Map(tables.map((table, index) => [table.id, `T${index + 1}`]));
    const linked = tables.filter((table) => degree(table) > 0);
    const edges = relationships.slice(0, 24).map((rel) => {
      const column = byId.get(rel.startTableId)?.columns.find((item) => item.id === rel.startFieldId);
      return `  ${id.get(rel.endTableId)} -->|${normalizeIdentifier(column?.name ?? "")}| ${id.get(rel.startTableId)}`;
    });
    out.push(`## ${words.flow}`, "", words.flowText, "", "```mermaid", "flowchart LR",
      ...linked.map((table) => `  ${id.get(table.id)}[${name(table)}]`), ...edges, "```", "");
  }

  if (tables.length > 1) {
    out.push(`## ${words.order}`, "", words.orderText, "");
    creationOrder(tables, parentsOf).forEach((table, index) => {
      const parents = [...(parentsOf.get(table.id) ?? [])].filter((parent) => parent !== table.id);
      out.push(`${index + 1}. ${parents.length ? words.createdAfter(ref(table), names(parents)) : words.createdFirst(ref(table))}`);
    });
    out.push("");
  }

  // What would stop the script -- in the diagram's database's own words -- then what a reader would miss.
  const found = postgres ? postgresIssues(input) : validateSchema(input);
  const issues = found.slice(0, 8).map((issue) => `- ${issue.severity === "error" ? `[[-${words.error}]]` : `[[{#d97706}${words.warning}]]`} ${issue.message}`);
  const silent = tables.filter((table) => !table.comment?.trim()).slice(0, 8).map((table) => `- [[{#d97706}${words.noCommentBadge}]] ${words.noComment(ref(table))}`);
  out.push(`## ${words.review}`, "", ...(issues.length || silent.length ? [...issues, ...silent] : [`!>+ ${words.clean}`]), "");

  const memos = (schema.memos ?? []).map((memo) => memo.text.trim()).filter(Boolean);
  if (memos.length) out.push(`## ${words.notes}`, "", ...memos.flatMap((text) => [`> ${text.replace(/\n+/g, " ")}`, ""]));
  out.push("---", "", `> ${words.generated}`);
  return out.join("\n");
}
