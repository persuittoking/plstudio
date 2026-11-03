/**
 * What only the editor needs on top of the page's own CSS (`documentCss`):
 * room for the block handle, placeholders, selection outlines, and the small
 * controls node views add. Scoped to `.doc-editor`, and written with the
 * page's variables so it follows the Light/Dark choice.
 */
export const EDITOR_CSS = `
.doc.doc-editor{padding:28px 32px 40px 72px}
.doc-editor .page{max-width:860px}
.doc-editor .doc-editor-host{position:relative}
.doc-editor .ProseMirror{outline:none;min-height:40vh;caret-color:var(--accent)}
.doc-editor .ProseMirror > * + *{margin-top:0}
.doc-editor .ProseMirror p.is-empty::before,.doc-editor .ProseMirror h1.is-empty::before,.doc-editor .ProseMirror h2.is-empty::before,.doc-editor .ProseMirror h3.is-empty::before,.doc-editor .ProseMirror h4.is-empty::before,.doc-editor .ProseMirror .is-empty::before{content:attr(data-placeholder);float:left;height:0;pointer-events:none;color:var(--muted);opacity:.7}
.doc-editor .ProseMirror ::selection{background:color-mix(in srgb,var(--accent) 30%,transparent)}
.doc-editor .ProseMirror-selectednode{outline:2px solid var(--accent);outline-offset:3px;border-radius:8px}
.doc-editor .ProseMirror hr.ProseMirror-selectednode{outline-offset:6px}
.doc-editor .ProseMirror-gapcursor:after{border-top-color:var(--text)}
.doc-editor ul,.doc-editor ol{padding-left:24px}
.doc-editor li > p{margin:0}

/* tables: Tiptap wraps them; the page's .table frame goes on the wrapper */
.doc-editor .tableWrapper{border:1px solid var(--border);border-radius:8px;overflow-x:auto;margin:0 0 18px}
.doc-editor table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.5;table-layout:fixed}
.doc-editor th,.doc-editor td{position:relative;padding:9px 12px;vertical-align:top;border-top:1px solid var(--border);border-left:1px solid var(--border);min-width:80px}
.doc-editor tr:first-child > *{border-top:0}
.doc-editor tr > *:first-child{border-left:0}
.doc-editor th{background:var(--panel);color:var(--muted);text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700}
.doc-editor th p,.doc-editor td p{margin:0}
.doc-editor .selectedCell::after{content:"";position:absolute;inset:0;background:color-mix(in srgb,var(--accent) 18%,transparent);pointer-events:none}

/* code */
.doc-editor .editor-code{position:relative;margin:0 0 16px}
.doc-editor .editor-code pre{margin:0;padding-top:30px}
.doc-editor .editor-code-language{position:absolute;top:8px;right:12px;z-index:1;font:600 10.5px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);user-select:none;pointer-events:none}

/* cards */
.doc-editor .editor-cards{margin:0 0 20px}
/* React node views put their children in an inner element: the grid goes on that */
.doc-editor .editor-cards .cards{display:block;margin:0}
.doc-editor .editor-cards .cards > [data-node-view-content-react]{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.doc-editor .editor-card{position:relative;height:100%}
.doc-editor .card-body h4{margin:0 0 6px;padding-right:18px}
.doc-editor .card-body .lead{min-height:1.2em}
.doc-editor .card-body .card-text{font-size:13px;color:var(--muted);margin:0 0 10px}
.doc-editor .card-body .value{font:700 24px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--warm);margin:0 0 6px}
.doc-editor .card-remove{position:absolute;top:6px;right:6px;opacity:0}
.doc-editor .editor-card:hover .card-remove,.doc-editor .editor-card:focus-within .card-remove{opacity:1}
.doc-editor .editor-add-card{display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:12px;color:var(--muted);background:none;border:1px dashed var(--border);border-radius:8px;padding:4px 10px;cursor:pointer}
.doc-editor .editor-add-card:hover{color:var(--text);border-color:var(--muted)}
.doc-editor .editor-add-card svg,.doc-editor .editor-chip-button svg{width:13px;height:13px}

/* atoms: diagrams and schema blocks */
.doc-editor .editor-atom{margin:0 0 16px;border-radius:10px;position:relative}
.doc-editor .editor-atom.is-selected{outline:2px solid var(--accent);outline-offset:3px}
.doc-editor .editor-atom-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
.doc-editor .editor-atom-bar select{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:none;letter-spacing:0;background:var(--chip);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:3px 6px}
.doc-editor .editor-chip-button{display:inline-flex;align-items:center;gap:4px;font-size:11px;text-transform:none;letter-spacing:0;background:var(--chip);color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:2px 8px;cursor:pointer}
.doc-editor .editor-chip-button:hover{color:var(--text)}
.doc-editor .editor-diagram-source textarea{width:100%;box-sizing:border-box;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;resize:vertical;outline:none}
.doc-editor .editor-diagram-source textarea:focus{border-color:var(--accent)}
.doc-editor .editor-diagram-source .note{margin:6px 0 0}

/* block handle */
.doc-editor .doc-handle{display:flex;gap:2px;position:relative;margin-right:6px}
.doc-editor .doc-handle-button{display:flex;align-items:center;justify-content:center;width:22px;height:24px;border:0;border-radius:6px;background:none;color:var(--muted);cursor:grab}
.doc-editor .doc-handle-button:first-child{cursor:pointer}
.doc-editor .doc-handle-button:hover{background:var(--chip);color:var(--text)}
.doc-editor .doc-handle-button svg{width:15px;height:15px}
.doc-editor .doc-handle-menu{position:absolute;top:26px;left:0;z-index:20;min-width:150px;padding:4px;border:1px solid var(--border);border-radius:10px;background:var(--panel);box-shadow:0 8px 24px rgba(0,0,0,.25)}
.doc-editor .doc-handle-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:6px;background:none;color:var(--text);font:13px ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-align:left}
.doc-editor .doc-handle-menu button:hover{background:var(--chip)}
.doc-editor .doc-handle-menu button.danger{color:var(--bad)}
.doc-editor .doc-handle-menu svg{width:14px;height:14px}
.doc-complete-label{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.doc-complete-kind{display:inline-grid;place-items:center;width:18px;height:18px;flex:none;border-radius:5px;font:700 10px/1 ui-sans-serif,system-ui,sans-serif;color:#fff}
.doc-complete-kind.is-table{background:#2b99e7}.doc-complete-kind.is-column{background:#00acb6}.doc-complete-kind.is-word{background:#8a82e9}.doc-complete-kind.is-keyword{background:#cf7b00}
`;
