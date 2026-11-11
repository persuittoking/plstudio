import type { DocLang } from "@/app/lib/document-i18n";

/**
 * The Document editor's own interface -- menus, buttons, placeholders -- in the
 * document's language, so a writer works in the language they write in. The
 * page's words (table headings, sections, the draft) live in
 * `app/lib/document-i18n.ts`.
 */
export type GroupId = "text" | "layout" | "code" | "schema" | "sections";
export type ItemId =
  | "title" | "section" | "subsection" | "kicker" | "paragraph" | "note" | "callout" | "bullets" | "numbers"
  | "table" | "cards" | "stats" | "divider" | "code" | "diagram" | "er" | "columns" | "tables" | "relationships"
  | "s-intro" | "s-rule" | "s-callout" | "s-er" | "s-columns" | "s-problem" | "s-logic" | "s-flow" | "s-seed" | "s-compare" | "s-findings" | "s-rollout" | "s-questions" | "s-footnote";

export type EditorStrings = {
  groups: Record<GroupId, string>;
  items: Record<ItemId, [label: string, hint: string]>;
  insert: string;
  styles: { paragraph: string; note: string; callout: string };
  blocks: { label: string; paragraph: string; heading: (level: number) => string; kicker: string; note: string; info: string; tip: string; warning: string; danger: string; bullets: string; numbers: string; code: string };
  marks: { bold: string; italic: string; code: string; badge: string; badgeGood: string; badgeBad: string; highlight: string; highlightColors: string; textColor: string; textColors: string; clear: string };
  colors: { yellow: string; green: string; blue: string; pink: string; none: string };
  badges: { label: string; plain: string; good: string; bad: string; default: string };
  colorPicker: { choose: string; code: string; apply: string; default: string; names: Record<string, string> };
  noteColor: { label: string; default: string };
  lists: { bullets: string; numbers: string };
  history: { undo: string; redo: string };
  table: { label: string; rowAbove: string; rowBelow: string; columnLeft: string; columnRight: string; deleteRow: string; deleteColumn: string; deleteTable: string };
  handle: { add: string; actions: string; up: string; down: string; copy: string; remove: string };
  placeholders: { empty: string; line: string; title: string; section: string; subsection: string; note: string; callout: string; kicker: string; cardTitle: string; cardLead: string; cardText: string; statValue: string };
  nodes: { diagram: string; edit: string; done: string; emptyDiagram: string; drawing: string; diagramHelp: [string, string]; schema: Record<"er" | "columns" | "tables" | "relationships", string>; chooseTable: string; noTables: string; addCard: string; removeCard: string; code: string };
  slashEmpty: string;
  slashLabel: string;
  banner: string;
  start: string;
  versions: { missing: string; copy: (from: string) => string };
  editorLabel: string;
  flowSample: string;
};

const UZ: EditorStrings = {
  groups: { text: "Matn", layout: "Tuzilma", code: "Kod va diagramma", schema: "Sxemadan", sections: "Tayyor bo'limlar" },
  items: {
    title: ["Sarlavha", "Hujjatning bosh sarlavhasi"], section: ["Bo'lim sarlavhasi", "Yangi bo'lim"], subsection: ["Kichik sarlavha", "Bo'lim ichida"],
    kicker: ["Ustki qator", "Sarlavha ustidagi kichik qator"], paragraph: ["Matn", "Oddiy paragraf"], note: ["Izoh", "Kichikroq, xira matn"],
    callout: ["Muhim eslatma", "Esda qoladigan asosiy fikr"], bullets: ["Ro'yxat", "Belgili ro'yxat"], numbers: ["Raqamli ro'yxat", "Qadamlar ketma-ketligi"],
    table: ["Jadval", "Qator va ustunlar"], cards: ["Kartochkalar", "Asosiy kalitlar yonma-yon"], stats: ["Raqamli kartochkalar", "Son va tushuntirish"], divider: ["Ajratuvchi chiziq", "Sahifa bo'ylab chiziq"],
    code: ["Kod", "SQL, PL/SQL yoki boshqa kod"], diagram: ["Oqim diagrammasi", "Bloklar va o'qlar (Mermaid)"],
    er: ["ER diagramma", "Jadvallar va bog'lanishlar"], columns: ["Jadval ustunlari", "Ustun | Tur | Qoida | Vazifasi"], tables: ["Barcha jadvallar", "Har bir jadval ustunlari"], relationships: ["Bog'lanishlar", "Har bir bog'lanish va qoidalari"],
    "s-intro": ["Sarlavha va kirish", "Ustki qator, sarlavha, matn, izoh"], "s-rule": ["Qoida va kartochkalar", "Bo'lim, matn, to'rtta kartochka"], "s-callout": ["Asosiy xulosa", "Ajratilgan muhim fikr"],
    "s-er": ["ER diagramma bo'limi", "Sarlavha, belgilar, diagramma, izoh"], "s-columns": ["Jadval ustunlari bo'limi", "`JADVAL` ustunlari va jadvali"],
    "s-problem": ["Masala va yechim", "Sarlavha, matn, Masala | Yechim"], "s-logic": ["Mantiq va tekshiruvlar", "Matn, kod, Tekshiruv | Qayerda | Qachon | Manba"],
    "s-flow": ["Oqim bo'limi", "Sarlavha va diagramma"], "s-seed": ["SQL / seed", "Sarlavha, matn, SQL"], "s-compare": ["Taqqoslash", "Mavzu | v2 | v3"],
    "s-findings": ["Raqamlardagi topilmalar", "Sarlavha va raqamli kartochkalar"], "s-rollout": ["Joriy etish tartibi", "Sarlavha va qadamlar"],
    "s-questions": ["Ochiq savollar", "Sarlavha va ro'yxat"], "s-footnote": ["Izoh-manba", "Chiziq va kichik izoh"],
  },
  insert: "Qo'shish",
  styles: { paragraph: "Matn", note: "Izoh", callout: "Muhim" },
  blocks: { label: "Satr turi", paragraph: "Matn", heading: (level) => `Sarlavha ${level}`, kicker: "Ustki satr", note: "Izoh", info: "Muhim", tip: "Maslahat", warning: "Ogohlantirish", danger: "Xavf", bullets: "Ro'yxat", numbers: "Raqamli ro'yxat", code: "Kod bloki" },
  marks: { bold: "Qalin (Ctrl+B)", italic: "Kursiv (Ctrl+I)", code: "Kod (Ctrl+E)", badge: "Belgi", badgeGood: "Yashil belgi (YANGI)", badgeBad: "Qizil belgi", highlight: "Ajratish (Ctrl+Shift+H)", highlightColors: "Ajratish rangi", textColor: "Matn rangi", textColors: "Matn rangi", clear: "Formatni olib tashlash" },
  colors: { yellow: "Sariq", green: "Yashil", blue: "Ko'k", pink: "Pushti", none: "Rangsiz" },
  badges: { label: "Belgi", plain: "Ko'k", good: "Yashil (YANGI)", bad: "Qizil", default: "Odatiy" },
  noteColor: { label: "Izoh rangi", default: "Odatiy" },
  colorPicker: {
    choose: "Rangni tanlash", code: "Rang kodi", apply: "Qo'llash", default: "odatiy",
    names: { yellow: "Sariq", green: "Yashil", blue: "Ko'k", pink: "Pushti", red: "Qizil", orange: "To'q sariq", amber: "Qahrabo", lime: "Och yashil", emerald: "Zumrad", teal: "Moviy-yashil", cyan: "Moviy", indigo: "Indigo", violet: "Binafsha", fuchsia: "Fuksiya", brown: "Jigarrang", slate: "Kulrang" },
  },
  lists: { bullets: "Ro'yxat", numbers: "Raqamli ro'yxat" },
  history: { undo: "Bekor qilish (Ctrl+Z)", redo: "Qaytarish (Ctrl+Shift+Z)" },
  table: { label: "Jadval", rowAbove: "Qator yuqoriga", rowBelow: "Qator pastga", columnLeft: "Ustun chapga", columnRight: "Ustun o'ngga", deleteRow: "Qatorni o'chirish", deleteColumn: "Ustunni o'chirish", deleteTable: "Jadvalni o'chirish" },
  handle: { add: "Keyin blok qo'shish", actions: "Blok amallari (sudrab ko'chiring)", up: "Yuqoriga", down: "Pastga", copy: "Nusxa", remove: "O'chirish" },
  placeholders: { empty: "Yozishni boshlang yoki / bosing…", line: "/ bosing — element qo'shish", title: "Hujjat sarlavhasi", section: "Bo'lim sarlavhasi", subsection: "Kichik sarlavha", note: "Izoh…", callout: "Esda qolishi kerak bo'lgan asosiy fikr…", kicker: "CMS · DYNAMIC GRID · ARXITEKTURA", cardTitle: "Sarlavha", cardLead: "KEY = 'qiymat'", cardText: "Qisqa tushuntirish", statValue: "21" },
  nodes: { diagram: "Diagramma", edit: "Tahrirlash", done: "Tayyor", emptyDiagram: "Bo'sh diagramma — kodini yozing.", drawing: "Diagramma chizilmoqda…", diagramHelp: ["Har bir o'q bitta qadam", "O'qqa yozuv"], schema: { er: "ER diagramma — sxemadan", columns: "Jadval ustunlari — sxemadan", tables: "Barcha jadvallar — sxemadan", relationships: "Bog'lanishlar — sxemadan" }, chooseTable: "Jadvalni tanlang", noTables: "Diagrammada hali jadval yo'q.", addCard: "Kartochka qo'shish", removeCard: "Kartochkani o'chirish", code: "kod" },
  slashEmpty: "Hech narsa topilmadi",
  slashLabel: "Element qo'shish",
  banner: "Diagramma hujjatini yozing yoki hamma bo'limlari tayyor qoralamadan boshlang. ER diagramma va jadvallar ustunlari sxemadan to'ldiriladi.",
  start: "Diagrammadan boshlash",
  versions: { missing: "Hujjatning o'zbekcha varianti hali yo'q.", copy: (from) => `${from} variantidan nusxa` },
  editorLabel: "Hujjat matni",
  flowSample: "flowchart LR\n  A[Boshlanish] --> B[Qadam] --> C[Natija]",
};

const RU: EditorStrings = {
  groups: { text: "Текст", layout: "Структура", code: "Код и диаграммы", schema: "Из схемы", sections: "Готовые разделы" },
  items: {
    title: ["Заголовок", "Главный заголовок документа"], section: ["Заголовок раздела", "Новый раздел"], subsection: ["Подзаголовок", "Внутри раздела"],
    kicker: ["Надзаголовок", "Маленькая строка над заголовком"], paragraph: ["Текст", "Обычный абзац"], note: ["Примечание", "Мелкий приглушённый текст"],
    callout: ["Важное", "Главная мысль, которую стоит запомнить"], bullets: ["Список", "Маркированный список"], numbers: ["Нумерованный список", "Шаги по порядку"],
    table: ["Таблица", "Строки и столбцы"], cards: ["Карточки", "Ключевые факты рядом"], stats: ["Карточки с числами", "Число и пояснение"], divider: ["Разделитель", "Линия через страницу"],
    code: ["Код", "SQL, PL/SQL или другой код"], diagram: ["Блок-схема", "Блоки и стрелки (Mermaid)"],
    er: ["ER-диаграмма", "Таблицы и связи"], columns: ["Столбцы таблицы", "Столбец | Тип | Правило | Назначение"], tables: ["Все таблицы", "Столбцы каждой таблицы"], relationships: ["Связи", "Каждая связь и её правила"],
    "s-intro": ["Заголовок и введение", "Надзаголовок, заголовок, текст, примечание"], "s-rule": ["Правило и карточки", "Раздел, текст, четыре карточки"], "s-callout": ["Главный вывод", "Выделенная важная мысль"],
    "s-er": ["Раздел ER-диаграммы", "Заголовок, метки, диаграмма, примечание"], "s-columns": ["Раздел столбцов таблицы", "Столбцы `ТАБЛИЦЫ` и их таблица"],
    "s-problem": ["Проблема и решение", "Заголовок, текст, Проблема | Решение"], "s-logic": ["Логика и проверки", "Текст, код, Проверка | Где | Когда | Источник"],
    "s-flow": ["Раздел процесса", "Заголовок и диаграмма"], "s-seed": ["SQL / seed", "Заголовок, текст, SQL"], "s-compare": ["Сравнение", "Тема | v2 | v3"],
    "s-findings": ["Находки в цифрах", "Заголовок и карточки с числами"], "s-rollout": ["Порядок внедрения", "Заголовок и шаги"],
    "s-questions": ["Открытые вопросы", "Заголовок и список"], "s-footnote": ["Сноска-источник", "Линия и примечание"],
  },
  insert: "Добавить",
  styles: { paragraph: "Текст", note: "Примеч.", callout: "Важное" },
  blocks: { label: "Тип строки", paragraph: "Текст", heading: (level) => `Заголовок ${level}`, kicker: "Надзаголовок", note: "Примечание", info: "Важное", tip: "Совет", warning: "Предупреждение", danger: "Опасно", bullets: "Список", numbers: "Нумерованный список", code: "Блок кода" },
  marks: { bold: "Жирный (Ctrl+B)", italic: "Курсив (Ctrl+I)", code: "Код (Ctrl+E)", badge: "Метка", badgeGood: "Зелёная метка (НОВОЕ)", badgeBad: "Красная метка", highlight: "Выделить (Ctrl+Shift+H)", highlightColors: "Цвет выделения", textColor: "Цвет текста", textColors: "Цвет текста", clear: "Убрать форматирование" },
  colors: { yellow: "Жёлтый", green: "Зелёный", blue: "Синий", pink: "Розовый", none: "Без цвета" },
  badges: { label: "Метка", plain: "Синяя", good: "Зелёная (НОВОЕ)", bad: "Красная", default: "Обычная" },
  noteColor: { label: "Цвет примечания", default: "По умолчанию" },
  colorPicker: {
    choose: "Выбрать цвет", code: "Код цвета", apply: "Применить", default: "по умолчанию",
    names: { yellow: "Жёлтый", green: "Зелёный", blue: "Синий", pink: "Розовый", red: "Красный", orange: "Оранжевый", amber: "Янтарный", lime: "Лаймовый", emerald: "Изумрудный", teal: "Бирюзовый", cyan: "Голубой", indigo: "Индиго", violet: "Фиолетовый", fuchsia: "Фуксия", brown: "Коричневый", slate: "Серый" },
  },
  lists: { bullets: "Список", numbers: "Нумерованный список" },
  history: { undo: "Отменить (Ctrl+Z)", redo: "Повторить (Ctrl+Shift+Z)" },
  table: { label: "Таблица", rowAbove: "Строка выше", rowBelow: "Строка ниже", columnLeft: "Столбец слева", columnRight: "Столбец справа", deleteRow: "Удалить строку", deleteColumn: "Удалить столбец", deleteTable: "Удалить таблицу" },
  handle: { add: "Добавить блок ниже", actions: "Действия с блоком (перетащите)", up: "Выше", down: "Ниже", copy: "Копия", remove: "Удалить" },
  placeholders: { empty: "Начните писать или нажмите /…", line: "Нажмите / — добавить элемент", title: "Заголовок документа", section: "Заголовок раздела", subsection: "Подзаголовок", note: "Примечание…", callout: "Главная мысль, которую нужно запомнить…", kicker: "CMS · DYNAMIC GRID · АРХИТЕКТУРА", cardTitle: "Заголовок", cardLead: "KEY = 'значение'", cardText: "Краткое пояснение", statValue: "21" },
  nodes: { diagram: "Диаграмма", edit: "Изменить", done: "Готово", emptyDiagram: "Пустая диаграмма — напишите её код.", drawing: "Диаграмма рисуется…", diagramHelp: ["Каждая стрелка — один шаг", "Подпись на стрелке"], schema: { er: "ER-диаграмма — из схемы", columns: "Столбцы таблицы — из схемы", tables: "Все таблицы — из схемы", relationships: "Связи — из схемы" }, chooseTable: "Выберите таблицу", noTables: "В диаграмме ещё нет таблиц.", addCard: "Добавить карточку", removeCard: "Удалить карточку", code: "код" },
  slashEmpty: "Ничего не найдено",
  slashLabel: "Добавить элемент",
  banner: "Напишите документ к диаграмме или начните с черновика, где все разделы уже на месте. ER-диаграмма и столбцы таблиц заполняются из схемы.",
  start: "Начать с диаграммы",
  versions: { missing: "Русской версии документа ещё нет.", copy: (from) => `Копия версии ${from}` },
  editorLabel: "Текст документа",
  flowSample: "flowchart LR\n  A[Начало] --> B[Шаг] --> C[Результат]",
};

const EN: EditorStrings = {
  groups: { text: "Text", layout: "Layout", code: "Code and diagrams", schema: "From the schema", sections: "Ready-made sections" },
  items: {
    title: ["Title", "The document's main heading"], section: ["Section heading", "A new section"], subsection: ["Subheading", "Inside a section"],
    kicker: ["Kicker", "Small line above the title"], paragraph: ["Text", "A plain paragraph"], note: ["Note", "Smaller, quieter text"],
    callout: ["Key point", "The idea to remember"], bullets: ["Bulleted list", "Points in no order"], numbers: ["Numbered list", "Steps in order"],
    table: ["Table", "Rows and columns"], cards: ["Cards", "Key facts side by side"], stats: ["Number cards", "A number and its explanation"], divider: ["Divider", "A line across the page"],
    code: ["Code", "SQL, PL/SQL or other code"], diagram: ["Flow diagram", "Boxes and arrows (Mermaid)"],
    er: ["ER diagram", "Tables and relationships"], columns: ["Table columns", "Column | Type | Rule | Purpose"], tables: ["All tables", "Every table's columns"], relationships: ["Relationships", "Every link and its rules"],
    "s-intro": ["Title and intro", "Kicker, title, text, note"], "s-rule": ["Rule with cards", "Section, text, four cards"], "s-callout": ["Key takeaway", "A highlighted main point"],
    "s-er": ["ER diagram section", "Heading, legend, diagram, note"], "s-columns": ["Table columns section", "`TABLE` columns and their table"],
    "s-problem": ["Problem and solution", "Heading, text, Problem | Solution"], "s-logic": ["Logic and checks", "Text, code, Check | Where | When | Source"],
    "s-flow": ["Flow section", "Heading and a diagram"], "s-seed": ["SQL / seed", "Heading, text, SQL"], "s-compare": ["Comparison", "Topic | v2 | v3"],
    "s-findings": ["Findings in numbers", "Heading and number cards"], "s-rollout": ["Rollout plan", "Heading and steps"],
    "s-questions": ["Open questions", "Heading and a list"], "s-footnote": ["Footnote", "A line and a small note"],
  },
  insert: "Insert",
  styles: { paragraph: "Text", note: "Note", callout: "Key" },
  blocks: { label: "Line type", paragraph: "Text", heading: (level) => `Heading ${level}`, kicker: "Kicker", note: "Note", info: "Key point", tip: "Tip", warning: "Warning", danger: "Danger", bullets: "Bullet list", numbers: "Numbered list", code: "Code block" },
  marks: { bold: "Bold (Ctrl+B)", italic: "Italic (Ctrl+I)", code: "Code (Ctrl+E)", badge: "Badge", badgeGood: "Green badge (NEW)", badgeBad: "Red badge", highlight: "Highlight (Ctrl+Shift+H)", highlightColors: "Highlight colour", textColor: "Text colour", textColors: "Text colour", clear: "Clear formatting" },
  colors: { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", none: "No colour" },
  badges: { label: "Badge", plain: "Blue", good: "Green (NEW)", bad: "Red", default: "Default" },
  noteColor: { label: "Note colour", default: "Default" },
  colorPicker: {
    choose: "Choose a colour", code: "Colour code", apply: "Apply", default: "default",
    names: { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", red: "Red", orange: "Orange", amber: "Amber", lime: "Lime", emerald: "Emerald", teal: "Teal", cyan: "Cyan", indigo: "Indigo", violet: "Violet", fuchsia: "Fuchsia", brown: "Brown", slate: "Slate" },
  },
  lists: { bullets: "Bulleted list", numbers: "Numbered list" },
  history: { undo: "Undo (Ctrl+Z)", redo: "Redo (Ctrl+Shift+Z)" },
  table: { label: "Table", rowAbove: "Row above", rowBelow: "Row below", columnLeft: "Column left", columnRight: "Column right", deleteRow: "Delete row", deleteColumn: "Delete column", deleteTable: "Delete table" },
  handle: { add: "Add a block below", actions: "Block actions (drag to move)", up: "Move up", down: "Move down", copy: "Duplicate", remove: "Delete" },
  placeholders: { empty: "Start writing, or press /…", line: "Press / to add an element", title: "Document title", section: "Section heading", subsection: "Subheading", note: "Note…", callout: "The main idea to remember…", kicker: "CMS · DYNAMIC GRID · ARCHITECTURE", cardTitle: "Title", cardLead: "KEY = 'value'", cardText: "A short explanation", statValue: "21" },
  nodes: { diagram: "Diagram", edit: "Edit", done: "Done", emptyDiagram: "Empty diagram — write its code.", drawing: "Drawing the diagram…", diagramHelp: ["Each arrow is one step", "A label on an arrow"], schema: { er: "ER diagram — from the schema", columns: "Table columns — from the schema", tables: "All tables — from the schema", relationships: "Relationships — from the schema" }, chooseTable: "Choose a table", noTables: "The diagram has no tables yet.", addCard: "Add card", removeCard: "Remove card", code: "code" },
  slashEmpty: "Nothing found",
  slashLabel: "Add an element",
  banner: "Write this diagram's document, or start from a draft with every section in place. The ER diagram and each table's columns are filled in from the schema.",
  start: "Start from the diagram",
  versions: { missing: "This document has no English version yet.", copy: (from) => `Copy the ${from} version` },
  editorLabel: "Document text",
  flowSample: "flowchart LR\n  A[Start] --> B[Step] --> C[Result]",
};

export const EDITOR_STRINGS: Record<DocLang, EditorStrings> = { uz: UZ, ru: RU, en: EN };
export const editorStrings = (lang: DocLang) => EDITOR_STRINGS[lang];
