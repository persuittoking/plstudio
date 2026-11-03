import type { DocLang } from "@/app/lib/document-i18n";
import { normalizeIdentifier, normalizeRelationships, primaryKeyColumns, type KeyStrategy, type Schema, type Table } from "@/app/lib/schema";
import { validateSchema } from "@/app/lib/validation";

/**
 * The document a diagram starts with: written from the diagram itself, not
 * prompts to fill in. It counts what is there, says how keys are made, which
 * table points at which and in what order they are created, and lists what the
 * validator would flag -- in the document's language and with the same
 * highlights and blocks a person would use, so every part stays editable.
 */

type Words = {
  kicker: string;
  intro: (name: string, tables: number, relationships: number, columns: number) => string;
  generated: string;
  central: (table: string, count: number) => string;
  widest: (table: string, count: number) => string;
  stats: { tables: [string, string]; relationships: [string, string]; columns: [string, string]; required: [string, string] };
  rules: string;
  keys: Record<KeyStrategy, (tables: string) => string>;
  foreignKeys: (count: number, cascade: number) => string;
  noForeignKeys: string;
  unique: (count: number) => string;
  checks: (count: number) => string;
  defaults: (count: number) => string;
  er: string;
  erText: string;
  heading: (table: string) => string;
  facts: (columns: number, key: string, strategy: KeyStrategy) => string;
  noKey: (columns: number) => string;
  pointsTo: (targets: string) => string;
  pointedBy: (sources: string) => string;
  relationships: string;
  relationshipsText: (count: number) => string;
  flow: string;
  flowText: string;
  order: string;
  orderText: string;
  createdAfter: (table: string, parents: string) => string;
  createdFirst: (table: string) => string;
  review: string;
  noComment: (table: string) => string;
  clean: string;
  notes: string;
};

const code = (name: string) => `\`${name}\``;
const list = (names: string[], and: string) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const UZ: Words = {
  kicker: "Ma'lumotlar bazasi · arxitektura",
  intro: (name, tables, relationships, columns) => `Bu hujjat **${name}** sxemasini tasvirlaydi: ==${tables} ta jadval==, ==${relationships} ta bog'lanish== va jami ${columns} ta ustun.`,
  generated: "Matn diagrammadan avtomatik tuzildi — uni o'zingizga moslab tahrirlang: har bir qism o'zgartiriladi.",
  central: (table, count) => `**Eng muhimi:** markaziy jadval — ${table}. Unga ==${count} ta jadval== murojaat qiladi, shuning uchun uni o'zgartirishdan oldin bog'lanishlarni tekshiring.`,
  widest: (table, count) => `**Eng muhimi:** eng katta jadval — ${table} (==${count} ta ustun==).`,
  stats: { tables: ["Jadval", "Diagrammadagi jadvallar"], relationships: ["Bog'lanish", "Tashqi kalitlar"], columns: ["Ustun", "Barcha jadvallarda"], required: ["Majburiy", "NOT NULL ustunlar"] },
  rules: "Asosiy qoidalar",
  keys: {
    "sequence-trigger": (tables) => `${tables} — ID !!+sequence va trigger!! orqali beriladi.`,
    identity: (tables) => `${tables} — ID !!+IDENTITY!! ustuni bilan beriladi.`,
    none: (tables) => `${tables} — kalit qiymatini !!~ilova o'zi!! beradi.`,
  },
  foreignKeys: (count, cascade) => `Tashqi kalitlar: ==${count} ta==${cascade ? `, shundan ${cascade} tasi o'chirishda !!-CASCADE!!` : ""}.`,
  noForeignKeys: "Jadvallar orasida tashqi kalit yo'q.",
  unique: (count) => `Noyoblik cheklovlari: ${count} ta.`,
  checks: (count) => `CHECK shartlari: ${count} ta.`,
  defaults: (count) => `Standart qiymatli ustunlar: ${count} ta.`,
  er: "ER diagramma",
  erText: "Jadvallar va ular orasidagi bog'lanishlar — kanvasdagi kabi.",
  heading: (table) => `### ${code(table)} ustunlari`,
  facts: (columns, key, strategy) => `${columns} ta ustun, kalit ${key}${strategy === "none" ? "" : ` (!!+${strategy === "identity" ? "IDENTITY" : "sequence + trigger"}!!)`}.`,
  noKey: (columns) => `${columns} ta ustun, !!-birlamchi kalit yo'q!!.`,
  pointsTo: (targets) => `${targets} jadvaliga bog'lanadi.`,
  pointedBy: (sources) => `${sources} unga murojaat qiladi.`,
  relationships: "Bog'lanishlar",
  relationshipsText: (count) => `Diagrammada ==${count} ta bog'lanish== bor; har birining qoidalari quyida.`,
  flow: "Ma'lumot oqimi",
  flowText: "Strelka asosiy jadvaldan unga bog'langan jadvalga qarab chizilgan:",
  order: "Yaratish tartibi",
  orderText: "Tashqi kalitlar ishlashi uchun jadvallar shu tartibda yaratiladi:",
  createdAfter: (table, parents) => `${table} — ${parents} dan keyin`,
  createdFirst: (table) => `${table} — hech narsaga bog'liq emas`,
  review: "Tekshirish kerak bo'lgan joylar",
  noComment: (table) => `${table} jadvaliga ==izoh yozilmagan==.`,
  clean: "==Hammasi joyida==: diagrammada xato topilmadi.",
  notes: "Izohlar",
};

const RU: Words = {
  kicker: "База данных · архитектура",
  intro: (name, tables, relationships, columns) => `Документ описывает схему **${name}**: таблиц — ==${tables}==, связей — ==${relationships}==, столбцов — ${columns}.`,
  generated: "Текст составлен по диаграмме автоматически — отредактируйте его под себя: меняется любая часть.",
  central: (table, count) => `**Главное:** центральная таблица — ${table}. На неё ссылаются ==${count} табл.==, поэтому перед изменением проверьте связи.`,
  widest: (table, count) => `**Главное:** самая большая таблица — ${table} (==${count} столб.==).`,
  stats: { tables: ["Таблицы", "На диаграмме"], relationships: ["Связи", "Внешние ключи"], columns: ["Столбцы", "Во всех таблицах"], required: ["Обязательные", "Столбцы NOT NULL"] },
  rules: "Основные правила",
  keys: {
    "sequence-trigger": (tables) => `${tables} — ID выдаётся через !!+sequence и trigger!!.`,
    identity: (tables) => `${tables} — ID выдаёт столбец !!+IDENTITY!!.`,
    none: (tables) => `${tables} — значение ключа задаёт !!~само приложение!!.`,
  },
  foreignKeys: (count, cascade) => `Внешних ключей: ==${count}==${cascade ? `, из них с !!-CASCADE!! при удалении: ${cascade}` : ""}.`,
  noForeignKeys: "Внешних ключей между таблицами нет.",
  unique: (count) => `Ограничений уникальности: ${count}.`,
  checks: (count) => `Условий CHECK: ${count}.`,
  defaults: (count) => `Столбцов со значением по умолчанию: ${count}.`,
  er: "ER-диаграмма",
  erText: "Таблицы и связи между ними — как на холсте.",
  heading: (table) => `### Столбцы ${code(table)}`,
  facts: (columns, key, strategy) => `Столбцов: ${columns}, ключ ${key}${strategy === "none" ? "" : ` (!!+${strategy === "identity" ? "IDENTITY" : "sequence + trigger"}!!)`}.`,
  noKey: (columns) => `Столбцов: ${columns}, !!-первичного ключа нет!!.`,
  pointsTo: (targets) => `Ссылается на ${targets}.`,
  pointedBy: (sources) => `На неё ссылаются: ${sources}.`,
  relationships: "Связи",
  relationshipsText: (count) => `На диаграмме ==${count} связ.==; правила каждой — ниже.`,
  flow: "Поток данных",
  flowText: "Стрелка идёт от основной таблицы к таблице, которая на неё ссылается:",
  order: "Порядок создания",
  orderText: "Чтобы внешние ключи работали, таблицы создаются в таком порядке:",
  createdAfter: (table, parents) => `${table} — после ${parents}`,
  createdFirst: (table) => `${table} — ни от чего не зависит`,
  review: "Что стоит проверить",
  noComment: (table) => `У таблицы ${table} ==нет комментария==.`,
  clean: "==Всё в порядке==: ошибок на диаграмме нет.",
  notes: "Заметки",
};

const EN: Words = {
  kicker: "Database · architecture",
  intro: (name, tables, relationships, columns) => `This document describes the **${name}** schema: ==${plural(tables, "table", "tables")}==, ==${plural(relationships, "relationship", "relationships")}== and ${plural(columns, "column", "columns")} in all.`,
  generated: "Written from the diagram automatically — edit it to suit you: every part can be changed.",
  central: (table, count) => `**Key point:** the central table is ${table}. ==${plural(count, "table refers", "tables refer")}== to it, so check those links before changing it.`,
  widest: (table, count) => `**Key point:** the largest table is ${table} (==${plural(count, "column", "columns")}==).`,
  stats: { tables: ["Tables", "On the diagram"], relationships: ["Relationships", "Foreign keys"], columns: ["Columns", "Across all tables"], required: ["Required", "NOT NULL columns"] },
  rules: "Main rules",
  keys: {
    "sequence-trigger": (tables) => `${tables} — IDs come from a !!+sequence and trigger!!.`,
    identity: (tables) => `${tables} — IDs come from an !!+IDENTITY!! column.`,
    none: (tables) => `${tables} — the key value is set by !!~the application!!.`,
  },
  foreignKeys: (count, cascade) => `Foreign keys: ==${count}==${cascade ? `, ${cascade} of them !!-CASCADE!! on delete` : ""}.`,
  noForeignKeys: "There are no foreign keys between the tables.",
  unique: (count) => `Unique constraints: ${count}.`,
  checks: (count) => `CHECK conditions: ${count}.`,
  defaults: (count) => `Columns with a default value: ${count}.`,
  er: "ER diagram",
  erText: "The tables and how they connect — as on the canvas.",
  heading: (table) => `### ${code(table)} columns`,
  facts: (columns, key, strategy) => `${plural(columns, "column", "columns")}, key ${key}${strategy === "none" ? "" : ` (!!+${strategy === "identity" ? "IDENTITY" : "sequence + trigger"}!!)`}.`,
  noKey: (columns) => `${plural(columns, "column", "columns")}, !!-no primary key!!.`,
  pointsTo: (targets) => `Refers to ${targets}.`,
  pointedBy: (sources) => `Referred to by ${sources}.`,
  relationships: "Relationships",
  relationshipsText: (count) => `The diagram has ==${plural(count, "relationship", "relationships")}==; the rules of each are below.`,
  flow: "Data flow",
  flowText: "Each arrow runs from a table to the table that refers to it:",
  order: "Creation order",
  orderText: "For the foreign keys to work, the tables are created in this order:",
  createdAfter: (table, parents) => `${table} — after ${parents}`,
  createdFirst: (table) => `${table} — depends on nothing`,
  review: "Worth checking",
  noComment: (table) => `${table} has ==no comment==.`,
  clean: "==All clear==: no problems on the diagram.",
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
  const names = (ids: Iterable<string>) => list([...ids].map((id) => byId.get(id)).filter((table): table is Table => Boolean(table)).map((table) => code(name(table))), and);
  const columns = tables.flatMap((table) => table.columns);
  const degree = (table: Table) => (childrenOf.get(table.id)?.size ?? 0) + (parentsOf.get(table.id)?.size ?? 0);

  const out: string[] = [`^ ${words.kicker}`, `# ${schema.name}`, ""];
  out.push(words.intro(schema.name, tables.length, relationships.length, columns.length), "", `> ${words.generated}`, "");

  // The table the others lean on, or failing that the largest.
  const central = [...tables].sort((a, b) => (childrenOf.get(b.id)?.size ?? 0) - (childrenOf.get(a.id)?.size ?? 0))[0];
  const widest = [...tables].sort((a, b) => b.columns.length - a.columns.length)[0];
  if (central && childrenOf.get(central.id)?.size) out.push(`!> ${words.central(code(name(central)), childrenOf.get(central.id)!.size)}`, "");
  else if (widest) out.push(`!> ${words.widest(code(name(widest)), widest.columns.length)}`, "");

  if (tables.length) {
    const stat = ([title, text]: [string, string], value: number) => [`### ${value} | ${title}`, text];
    out.push(":::stats", ...stat(words.stats.tables, tables.length), ...stat(words.stats.relationships, relationships.length),
      ...stat(words.stats.columns, columns.length), ...stat(words.stats.required, columns.filter((column) => column.notNull).length), ":::", "");

    // Rules: how keys are made, and the constraints that hold the data together.
    out.push(`## ${words.rules}`, "");
    const strategies: KeyStrategy[] = ["sequence-trigger", "identity", "none"];
    for (const strategy of strategies) {
      const using = tables.filter((table) => (table.keyStrategy ?? "none") === strategy && primaryKeyColumns(table).length);
      if (using.length) out.push(`- ${words.keys[strategy](list(using.map((table) => code(name(table))), and))}`);
    }
    out.push(`- ${relationships.length ? words.foreignKeys(relationships.length, relationships.filter((rel) => rel.deleteConstraint === "Cascade").length) : words.noForeignKeys}`);
    const unique = columns.filter((column) => column.unique).length + tables.reduce((sum, table) => sum + (table.uniques?.length ?? 0), 0);
    if (unique) out.push(`- ${words.unique(unique)}`);
    const checks = columns.filter((column) => column.check.trim()).length;
    if (checks) out.push(`- ${words.checks(checks)}`);
    const defaults = columns.filter((column) => column.defaultValue.trim()).length;
    if (defaults) out.push(`- ${words.defaults(defaults)}`);
    out.push("");

    // Cards for the most connected tables.
    const key = [...tables].sort((a, b) => degree(b) - degree(a) || b.columns.length - a.columns.length).slice(0, 4);
    out.push(":::cards", ...key.flatMap((table) => {
      const pk = primaryKeyColumns(table).map((column) => normalizeIdentifier(column.name));
      const summary = [words.facts(table.columns.length, pk.map(code).join(", ") || "—", table.keyStrategy ?? "none")];
      return [`### ${name(table)}`, ...(pk.length ? [`\`${pk.join(", ")}\``] : []), table.comment?.trim() || summary[0]];
    }), ":::", "");

    out.push(`## ${words.er}`, "", words.erText, "", "{{er}}", "");

    // One section per table: its comment, what it is made of and what it connects to.
    for (const table of tables) {
      const pk = primaryKeyColumns(table).map((column) => code(normalizeIdentifier(column.name)));
      const facts = [pk.length ? words.facts(table.columns.length, pk.join(", "), table.keyStrategy ?? "none") : words.noKey(table.columns.length)];
      if (parentsOf.get(table.id)?.size) facts.push(words.pointsTo(names(parentsOf.get(table.id)!)));
      if (childrenOf.get(table.id)?.size) facts.push(words.pointedBy(names(childrenOf.get(table.id)!)));
      out.push(words.heading(name(table)), "", ...(table.comment?.trim() ? [table.comment.trim(), ""] : []), facts.join(" "), "", `{{columns ${name(table)}}}`, "");
    }
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
      out.push(`${index + 1}. ${parents.length ? words.createdAfter(`**${code(name(table))}**`, names(parents)) : words.createdFirst(`**${code(name(table))}**`)}`);
    });
    out.push("");
  }

  // What would stop the DDL, then what a reader would miss.
  const issues = validateSchema(input).slice(0, 8).map((issue) => `- ${issue.severity === "error" ? "[[-ERROR]]" : "[[WARNING]]"} ${issue.message}`);
  const silent = tables.filter((table) => !table.comment?.trim()).slice(0, 8).map((table) => `- ${words.noComment(code(name(table)))}`);
  out.push(`## ${words.review}`, "", ...(issues.length || silent.length ? [...issues, ...silent] : [words.clean]), "");

  const memos = (schema.memos ?? []).map((memo) => memo.text.trim()).filter(Boolean);
  if (memos.length) out.push(`## ${words.notes}`, "", ...memos.flatMap((text) => [`> ${text.replace(/\n+/g, " ")}`, ""]));
  return out.join("\n");
}
