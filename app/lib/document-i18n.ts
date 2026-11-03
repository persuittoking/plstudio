import { normalizeIdentifier, type Cardinality, type Schema } from "@/app/lib/schema";

/**
 * The words the document writes on its own -- table headings, messages, the
 * starter draft and the ready-made sections -- in each language the Document
 * tab offers. Text a person typed is never translated; only these.
 *
 * The language is stored in the document text itself as a `{{lang ru}}` line,
 * so the preview, every export and a collaborator all see the same choice.
 * Uzbek is the default and writes no line, which keeps older documents as
 * they were.
 */
export type DocLang = "uz" | "ru" | "en";
export const DEFAULT_LANG: DocLang = "uz";
export const DOC_LANGUAGES: { id: DocLang; label: string; short: string }[] = [
  { id: "uz", label: "O'zbek", short: "UZ" },
  { id: "ru", label: "Русский", short: "RU" },
  { id: "en", label: "English", short: "EN" },
];

const LANG_LINE = /^[ \t]*\{\{\s*lang\s+([a-z]{2})\s*\}\}[ \t]*$/i;
const isLang = (value: string | undefined): value is DocLang => value === "uz" || value === "ru" || value === "en";

/**
 * Each language's own version of the document, in the order they were added.
 * Stored as one text, each version opened by its `{{lang xx}}` line; text
 * before the first line (every document written before versions existed) is
 * the Uzbek one. A single Uzbek version writes no line at all.
 */
export type DocVersions = { order: DocLang[]; texts: Partial<Record<DocLang, string>> };

export function splitVersions(source: string): DocVersions {
  const order: DocLang[] = [];
  const lines: Partial<Record<DocLang, string[]>> = {};
  let current: DocLang | null = null;
  source.replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    const marker = line.match(LANG_LINE)?.[1];
    if (isLang(marker)) {
      current = marker;
      if (!lines[marker]) { order.push(marker); lines[marker] = []; }
      return;
    }
    if (!current) {
      if (!line.trim() && !lines[DEFAULT_LANG]) return;
      current = DEFAULT_LANG;
      if (!lines[current]) { order.push(current); lines[current] = []; }
    }
    lines[current]!.push(line);
  });
  const texts: Partial<Record<DocLang, string>> = {};
  order.forEach((lang) => { const text = lines[lang]!.join("\n").trim(); texts[lang] = text ? `${text}\n` : ""; });
  return { order, texts };
}

export function joinVersions({ order, texts }: DocVersions): string {
  const kept = order.filter((lang) => texts[lang] !== undefined);
  if (!kept.length) return "";
  if (kept.length === 1 && kept[0] === DEFAULT_LANG) return texts[DEFAULT_LANG] ?? "";
  return kept.map((lang) => `{{lang ${lang}}}\n\n${(texts[lang] ?? "").trim()}`).join("\n\n") + "\n";
}

/** The language a document opens in: its first version. */
export const documentLanguage = (source: string): DocLang => splitVersions(source).order[0] ?? DEFAULT_LANG;
/** One language's version, or "" when it has none. */
export const versionText = (source: string, lang: DocLang) => splitVersions(source).texts[lang] ?? "";
export const hasVersion = (source: string, lang: DocLang) => splitVersions(source).texts[lang] !== undefined;
/** `source` with `lang`'s version set to `body`, added after the others when it is new. */
export function setVersion(source: string, lang: DocLang, body: string): string {
  const versions = splitVersions(source);
  if (!versions.order.includes(lang)) versions.order.push(lang);
  versions.texts[lang] = body;
  return joinVersions(versions);
}
/** The text of the version it opens in: what the editor shows by default. */
export const withoutLanguage = (source: string) => versionText(source, documentLanguage(source));
/** A document holding only `body`, in `lang`. */
export const withLanguage = (lang: DocLang, body: string) => joinVersions({ order: [lang], texts: { [lang]: body } });

type Section = "intro" | "rule" | "callout" | "er" | "columns" | "problem" | "logic" | "flow" | "seed" | "compare" | "findings" | "rollout" | "questions" | "footnote";

export type PageStrings = {
  columnHeaders: [string, string, string, string];
  relationshipHeaders: [string, string, string, string, string, string];
  cardinality: Record<Cardinality, string>;
  drawing: string;
  noTables: string;
  noRelationships: string;
  missingTable: string;
  /** A table's columns heading, in the stored format: the name goes in as `code`. */
  columnsHeading: (name: string) => string;
  sections: Record<Section, (schema: Schema) => string>;
};

const firstTable = (schema: Schema) => (schema.tables[0] ? normalizeIdentifier(schema.tables[0].name) : "");
const cards = (titles: string[], lead: string, text: string) => [":::cards", ...titles.flatMap((title) => [`### ${title}`, `\`${lead}\``, text]), ":::"].join("\n");
const table = (headers: string[], rows: string[][]) =>
  [`| ${headers.join(" | ")} |`, `|${" --- |".repeat(headers.length)}`, ...rows.map((row) => `| ${row.map((cell) => cell || " ").join(" | ")} |`)].join("\n");
const blank = (columns: number, rows = 2) => Array.from({ length: rows }, () => Array(columns).fill(""));
const join = (...parts: string[]) => parts.join("\n\n");

const UZ: PageStrings = {
  columnHeaders: ["Ustun", "Tur", "Qoida", "Vazifasi"],
  relationshipHeaders: ["Nomi", "Ustun", "Murojaat", "Turi", "O'chirishda", "Yangilashda"],
  cardinality: { many_to_one: "ko'p → bitta", one_to_many: "bitta → ko'p", one_to_one: "bitta → bitta" },
  drawing: "Diagramma chizilmoqda…",
  noTables: "Diagrammada hali jadval yo'q.",
  noRelationships: "Bog'lanishlar yo'q.",
  missingTable: "Jadval topilmadi",
  columnsHeading: (name) => `\`${name}\` ustunlari`,
  sections: {
    intro: (schema) => join("^ Ma'lumotlar bazasi · arxitektura", `# ${schema.name}`, "Bu hujjat nima haqida ekanini bir-ikki gapda yozing.", "> Qo'shimcha izoh: nima uchun aynan shu yechim tanlangani."),
    rule: () => join("## Qoida: …", "Qoidani bir-ikki gapda tushuntiring.", cards(["Grid", "Amal", "Ruxsat", "Yorliq va maydon"], "KEY = 'qiymat'", "Qisqa tushuntirish.")),
    callout: () => "!> **Eng muhimi:** o'quvchi eslab qolishi kerak bo'lgan bitta fikrni yozing.",
    er: () => join("## ER diagramma", "[[+YANGI]] yangi jadvallar · [[BOR]] o'zgarmaydigan jadvallar", "{{er}}", "> Jadvallar qanday bog'langanini qisqa yozing."),
    columns: (schema) => join(`### \`${firstTable(schema) || "JADVAL"}\` ustunlari`, `{{columns ${firstTable(schema)}}}`),
    problem: () => join("### Ikonka: `JADVAL`", "Mavzuni qisqa tushuntiring.", table(["Masala", "Yechim"], blank(2))),
    logic: () => join("## Tugma qachon faol bo'ladi", "Qoida qanday ishlashini tushuntiring.", "```text\ngranted  = …\nenabled  = granted AND …\n```", table(["Tekshiruv", "Qayerda", "Qachon", "Manba"], blank(4)), "> Qo'shimcha izoh."),
    flow: () => join("## Gridgacha yo'l", "```mermaid\nflowchart LR\n  A[Jadval] --> B[Build] --> C[Sahifa]\n  C -->|MODAL / PAGE| D[go url]\n  C -->|JS| E[onGridAction]\n```"),
    seed: () => join("## Seed: bitta fayl, ikkala baza", "Skript nima qilishini yozing.", "```sql\nmerge into …\nusing (select … from dual) s\n   on (…)\n when matched then update set …\n when not matched then insert (…) values (…);\n```"),
    compare: () => join("## v2 dan v3 ga nima o'zgardi", table(["Mavzu", "v2", "v3"], [["", "[[-eski]]", "[[+yangi]]"], ["", "", ""]]), "> Muqobil variant va nega rad etilgani."),
    findings: () => join("## Bazada topilgan, avval tuzatiladigan narsalar", ":::stats\n### 21 | Sarlavha\nTushuntirish.\n### 39 | Sarlavha\nTushuntirish.\n:::"),
    rollout: () => join("## Joriy etish tartibi", "1. **Birinchi qadam**: …\n2. **Ikkinchi qadam**: …"),
    questions: () => join("## Hal qilinishi kerak bo'lgan savollar", "- …"),
    footnote: () => join("---", "> Manba: …"),
  },
};

const RU: PageStrings = {
  columnHeaders: ["Столбец", "Тип", "Правило", "Назначение"],
  relationshipHeaders: ["Имя", "Столбец", "Ссылка", "Тип", "При удалении", "При изменении"],
  cardinality: { many_to_one: "многие → один", one_to_many: "один → многие", one_to_one: "один → один" },
  drawing: "Диаграмма рисуется…",
  noTables: "В диаграмме ещё нет таблиц.",
  noRelationships: "Связей нет.",
  missingTable: "Таблица не найдена",
  columnsHeading: (name) => `Столбцы \`${name}\``,
  sections: {
    intro: (schema) => join("^ База данных · архитектура", `# ${schema.name}`, "Опишите в одном-двух предложениях, о чём этот документ.", "> Дополнительно: почему выбрано именно это решение."),
    rule: () => join("## Правило: …", "Объясните правило в одном-двух предложениях.", cards(["Грид", "Действие", "Доступ", "Метка и поле"], "KEY = 'значение'", "Краткое пояснение.")),
    callout: () => "!> **Главное:** одна мысль, которую читатель должен запомнить.",
    er: () => join("## ER-диаграмма", "[[+НОВАЯ]] новые таблицы · [[ЕСТЬ]] таблицы без изменений", "{{er}}", "> Кратко опишите, как связаны таблицы."),
    columns: (schema) => join(`### Столбцы \`${firstTable(schema) || "ТАБЛИЦА"}\``, `{{columns ${firstTable(schema)}}}`),
    problem: () => join("### Иконка: `ТАБЛИЦА`", "Кратко опишите тему.", table(["Проблема", "Решение"], blank(2))),
    logic: () => join("## Когда кнопка активна", "Объясните, как работает правило.", "```text\ngranted  = …\nenabled  = granted AND …\n```", table(["Проверка", "Где", "Когда", "Источник"], blank(4)), "> Дополнительное пояснение."),
    flow: () => join("## Путь до грида", "```mermaid\nflowchart LR\n  A[Таблица] --> B[Build] --> C[Страница]\n  C -->|MODAL / PAGE| D[go url]\n  C -->|JS| E[onGridAction]\n```"),
    seed: () => join("## Seed: один файл, обе базы", "Опишите, что делает скрипт.", "```sql\nmerge into …\nusing (select … from dual) s\n   on (…)\n when matched then update set …\n when not matched then insert (…) values (…);\n```"),
    compare: () => join("## Что изменилось с v2 на v3", table(["Тема", "v2", "v3"], [["", "[[-старое]]", "[[+новое]]"], ["", "", ""]]), "> Альтернатива и почему от неё отказались."),
    findings: () => join("## Найдено в базе: что исправить сначала", ":::stats\n### 21 | Заголовок\nПояснение.\n### 39 | Заголовок\nПояснение.\n:::"),
    rollout: () => join("## Порядок внедрения", "1. **Первый шаг**: …\n2. **Второй шаг**: …"),
    questions: () => join("## Открытые вопросы", "- …"),
    footnote: () => join("---", "> Источник: …"),
  },
};

const EN: PageStrings = {
  columnHeaders: ["Column", "Type", "Rule", "Purpose"],
  relationshipHeaders: ["Name", "Column", "References", "Kind", "On delete", "On update"],
  cardinality: { many_to_one: "many → one", one_to_many: "one → many", one_to_one: "one → one" },
  drawing: "Drawing the diagram…",
  noTables: "The diagram has no tables yet.",
  noRelationships: "No relationships.",
  missingTable: "Table not found",
  columnsHeading: (name) => `\`${name}\` columns`,
  sections: {
    intro: (schema) => join("^ Database · architecture", `# ${schema.name}`, "Say in a sentence or two what this document is about.", "> Note: why this particular solution was chosen."),
    rule: () => join("## Rule: …", "Explain the rule in a sentence or two.", cards(["Grid", "Action", "Permission", "Label and field"], "KEY = 'value'", "A short explanation.")),
    callout: () => "!> **Key point:** the one idea the reader should remember.",
    er: () => join("## ER diagram", "[[+NEW]] new tables · [[EXISTING]] unchanged tables", "{{er}}", "> Say briefly how the tables connect."),
    columns: (schema) => join(`### \`${firstTable(schema) || "TABLE"}\` columns`, `{{columns ${firstTable(schema)}}}`),
    problem: () => join("### Icon: `TABLE`", "Explain the topic briefly.", table(["Problem", "Solution"], blank(2))),
    logic: () => join("## When the button is enabled", "Explain how the rule works.", "```text\ngranted  = …\nenabled  = granted AND …\n```", table(["Check", "Where", "When", "Source"], blank(4)), "> A further note."),
    flow: () => join("## Path to the grid", "```mermaid\nflowchart LR\n  A[Table] --> B[Build] --> C[Page]\n  C -->|MODAL / PAGE| D[go url]\n  C -->|JS| E[onGridAction]\n```"),
    seed: () => join("## Seed: one file, both databases", "Say what the script does.", "```sql\nmerge into …\nusing (select … from dual) s\n   on (…)\n when matched then update set …\n when not matched then insert (…) values (…);\n```"),
    compare: () => join("## What changed from v2 to v3", table(["Topic", "v2", "v3"], [["", "[[-old]]", "[[+new]]"], ["", "", ""]]), "> The alternative, and why it was rejected."),
    findings: () => join("## Found in the database: fix these first", ":::stats\n### 21 | Title\nExplanation.\n### 39 | Title\nExplanation.\n:::"),
    rollout: () => join("## Rollout plan", "1. **First step**: …\n2. **Second step**: …"),
    questions: () => join("## Open questions", "- …"),
    footnote: () => join("---", "> Source: …"),
  },
};

export const PAGE_STRINGS: Record<DocLang, PageStrings> = { uz: UZ, ru: RU, en: EN };
export const pageStrings = (lang: DocLang) => PAGE_STRINGS[lang];
