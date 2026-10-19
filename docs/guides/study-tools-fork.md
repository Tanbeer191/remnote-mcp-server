# Study-tools fork: added MCP tools

This fork (branch `study-tools`) adds 14 MCP tools to `remnote-mcp-server` for building lecture notes, PDF-linked
notes and flashcard decks in RemNote. Every upstream tool still works as documented in
[tools-reference.md](tools-reference.md); this page covers only what the fork adds.

The added tools need the matching forked bridge plugin, branch `study-tools` of
[Tanbeer191/remnote-mcp-bridge](https://github.com/Tanbeer191/remnote-mcp-bridge/tree/study-tools). The official
Marketplace plugin does not have the bridge actions these tools call, so they fail with an "unknown action" error
against it. Some jobs the RemNote plugin API cannot do at all (uploading files, switching on table flashcards,
setting due dates); helper scripts for those are in [`tools/`](../../tools/README.md).

## Setup

You need: Node.js 22.13 or later (the server needs 22.13; the bridge 20.19), the RemNote desktop app or web app, and (for the helper scripts) macOS with Google
Chrome and Python 3.

1. Clone both forks on the `study-tools` branch (it is the default branch of both repos):

   ```bash
   git clone https://github.com/Tanbeer191/remnote-mcp-server.git
   git clone https://github.com/Tanbeer191/remnote-mcp-bridge.git
   ```

2. Build and start the server:

   ```bash
   cd remnote-mcp-server
   npm install
   npm run build
   node dist/index.js          # MCP on http://127.0.0.1:3001/mcp, bridge WebSocket on :3002
   ```

3. Run the bridge plugin from source and load it in RemNote:

   ```bash
   cd remnote-mcp-bridge
   npm install
   npm run dev                 # serves the plugin on http://localhost:8080
   ```

   In RemNote: Settings -> Plugins -> Build -> Develop from localhost, URL `http://localhost:8080/`. The plugin shows as
   **"MCP Automation Bridge (Tanbeer fork)"** (plugin id `remnote-mcp-bridge-tanbeer`, so it can sit next to the
   official plugin). Disable the official Marketplace bridge while using the fork: both connect to port 3002. Details:
   [bridge guide to running the plugin locally](https://github.com/Tanbeer191/remnote-mcp-bridge/blob/study-tools/docs/guides/development-run-plugin-locally.md).

4. In the plugin's settings, switch on **Accept write operations**. Switch on **Accept replace operation** only if you
   want `remnote_delete_note` and `remnote_replace_children` to work.

5. Connect your MCP client to `http://127.0.0.1:3001/mcp` as in the [configuration guides](configuration.md). With
   Claude Code: `claude mcp add remnote --transport http http://localhost:3001/mcp`. After every server restart,
   re-authenticate the client (in Claude Code: `/mcp` -> remnote -> Clear authentication -> Authenticate).

6. Check: `remnote_status` should report `connected: true`. After any change to the bridge code, reload the plugin in
   RemNote.

## Safety conventions

- Every tool that changes something takes `dryRun` and **defaults to a preview** (`dryRun: true`). Call it once, read
  the preview, then call again with `dryRun: false`. The exceptions are `remnote_add_source` and
  `remnote_remove_source`, which apply at once.
- Results of applied changes read the values back from RemNote, so a result shows what RemNote stored, not what was
  sent.
- `remnote_delete_note` also needs `expectedTitle` (the exact title from the preview) and the bridge setting
  **Accept replace operation**.

## Tool summary

| Tool | What it does | Changes data |
|---|---|---|
| `remnote_attach_pdf` | Attaches an uploaded PDF to a document as a Source, as RemNote's own upload does | yes, previews first |
| `remnote_add_source` | Adds a Rem to another Rem's Sources | yes, applies at once |
| `remnote_remove_source` | Removes a Rem from another Rem's Sources | yes, applies at once |
| `remnote_get_sources` | Lists a Rem's Sources, with file URLs for PDFs | no |
| `remnote_set_folder_status` | Makes a Rem a folder, or not | yes, previews first |
| `remnote_delete_note` | Deletes a Rem and everything under it | yes, previews first |
| `remnote_get_cards` | Reads a Rem's flashcards: due time, review count, last score, history | no |
| `remnote_get_document_appearance` | Reads a document's folder icon or emoji, Hide Bullets and Full Width | no |
| `remnote_set_document_appearance` | Sets folder colour or icon, Hide Bullets and Full Width | yes, previews first |
| `remnote_create_table` | Creates a simple table from a header row and body rows | yes, previews first |
| `remnote_set_table_card_columns` | Sets each table column's flashcard direction | yes, previews first |
| `remnote_set_collapsed` | Collapses or expands a Rem in a given document view | yes, previews first |
| `remnote_create_pdf_highlight` | Creates a text highlight on an uploaded PDF that notes can link to | yes, previews first |
| `remnote_set_pdf_highlight_color` | Turns a PDF highlight's colour in the editor off (underlined) or on | yes, previews first |

## PDFs and sources

### remnote_attach_pdf

Attaches a PDF that is already in RemNote's file storage to a document, the way RemNote does it when you upload a
PDF: it creates a PDF Rem (Uploaded File powerup holding the URL and file name) in the top-level "Uploaded Files"
folder and adds that Rem to the document's Sources. The PDF then opens in RemNote's PDF reader from the document.

| Parameter | Required | Description |
|---|---|---|
| `documentRemId` | yes | Document that should show the PDF |
| `url` | yes | `https` URL of the uploaded file |
| `fileName` | yes | Display name for the PDF Rem |
| `uploadsFolderRemId` | no | Folder for the PDF Rem (default: the top-level "Uploaded Files") |
| `dryRun` | no | Default true |

The plugin API cannot upload files. Upload first with [`tools/rn_upload_pdf.py`](../../tools/README.md), which prints
the URL to pass here. Keep PDFs small (split large slide decks with PyMuPDF rather than `pdfseparate`, which copies
every image into every page): RemNote refuses large uploads.

### remnote_add_source / remnote_remove_source

Add or remove a Rem in another Rem's Sources list, for example to link a paper note to its PDF Rem. Parameters:
`remId` (the Rem whose sources change) and `sourceRemId`. These apply at once (no dry run).

### remnote_get_sources

Lists a Rem's Sources. For uploaded PDFs the result includes the file URL. Parameter: `remId`.

## Folders, documents and deleting

### remnote_set_folder_status

Makes a Rem a folder (`isFolder: true`) or turns a folder back into a plain Rem. Parameters: `remId`, `isFolder`,
`dryRun`. New folders get RemNote's default colour; set the colour with `remnote_set_document_appearance`.

### remnote_get_document_appearance / remnote_set_document_appearance

Read or set how a document or folder looks.

| Parameter | Description |
|---|---|
| `remId` | Document or folder |
| `folderColour` | Folder icon colour: `yellow`, `yellow-light`, `green`, `green-light`, `blue`, `blue-light`, `purple`, `purple-light`, `red`, `red-light` |
| `bulletIcon` | Raw icon value instead of a colour (an emoji or an icon path) |
| `hideBullets` | `true` = a document without bullets |
| `fullWidth` | `true` = full-width layout |
| `dryRun` | Default true |

### remnote_set_collapsed

Collapses or expands a Rem's children. RemNote stores collapse state per view, so you also say which document or
portal the Rem is shown in. Parameters: `remId`, `collapsed` (true = collapse), `portalId`, `dryRun`.

### remnote_delete_note

Deletes a Rem and all its descendants. Parameters: `remId`, `dryRun`, and `expectedTitle` when `dryRun` is false.

Use it in two calls: the preview returns the Rem's title and how many descendants would go; then call again with
`dryRun: false` and `expectedTitle` set to that exact title. The bridge refuses if the title does not match, and
refuses unless **Accept replace operation** is on in the plugin settings. A deleted table removes all its rows and
cells; deleting a note removes its flashcards and their review history.

## Flashcards

### remnote_get_cards

Reads a Rem's own flashcards: card ID, card type, next due time, whether it is due now, last review time, number of
reviews, last score and how many times in a row it was answered wrong. Scores: 0 Forgot, 0.5 Partially recalled,
1 Recalled with effort, 1.5 Easily recalled, 4 a manually set date. Parameters: `remId`, `includeHistory` (true adds
the full review history).

The tools never rate cards or edit review history. To set due dates, see `tools/rn_set_due.mjs`.

### Writing cards with the upstream tools

Cards themselves are written with the upstream tools `remnote_create_note`, `remnote_insert_children` and
`remnote_update_note`, using RemNote's syntax in the text: `Front >> Back` (one-way), `Term :: Definition`
(both ways), `Property ;; value` (a descriptor under a `::` concept), `Question >>>` with child bullets (a multi-line
list card) and `Question >>1.` with child bullets (an ordered list card). Headings: `### Heading` (H3), `## Heading`
(H2).

Two things found in use:

- **Write a multi-line card and all its list bullets in one insert.** RemNote marks each list item as part of the card
  only when the item is created with the card. A bullet added later with `remnote_insert_children` shows under the card
  but is not tested, and the tools cannot add that mark afterwards. To add a bullet, delete and recreate the card (if
  it has no review history) or add the bullet by hand in RemNote.
- Never use the Unicode arrow `→` in card text: RemNote reads it as a card delimiter.

## Tables

### remnote_create_table

Creates a simple table (the grid that `/table` makes) under a parent, from a header row and body rows of cell text.
The first column holds the row names; the other columns are table properties. Cell text is Markdown (for example
`**bold**`); pipes and line breaks are escaped. Returns `tableRemId`.

| Parameter | Required | Description |
|---|---|---|
| `parentRemId` | yes | Rem to create the table under |
| `columns` | yes | Header row, left to right |
| `rows` | no | Body rows: one array of cell texts per row |
| `position` | no | `first` or `last` (default last) |
| `blankRowNames` | no | Adds an empty row-name column so every given column becomes a property column. Use it for reverse tables: RemNote cannot make cards from the row-name column |
| `dryRun` | no | Default true; the preview shows the Markdown that would be sent |

**Bullets inside a cell.** Leave the cell's text empty (`""`) when creating the table, read the table with
`remnote_read_note` (`contentMode: "structured"`, `depth: 3`) to find the cell Rem (a child of the row whose title is
`[[<column name>]]`), and add the bullets with `remnote_insert_children` under that cell Rem. RemNote shows them as a
bulleted list inside the cell.

**Changing a cell later.** Use the upstream `remnote_set_property` with `remId` = the row Rem, `tagRemId` = the
table's header Rem and `propertyRemId` = the column Rem.

### remnote_set_table_card_columns

Sets each column's flashcard direction the way RemNote's table card menu does: the column's direction, which cells in
that column are included in practice, and the table's "makes cards" flag. Columns not listed are left as they are.

| Parameter | Description |
|---|---|
| `tableRemId` | Table Rem returned by `remnote_create_table` |
| `columns` | Object of column header text -> `forward`, `backward`, `both` or `none`, e.g. `{"Disease": "forward"}` |
| `dryRun` | Default true |

**Limit found in use:** in testing (19 Oct 2026) this set the settings but RemNote did not create the cards until the
same columns were switched on with `tools/rn_table_cards.mjs`, which calls RemNote's own table functions through the
web app. Use that script to switch table cards on and to choose the table's card view ("Show Entire Table" or "Test
Individual Cells"), then check that the cards exist (for example with `remnote_get_cards` on a cell Rem).

## PDF highlights

### remnote_create_pdf_highlight

Creates a text highlight on an uploaded PDF, stored the way RemNote's PDF viewer stores one: under the PDF Rem,
"Highlights" -> "Page NN" -> the highlight Rem, with the PDF Highlight and Highlight powerups. Returns
`highlightRemId`. Put `[[id:<highlightRemId>]]` in any note (including a heading's title) and clicking it opens the
PDF at that place.

| Parameter | Required | Description |
|---|---|---|
| `pdfRemId` | yes | The PDF Rem (Uploaded File), e.g. from `remnote_get_sources` |
| `pageNumber` | yes | 1-based page number |
| `text` | yes | The highlighted text |
| `rects` | yes | Boxes around the text, `[{x1, y1, x2, y2}]`, in PDF points from the page's top-left |
| `pageWidth`, `pageHeight` | yes | Page size in PDF points (a 16:9 slide is often 960 x 540) |
| `textBefore`, `textAfter` | no | Text just before and after the highlight |
| `colorInEditor` | no | Default false: notes that reference the highlight show it underlined, like RemNote's "No Color in Editor"; the PDF still shows it highlighted. True: the reference shows the colour |
| `color` | no | Colour when `colorInEditor` is true (default Yellow) |
| `dryRun` | no | Default true |

Getting the boxes: with PyMuPDF, `page.get_text("dict")` gives each line's `bbox` (x0, y0, x1, y1) in points from the
top-left, and `page.rect` gives the page size. `pdftotext -bbox` also works. Text layers sometimes store Greek letters
as Latin ones (β as b); write the `text` correctly.

New highlights show in RemNote's PDF viewer after the PDF is closed and opened again.

### remnote_set_pdf_highlight_color

Turns an existing highlight's colour in the editor off (references show underlined; the PDF keeps the highlight) or
on with a colour. Parameters: `remId` (the highlight Rem), `colorInEditor`, `color` (default Yellow), `dryRun`.

## Things the plugin API cannot do

| Job | Why not | Use instead |
|---|---|---|
| Upload a file to RemNote | No upload function in the plugin SDK | `tools/rn_upload_pdf.py` |
| Switch on table flashcards reliably, choose the table card view, rows in random order | The SDK writes different fields from the table menu | `tools/rn_table_cards.mjs` |
| Add a table column | Not in the SDK | `tools/rn_table_add_column.mjs` |
| Empty a cell's text so it holds only bullets | `set_property` with `clear` times out | `tools/rn_set_back.mjs` |
| Set flashcard due dates | RemNote 1.28 runs every plugin sandboxed, so the bridge cannot call the scheduler | `tools/rn_set_due.mjs` |
| Mark a later-added bullet as part of a multi-line card | Needs a powerup the tools cannot add | Recreate the card, or add the bullet by hand |

See [`tools/README.md`](../../tools/README.md) for the scripts.
