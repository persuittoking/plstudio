"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor, Range } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as ProseNode } from "@tiptap/pm/model";
import {
  ArrowDownIcon,
  BanIcon,
  CheckIcon,
  StickyNoteIcon,
  ChevronDownIcon,
  ArrowUpIcon,
  BoldIcon,
  CodeIcon,
  CopyIcon,
  GripVerticalIcon,
  HighlighterIcon,
  BaselineIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  PlusIcon,
  Redo2Icon,
  RemoveFormattingIcon,
  TableIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { documentCss, type DocumentTheme } from "@/app/lib/documentation";
import type { DocLang } from "@/app/lib/document-i18n";
import { fromTiptap, toTiptap } from "@/app/lib/document-tiptap";
import { isHexColor, parseHexColor } from "@/app/lib/doc-colors";
import type { Schema } from "@/app/lib/schema";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { filterItems, insertGroups, type InsertItem } from "./commands";
import { editorStrings, type EditorStrings } from "./editor-i18n";
import { EditorEnvironmentContext, HIGHLIGHT_COLORS, documentExtensions, type HighlightColor } from "./extensions";
import { CodeCompletion, acceptCompletion, completionKey, type CompletionState } from "./code-complete";
import { TableColors, tableColorsKey } from "./table-colors";
import { SlashCommand, type SlashBridge, type SlashState } from "./slash-command";

/**
 * The Document tab's editor: Tiptap, styled by the exported page's own CSS so
 * what is typed is what is downloaded. Text comes in and goes out in the
 * stored format (`fromTiptap`/`toTiptap`); everything between is the editor's.
 */
export function DocumentEditor({
  value,
  onChange,
  schema,
  theme,
  readOnly,
  lang,
}: {
  value: string;
  onChange: (text: string) => void;
  schema: Schema;
  theme: DocumentTheme;
  readOnly: boolean;
  lang: DocLang;
}) {
  const langRef = useRef(lang);
  langRef.current = lang;
  const words = editorStrings(lang);
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** The text this editor last produced, so its own echo is not loaded back in. */
  const lastText = useRef(value);

  /* ---- `/` menu: the plugin reports through the bridge, React draws it */
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef<{ state: SlashState | null; index: number }>({ state: null, index: 0 });
  const bridge = useMemo<SlashBridge>(() => ({
    open: (state) => {
      const index = slashRef.current.state ? Math.min(slashRef.current.index, Math.max(0, state.items.length - 1)) : 0;
      slashRef.current = { state, index };
      setSlash(state);
      setSlashIndex(index);
    },
    close: () => { slashRef.current = { state: null, index: 0 }; setSlash(null); },
    key: (event) => {
      const { state, index } = slashRef.current;
      if (!state) return false;
      const count = state.items.length;
      // Every key the menu takes stops here: Escape would close the dialog around the editor, Tab move its focus on.
      if (event.key === "Escape") { event.stopPropagation(); bridge.close(); return true; }
      if (!count) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const next = (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
        slashRef.current.index = next;
        setSlashIndex(next);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") { event.stopPropagation(); state.select(state.items[index]); return true; }
      return false;
    },
    run: (editor: Editor, range: Range, item: InsertItem) => {
      editor.chain().focus().deleteRange(range).run();
      item.run(editor, schemaRef.current);
    },
    filter: (query) => filterItems(query, langRef.current),
  }), []);

  const editor = useEditor({
    extensions: [...documentExtensions(() => langRef.current), SlashCommand.configure({ bridge }), CodeCompletion.configure({ schema: () => schemaRef.current }), TableColors.configure({ schema: () => schemaRef.current })],
    content: toTiptap(value),
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: { attributes: { class: "doc-editor-content", spellcheck: "true", "aria-label": words.editorLabel } },
    onUpdate: ({ editor: current }) => {
      const text = fromTiptap(current.getJSON());
      if (text === lastText.current) return;
      lastText.current = text;
      onChangeRef.current(text);
    },
  });

  // A change from elsewhere (a collaborator, version history) replaces the content; the editor's own echo does not.
  useEffect(() => {
    if (!editor || value === lastText.current) return;
    lastText.current = value;
    // After React's commit, not inside it: the node views redraw with flushSync, which React refuses mid-render.
    queueMicrotask(() => { if (!editor.isDestroyed) editor.commands.setContent(toTiptap(value), { emitUpdate: false }); });
  }, [editor, value]);
  useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);
  // A table renamed or recoloured on the canvas: redraw the table names in the text.
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(tableColorsKey, true)); }, [editor, schema]);
  // A new language relabels the placeholders, which are drawn on the next transaction.
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("aria-label", editorStrings(lang).editorLabel);
    editor.view.dispatch(editor.state.tr.setMeta("documentLanguage", lang));
  }, [editor, lang]);

  const environment = useMemo(() => ({ schema, theme, readOnly, lang }), [schema, theme, readOnly, lang]);

  return (
    <EditorEnvironmentContext.Provider value={environment}>
      {/* The exported page's own stylesheet, so the editor draws what is downloaded; the editor's chrome is in globals.css. */}
      <style>{documentCss(theme)}</style>
      <div className="flex min-h-0 flex-col gap-2">
        {editor && !readOnly && <Toolbar editor={editor} schema={schema} words={words} lang={lang} />}
        <div className="relative min-h-0">
          <div className="doc doc-editor max-h-[60vh] overflow-y-auto rounded-xl border" data-theme={theme}>
            <div className="page">
              <EditorContent editor={editor} className="doc-editor-host" />
            </div>
          </div>
          {editor && !readOnly && <SelectionToolbar editor={editor} words={words} />}
          {editor && !readOnly && <BlockHandle editor={editor} words={words} />}
          {editor && !readOnly && <CompletionMenu editor={editor} />}
          {slash && <SlashMenu state={slash} index={slashIndex} words={words} onHover={(index) => { slashRef.current.index = index; setSlashIndex(index); }} />}
        </div>
      </div>
    </EditorEnvironmentContext.Provider>
  );
}

/* ------------------------------------------------------------- toolbar */

const ToolButton = ({ label, active, onPress, children, disabled }: { label: string; active?: boolean; onPress: () => void; children: ReactNode; disabled?: boolean }) => (
  <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active} isDisabled={disabled} className={cn(active && "bg-(--fill-2) text-foreground")} onPress={onPress}>
    {children}
  </Button>
);
const Sep = () => <span className="mx-1 h-5 w-px bg-border" />;

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** A shortcut as this computer writes it: `Mod-Alt-1` is ⌘⌥1 on a Mac, Ctrl+Alt+1 elsewhere. */
const keys = (shortcut: string) =>
  shortcut.split("-").map((key) => (MAC ? { Mod: "⌘", Alt: "⌥", Shift: "⇧" }[key] ?? key.toUpperCase() : key === "Mod" ? "Ctrl" : key.length === 1 ? key.toUpperCase() : key)).join(MAC ? "" : "+");

type BlockKind = { id: string; label: string; shortcut?: string; sample: ReactNode; apply: (editor: Editor) => void; active: (editor: Editor) => boolean };

/** Turns the line into a block, out of any list first, so every kind can follow every other. */
const become = (editor: Editor, type: string, attrs?: Record<string, unknown>) => editor.chain().focus().clearNodes().setNode(type, attrs).run();
const calloutSample = (color: string, text: string) => (
  <span className="block rounded-md border-l-[3px] px-2 py-0.5 text-[13px] font-medium" style={{ borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>{text}</span>
);

/** Every kind of line the text can be, each drawn as it looks on the page. */
const blockKinds = (words: EditorStrings): BlockKind[] => [
  { id: "p", label: words.blocks.paragraph, shortcut: "Mod-Alt-0", sample: <span className="text-[13px]">{words.blocks.paragraph}</span>, apply: (editor) => become(editor, "paragraph"), active: (editor) => editor.isActive("paragraph") && !editor.isActive("listItem") },
  ...([1, 2, 3] as const).map((level): BlockKind => ({
    id: `h${level}`, label: words.blocks.heading(level), shortcut: `Mod-Alt-${level}`,
    sample: <span className={cn("font-bold", level === 1 ? "text-[19px]" : level === 2 ? "text-[16px]" : "text-[14px]")}>{words.blocks.heading(level)}</span>,
    apply: (editor) => become(editor, "heading", { level }), active: (editor) => editor.isActive("heading", { level }),
  })),
  { id: "kicker", label: words.blocks.kicker, sample: <span className="text-[11px] font-semibold tracking-wider text-primary uppercase" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{words.blocks.kicker}</span>, apply: (editor) => become(editor, "kicker"), active: (editor) => editor.isActive("kicker") },
  { id: "note", label: words.blocks.note, sample: <span className="text-[12.5px] text-muted-foreground">{words.blocks.note}</span>, apply: (editor) => become(editor, "note"), active: (editor) => editor.isActive("note") },
  ...([["", words.blocks.info, "var(--primary)"], ["tip", words.blocks.tip, "var(--system-green)"], ["warning", words.blocks.warning, "var(--system-orange)"], ["danger", words.blocks.danger, "var(--destructive)"]] as const).map(([tone, label, color]): BlockKind => ({
    id: `callout-${tone || "info"}`, label, sample: calloutSample(color, label),
    apply: (editor) => become(editor, "callout", { tone }), active: (editor) => editor.isActive("callout", { tone }),
  })),
  { id: "bullets", label: words.blocks.bullets, shortcut: "Mod-Shift-8", sample: <span className="flex items-center gap-1.5 text-[13px]"><ListIcon className="size-4" />{words.blocks.bullets}</span>, apply: (editor) => editor.chain().focus().toggleBulletList().run(), active: (editor) => editor.isActive("bulletList") },
  { id: "numbers", label: words.blocks.numbers, shortcut: "Mod-Shift-7", sample: <span className="flex items-center gap-1.5 text-[13px]"><ListOrderedIcon className="size-4" />{words.blocks.numbers}</span>, apply: (editor) => editor.chain().focus().toggleOrderedList().run(), active: (editor) => editor.isActive("orderedList") },
  { id: "code", label: words.blocks.code, shortcut: "Mod-Alt-c", sample: <span className="flex items-center gap-1.5 text-[12.5px]" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}><CodeIcon className="size-4" />{words.blocks.code}</span>, apply: (editor) => become(editor, "codeBlock"), active: (editor) => editor.isActive("codeBlock") },
];

/**
 * The kind of the line the cursor is on, as one button that opens every kind:
 * text, three headings, the kicker line, a note, four callouts, two lists and
 * code. Each choice is drawn the way it looks on the page, with its shortcut.
 */
function BlockMenu({ editor, words }: { editor: Editor; words: EditorStrings }) {
  const kinds = useMemo(() => blockKinds(words), [words]);
  const active = useEditorState({ editor, selector: ({ editor: current }) => kinds.map((kind) => kind.active(current)) });
  const current = kinds.find((_, index) => active[index]);
  const groups = [kinds.slice(0, 4), kinds.slice(4, 6), kinds.slice(6, 10), kinds.slice(10)];
  return (
    <DropdownMenuTrigger>
      <Button variant="ghost" size="sm" aria-label={words.blocks.label} className="min-w-[118px] justify-between">
        <span className="truncate">{current?.label ?? words.blocks.paragraph}</span>
        <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
      </Button>
      <DropdownMenu
        aria-label={words.blocks.label}
        className="max-h-[60vh] w-72"
        selectionMode="single"
        selectedKeys={current ? [current.id] : []}
        onAction={(key) => kinds.find((kind) => kind.id === key)?.apply(editor)}
      >
        {groups.map((group, index) => (
          <DropdownMenuGroup key={index}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.map((kind) => (
              <DropdownMenuItem key={kind.id} id={kind.id} textValue={kind.label}>
                <span className="min-w-0 flex-1">{kind.sample}</span>
                {kind.shortcut && <DropdownMenuShortcut>{keys(kind.shortcut)}</DropdownMenuShortcut>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}

/** Marks shared by the toolbar and the selection toolbar. */
const markButtons = (words: EditorStrings) => [
  { label: words.marks.bold, icon: <BoldIcon />, run: (editor: Editor) => editor.chain().focus().toggleBold().run(), active: (editor: Editor) => editor.isActive("bold") },
  { label: words.marks.italic, icon: <ItalicIcon />, run: (editor: Editor) => editor.chain().focus().toggleItalic().run(), active: (editor: Editor) => editor.isActive("italic") },
  { label: words.marks.code, icon: <CodeIcon />, run: (editor: Editor) => editor.chain().focus().toggleCode().run(), active: (editor: Editor) => editor.isActive("code") },
];

/**
 * The swatch colours, as on the page's light theme. Hex on purpose: these are
 * the document's colours, not the app's -- a chosen one is saved into the text
 * as its code (`=={#ff8800}…==`) and drawn by the exported page, which cannot
 * read the app's tokens.
 */
const SWATCH: Record<HighlightColor, string> = { yellow: "#facc15", green: "#34d399", blue: "#60a5fa", pink: "#f472b6" };
/** The text-colour swatches, readable on the light toolbar. */
const TEXT_SWATCH: Record<HighlightColor, string> = { yellow: "#d97706", green: "#16a34a", blue: "#2563eb", pink: "#db2777" };
type ColorMark = "highlight" | "textColor";

type PickerOption = { id: string; label: string; swatch: ReactNode; active: boolean; pick: () => void };
type CustomColor = { value: string; apply: (hex: string) => void; words: EditorStrings["colorPicker"] };

/**
 * One toolbar button that opens a small panel of choices: the colours of a
 * highlight, of coloured words, or of a badge. The button shows the colour in
 * use under its icon. The swatches never take focus, so the selection being
 * formatted stays selected (and the selection bubble stays open); the colour
 * code field does take it, and Tiptap keeps the selection for when it applies.
 */
/** Tells every other colour panel to close: only one is open at a time. */
const PICKER_OPENED = "doc-picker-opened";

function Picker({ label, icon, current, options, extra, custom, none }: {
  label: string; icon: ReactNode; current?: string; options: PickerOption[]; extra?: PickerOption[]; custom?: CustomColor; none?: PickerOption;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  // Opening this panel closes any other one -- the highlight's, the text colour's, the badge's, the note's.
  useEffect(() => {
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setOpen(false); };
    document.addEventListener(PICKER_OPENED, other);
    return () => document.removeEventListener(PICKER_OPENED, other);
  }, [id]);
  useEffect(() => {
    if (open) document.dispatchEvent(new CustomEvent(PICKER_OPENED, { detail: id }));
  }, [id, open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const choose = (option: PickerOption) => { option.pick(); setOpen(false); };
  const swatchButton = (option: PickerOption, size: string) => (
    <Button
      key={option.id}
      variant="ghost"
      preventFocusOnPress
      aria-label={option.label}
      aria-pressed={option.active}
      onPress={() => choose(option)}
      className={cn("rounded-lg p-0", size, option.active && "bg-(--fill-2) ring-1 ring-foreground/30")}
    >
      {option.swatch}
    </Button>
  );
  return (
    <div ref={box} className="relative">
      <Button
        variant="ghost"
        size="sm"
        preventFocusOnPress
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
        className={cn("gap-0.5 px-1.5 text-muted-foreground [&_svg]:size-4", open && "bg-(--fill-2) text-foreground")}
      >
        <span className="flex flex-col items-center">
          {icon}
          <span className={cn("mt-0.5 h-[3px] w-4 rounded-full", !current && "ring-1 ring-(--separator) ring-inset")} style={current ? { background: current } : undefined} />
        </span>
        <ChevronDownIcon className="size-3! opacity-60" />
      </Button>
      {open && (
        <div role="menu" aria-label={label} className="absolute top-full left-0 z-40 mt-1 flex w-max flex-col gap-1.5 rounded-xl border bg-popover p-1.5 shadow-xl">
          <div className="flex items-center gap-1">
            {options.map((option) => swatchButton(option, "size-8"))}
            {none && <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />}
            {none && swatchButton(none, "size-8 text-muted-foreground hover:text-foreground [&_svg]:size-4")}
          </div>
          {extra && <div className="grid grid-cols-6 gap-1 border-t pt-1.5">{extra.map((option) => swatchButton(option, "size-7"))}</div>}
          {custom && <CustomColorRow custom={custom} close={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
}

/** The colour chooser and the code field: the code of the colour in use, which a person can also type. */
function CustomColorRow({ custom, close }: { custom: CustomColor; close: () => void }) {
  const [text, setText] = useState(custom.value);
  useEffect(() => setText(custom.value), [custom.value]);
  const parsed = parseHexColor(text);
  const apply = (hex: string | null) => { if (hex) { custom.apply(hex); close(); } };
  return (
    <div className="flex items-center gap-1.5 border-t pt-1.5">
      <label className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg ring-1 ring-border" title={custom.words.choose} style={{ background: parsed ?? custom.value }}>
        <input type="color" aria-label={custom.words.choose} value={parsed ?? custom.value} onChange={(event) => setText(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <Input
        aria-label={custom.words.code}
        aria-invalid={!parsed && Boolean(text)}
        value={text}
        spellCheck={false}
        maxLength={7}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); apply(parsed); } }}
        className="h-7 w-[86px] px-2 font-mono text-xs! uppercase"
        placeholder="#FF8800"
      />
      <Button size="xs" isDisabled={!parsed} onPress={() => apply(parsed)}>
        {custom.words.apply}
      </Button>
    </div>
  );
}

/** More colours, beyond the four that follow the theme; each is saved as its code. */
const EXTRA_COLORS: [string, string][] = [
  ["#ef4444", "red"], ["#f97316", "orange"], ["#f59e0b", "amber"], ["#84cc16", "lime"], ["#10b981", "emerald"], ["#14b8a6", "teal"],
  ["#06b6d4", "cyan"], ["#6366f1", "indigo"], ["#8b5cf6", "violet"], ["#d946ef", "fuchsia"], ["#92400e", "brown"], ["#64748b", "slate"],
];

/** A marker-pen highlight, or coloured words: theme colours, more colours, or any colour by its code. */
function ColorPicker({ editor, words, mark }: { editor: Editor; words: EditorStrings; mark: ColorMark }) {
  const color = useEditorState({ editor, selector: ({ editor: current }) => (current.isActive(mark) ? String(current.getAttributes(mark).color ?? "") : "") });
  const highlight = mark === "highlight";
  const palette = highlight ? SWATCH : TEXT_SWATCH;
  /** The colour in use as a code: a theme colour shows the swatch it is drawn with here. */
  const code = isHexColor(color) ? color : color in palette ? palette[color as HighlightColor] : "";
  /*
   * With nothing chosen yet, the panel starts on the default colour -- yellow
   * for a highlight, blue for coloured words -- rather than on "none": that is
   * the one the button shows and the first click applies.
   */
  const fallback: HighlightColor = highlight ? "yellow" : "blue";
  const shown = color || fallback;
  const set = (value: string) => editor.chain().focus().setMark(mark, { color: value }).run();
  const swatch = (value: string) => highlight
    ? <span className="size-5 rounded-full ring-1 ring-black/10" style={{ background: value }} />
    : <span className="text-[17px] leading-none font-extrabold" style={{ color: value }}>A</span>;
  return (
    <Picker
      label={highlight ? words.marks.highlightColors : words.marks.textColors}
      icon={highlight ? <HighlighterIcon /> : <BaselineIcon />}
      current={code || palette[fallback]}
      options={HIGHLIGHT_COLORS.map((preset) => ({
        id: preset,
        label: preset === fallback && !color ? `${words.colors[preset]} · ${words.colorPicker.default}` : words.colors[preset],
        active: shown === preset,
        pick: () => set(preset),
        swatch: swatch(palette[preset]),
      }))}
      extra={EXTRA_COLORS.map(([hex, name]) => ({
        id: hex, label: `${words.colorPicker.names[name] ?? name} · ${hex.toUpperCase()}`, active: color === hex, pick: () => set(hex),
        swatch: highlight ? <span className="size-4.5 rounded-full ring-1 ring-black/10" style={{ background: hex }} /> : <span className="text-[15px] leading-none font-extrabold" style={{ color: hex }}>A</span>,
      }))}
      custom={{ value: (code || palette[fallback]).toUpperCase(), apply: set, words: words.colorPicker }}
      // Taking a colour off stays possible, but it is never what the panel starts on.
      none={color ? { id: "none", label: words.colors.none, active: false, pick: () => editor.chain().focus().unsetMark(mark).run(), swatch: <BanIcon /> } : undefined}
    />
  );
}

/** A note's own colours: the default first, then four more; any other is picked or typed below them. */
const NOTE_DEFAULT = "#6366f1";
const NOTE_COLORS: [string, string][] = [["#eab308", "yellow"], ["#16a34a", "green"], ["#2563eb", "blue"], ["#db2777", "pink"]];

/** The colour of the note the cursor is in. A note always has one: the default until another is chosen. */
function NoteColorPicker({ editor, words }: { editor: Editor; words: EditorStrings }) {
  const color = useEditorState({ editor, selector: ({ editor: current }) => String(current.getAttributes("note").color ?? "") });
  const set = (value: string | null) => editor.chain().focus().updateAttributes("note", { color: value }).run();
  const bar = (value: string) => <span className="h-5 w-5 rounded-md border-l-[4px]" style={{ borderColor: value, background: `${value}26` }} />;
  return (
    <Picker
      label={words.noteColor.label}
      icon={<StickyNoteIcon />}
      current={color || NOTE_DEFAULT}
      options={[
        { id: "default", label: `${words.noteColor.default} · ${NOTE_DEFAULT.toUpperCase()}`, active: !color, pick: () => set(null), swatch: bar(NOTE_DEFAULT) },
        ...NOTE_COLORS.map(([hex, name]) => ({ id: hex, label: `${words.colorPicker.names[name] ?? words.colors[name as HighlightColor] ?? name} · ${hex.toUpperCase()}`, active: color === hex, pick: () => set(hex), swatch: bar(hex) })),
      ]}
      extra={EXTRA_COLORS.map(([hex, name]) => ({ id: hex, label: `${words.colorPicker.names[name] ?? name} · ${hex.toUpperCase()}`, active: color === hex, pick: () => set(hex), swatch: bar(hex) }))}
      custom={{ value: (color || NOTE_DEFAULT).toUpperCase(), apply: (hex) => set(hex.toLowerCase()), words: words.colorPicker }}
    />
  );
}

// `color` follows the theme; `hex` is the same colour as a code, for the labels and the colour field.
const BADGES = [
  { tone: "", color: "var(--primary)", hex: "#007aff", word: "plain" },
  { tone: "good", color: "var(--system-green)", hex: "#34c759", word: "good" },
  { tone: "bad", color: "var(--destructive)", hex: "#ff3b30", word: "bad" },
] as const;

/** The three badges ([[BOR]], [[+YANGI]], [[-x]]) in one picker. */
function BadgePicker({ editor, words }: { editor: Editor; words: EditorStrings }) {
  const tone = useEditorState({ editor, selector: ({ editor: current }) => (current.isActive("badge") ? String(current.getAttributes("badge").tone ?? "") : null) });
  const set = (value: string) => editor.chain().focus().setMark("badge", { tone: value }).run();
  const shown = BADGES.find((badge) => badge.tone === tone)?.color ?? (tone && /^#/.test(tone) ? tone : undefined);
  const shownHex = BADGES.find((badge) => badge.tone === tone)?.hex ?? (tone && /^#/.test(tone) ? tone : undefined);
  const swatch = (color: string) => <TagIcon className="size-4!" style={{ color }} />;
  return (
    <Picker
      label={words.badges.label}
      icon={<TagIcon />}
      current={shown}
      // The default badge comes first: a badge always has a colour, so there is no "no colour".
      options={BADGES.map((badge) => ({
        id: badge.word,
        label: badge.word === "plain" ? `${words.badges.default} · ${badge.hex.toUpperCase()}` : words.badges[badge.word],
        active: tone === badge.tone,
        pick: () => set(badge.tone),
        swatch: swatch(badge.color),
      }))}
      extra={EXTRA_COLORS.map(([hex, name]) => ({ id: hex, label: `${words.colorPicker.names[name] ?? name} · ${hex.toUpperCase()}`, active: tone === hex, pick: () => set(hex), swatch: swatch(hex) }))}
      custom={{ value: (shownHex ?? BADGES[0].hex).toUpperCase(), apply: (hex) => set(hex.toLowerCase()), words: words.colorPicker }}
    />
  );
}

function InsertMenu({ editor, schema, words, lang }: { editor: Editor; schema: Schema; words: EditorStrings; lang: DocLang }) {
  return (
    <DropdownMenuTrigger>
      <Button variant="outline" size="sm"><PlusIcon data-icon="inline-start" />{words.insert}</Button>
      <DropdownMenu placement="bottom start" className="max-h-[60vh] w-auto min-w-80">
        {insertGroups(lang).map((group, index) => (
          <DropdownMenuGroup key={group.group}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group.group}</DropdownMenuLabel>
            {group.items.map((item) => (
              <DropdownMenuItem key={item.id} textValue={item.label} onAction={() => item.run(editor, schema)}>
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}

function Toolbar({ editor, schema, words, lang }: { editor: Editor; schema: Schema; words: EditorStrings; lang: DocLang }) {
  const marks = markButtons(words);
  // Re-render on selection and content changes, so active states follow the cursor.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      marks: marks.map((mark) => mark.active(current)),
      table: current.isActive("table"),
      note: current.isActive("note"),
      undo: current.can().undo(),
      redo: current.can().redo(),
    }),
  });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-0.5 rounded-xl border bg-(--fill-4) p-1">
        <InsertMenu editor={editor} schema={schema} words={words} lang={lang} />
        <Sep />
        <BlockMenu editor={editor} words={words} />
        {state.note && <NoteColorPicker editor={editor} words={words} />}
        <Sep />
        {marks.map((mark, index) => <ToolButton key={mark.label} label={mark.label} active={state.marks[index]} onPress={() => mark.run(editor)}>{mark.icon}</ToolButton>)}
        <Sep />
        <BadgePicker editor={editor} words={words} />
        <ColorPicker editor={editor} words={words} mark="highlight" />
        <ColorPicker editor={editor} words={words} mark="textColor" />
        <Sep />
        <ToolButton label={words.history.undo} disabled={!state.undo} onPress={() => editor.chain().focus().undo().run()}><Undo2Icon /></ToolButton>
        <ToolButton label={words.history.redo} disabled={!state.redo} onPress={() => editor.chain().focus().redo().run()}><Redo2Icon /></ToolButton>
      </div>
      {state.table && (
        <div className="flex flex-wrap items-center gap-0.5 rounded-xl border bg-(--fill-4) p-1 text-xs" role="group" aria-label={words.table.label}>
          <TableIcon className="mx-1.5 size-4 text-muted-foreground" />
          {[
            [words.table.rowAbove, () => editor.chain().focus().addRowBefore().run()],
            [words.table.rowBelow, () => editor.chain().focus().addRowAfter().run()],
            [words.table.columnLeft, () => editor.chain().focus().addColumnBefore().run()],
            [words.table.columnRight, () => editor.chain().focus().addColumnAfter().run()],
            [words.table.deleteRow, () => editor.chain().focus().deleteRow().run()],
            [words.table.deleteColumn, () => editor.chain().focus().deleteColumn().run()],
          ].map(([label, run]) => (
            <Button key={label as string} variant="ghost" size="xs" onPress={run as () => void}>{label as string}</Button>
          ))}
          <Button variant="ghost" size="xs" className="text-destructive" onPress={() => editor.chain().focus().deleteTable().run()}>{words.table.deleteTable}</Button>
        </div>
      )}
    </div>
  );
}

/**
 * A button that never takes focus: the menu hides when the editor blurs, so a
 * focusing press would close it before the click lands.
 */
const BubbleButton = ({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) => (
  <Button
    variant="ghost"
    size="icon-sm"
    preventFocusOnPress
    aria-label={label}
    aria-pressed={active}
    onPress={onClick}
    className={cn("rounded-lg text-muted-foreground [&_svg]:size-4", active && "bg-(--fill-2) text-foreground")}
  >
    {children}
  </Button>
);

/** Formatting next to a text selection. */
function SelectionToolbar({ editor, words }: { editor: Editor; words: EditorStrings }) {
  const buttons = markButtons(words);
  const marks = useEditorState({ editor, selector: ({ editor: current }) => buttons.map((mark) => mark.active(current)) });
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8, strategy: "absolute" }}
      shouldShow={({ editor: current, from, to }) =>
        from !== to && current.isEditable && !current.isActive("codeBlock") && !current.isActive("diagram") && !current.isActive("schemaBlock")}
      className="flex items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-lg"
    >
      {buttons.map((mark, index) => <BubbleButton key={mark.label} label={mark.label} active={marks[index]} onClick={() => mark.run(editor)}>{mark.icon}</BubbleButton>)}
      <BadgePicker editor={editor} words={words} />
      <Sep />
      <ColorPicker editor={editor} words={words} mark="highlight" />
      <ColorPicker editor={editor} words={words} mark="textColor" />
      <Sep />
      <BubbleButton label={words.marks.clear} onClick={() => editor.chain().focus().unsetAllMarks().run()}><RemoveFormattingIcon /></BubbleButton>
    </BubbleMenu>
  );
}

/* --------------------------------------------------------- block handle */

/**
 * The handle beside the block under the pointer: drag it to move the block,
 * click it for move, copy and delete, or press + to add a block after it.
 */
function BlockHandle({ editor, words }: { editor: Editor; words: EditorStrings }) {
  const target = useRef<{ node: ProseNode | null; pos: number }>({ node: null, pos: -1 });
  const [menu, setMenu] = useState(false);
  // The React handle adds no lock commands; the plugin reads this transaction flag instead.
  const lock = (locked: boolean) => editor.commands.setMeta("lockDragHandle", locked);
  const close = () => { setMenu(false); lock(false); };

  const act = (action: "up" | "down" | "copy" | "delete") => {
    const { node, pos } = target.current;
    close();
    if (!node || pos < 0) return;
    const { doc } = editor.state;
    const index = doc.resolve(pos).index(0);
    const end = pos + node.nodeSize;
    editor.chain().focus().command(({ tr }) => {
      if (action === "delete") tr.delete(pos, end);
      if (action === "copy") tr.insert(end, node.copy(node.content));
      if (action === "up" && index > 0) { const before = doc.child(index - 1); tr.delete(pos, end).insert(pos - before.nodeSize, node); }
      if (action === "down" && index < doc.childCount - 1) { const after = doc.child(index + 1); tr.delete(pos, end).insert(pos + after.nodeSize, node); }
      return true;
    }).run();
  };
  const addAfter = () => {
    const { node, pos } = target.current;
    if (!node || pos < 0) return;
    const at = pos + node.nodeSize;
    // An empty line with `/` in it opens the insert menu right there.
    editor.chain().focus().insertContentAt(at, { type: "paragraph" }).setTextSelection(at + 1).insertContent("/").run();
  };

  return (
    <DragHandle editor={editor} onNodeChange={({ node, pos }) => { if (!menu) target.current = { node, pos }; }}>
      <div className="doc-handle">
        <Button variant="ghost" size="icon-xs" preventFocusOnPress className="doc-handle-button" aria-label={words.handle.add} onPress={addAfter}>
          <PlusIcon />
        </Button>
        <DropdownMenuTrigger isOpen={menu} onOpenChange={(open) => (open ? (lock(true), setMenu(true)) : close())}>
          <Button variant="ghost" size="icon-xs" className="doc-handle-button cursor-grab" aria-label={words.handle.actions}>
            <GripVerticalIcon />
          </Button>
          <DropdownMenu aria-label={words.handle.actions} className="w-auto min-w-40" onAction={(key) => act(key as "up" | "down" | "copy" | "delete")}>
            <DropdownMenuItem id="up"><ArrowUpIcon />{words.handle.up}</DropdownMenuItem>
            <DropdownMenuItem id="down"><ArrowDownIcon />{words.handle.down}</DropdownMenuItem>
            <DropdownMenuItem id="copy"><CopyIcon />{words.handle.copy}</DropdownMenuItem>
            <DropdownMenuItem id="delete" variant="destructive"><Trash2Icon />{words.handle.remove}</DropdownMenuItem>
          </DropdownMenu>
        </DropdownMenuTrigger>
      </div>
    </DragHandle>
  );
}

/* ------------------------------------------------------------ `/` menu */

const KIND_MARK = { table: "T", column: "C", word: "W", keyword: "K" } as const;

/** The code-completion list, under the word being typed. */
function CompletionMenu({ editor }: { editor: Editor }) {
  const state = useEditorState({ editor, selector: ({ editor: current }) => completionKey.getState(current.state) as CompletionState });
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const parent = box.current?.offsetParent as HTMLElement | null;
    if (!state || !parent) return setPosition(null);
    const caret = editor.view.coordsAtPos(state.from);
    const frame = parent.getBoundingClientRect();
    const below = caret.bottom - frame.top + 4;
    const height = box.current!.offsetHeight;
    setPosition({
      left: Math.max(0, Math.min(caret.left - frame.left - 8, frame.width - 300)),
      top: below + height > frame.height ? Math.max(0, caret.top - frame.top - 4 - height) : below,
    });
  }, [editor, state]);
  useEffect(() => { box.current?.querySelector<HTMLElement>(`[data-index="${state?.index}"]`)?.scrollIntoView({ block: "nearest" }); }, [state?.index]);
  if (!state) return null;
  return (
    <div
      ref={box}
      role="listbox"
      aria-label="Suggestions"
      className="doc-complete absolute z-30 max-h-64 w-[300px] overflow-y-auto rounded-lg border bg-popover p-1 text-[13px] shadow-xl"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
    >
      {state.items.map((item, at) => (
        <button
          key={`${item.kind}:${item.label}`}
          type="button"
          role="option"
          aria-selected={at === state.index}
          data-index={at}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left", at === state.index && "bg-(--fill-2)")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => acceptCompletion(editor.view, at)}
        >
          <span className={cn("doc-complete-kind", `is-${item.kind}`)} aria-hidden>{KIND_MARK[item.kind]}</span>
          <span className="doc-complete-label min-w-0 flex-1 truncate">{item.label}</span>
          {item.detail && <span className="shrink-0 truncate text-xs text-muted-foreground">{item.detail}</span>}
        </button>
      ))}
      <div className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">Tab ↹</div>
    </div>
  );
}

function SlashMenu({ state, index, words, onHover }: { state: SlashState; index: number; words: EditorStrings; onHover: (index: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const parent = box.current?.offsetParent as HTMLElement | null;
    if (!parent || !state.rect) return;
    const frame = parent.getBoundingClientRect();
    const below = state.rect.bottom - frame.top + 6;
    const room = frame.height - below;
    setPosition({
      left: Math.max(0, Math.min(state.rect.left - frame.left, frame.width - 330)),
      top: room < 260 ? Math.max(0, state.rect.top - frame.top - 6 - Math.min(320, box.current!.offsetHeight)) : below,
    });
  }, [state.rect, state.items.length]);
  useEffect(() => { box.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);
  let group = "";
  return (
    <div
      ref={box}
      role="listbox"
      aria-label={words.slashLabel}
      className="absolute z-30 max-h-80 w-[330px] overflow-y-auto rounded-xl border bg-popover p-1 text-sm shadow-xl"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
    >
      {state.items.length === 0 && <p className="px-3 py-2 text-muted-foreground">{words.slashEmpty}</p>}
      {state.items.map((item, at) => {
        const heading = (item as InsertItem & { group?: string }).group;
        const show = heading && heading !== group;
        if (heading) group = heading;
        return (
          <div key={item.id}>
            {show && <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{heading}</div>}
            <button
              type="button"
              role="option"
              aria-selected={at === index}
              data-index={at}
              className={cn("flex w-full flex-col rounded-lg px-3 py-1.5 text-left", at === index && "bg-(--fill-2)")}
              onMouseEnter={() => onHover(at)}
              // Keeps focus in the editor, so the selection the command replaces is still there.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => state.select(item)}
            >
              <span>{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.hint}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
