# Helper scripts (study-tools fork)

Scripts for the jobs the RemNote plugin API cannot do, or that are easier outside RemNote. They go with the MCP tools
described in [docs/guides/study-tools-fork.md](../docs/guides/study-tools-fork.md).

Written and tested on macOS with the RemNote desktop app. Paths that assume macOS: the desktop app's data folder
`~/remnote/`, its local storage under `~/Library/Application Support/RemNote/`, and Google Chrome at
`/Applications/Google Chrome.app`.

## Setup

```bash
cd tools
npm install            # puppeteer-core, for the .mjs scripts
```

The Python scripts need Python 3 and no extra packages.

**The web-app scripts** (`rn_table_cards.mjs`, `rn_table_add_column.mjs`, `rn_set_back.mjs`, `rn_set_due.mjs`) drive
RemNote's web app in Google Chrome, using a separate Chrome profile at `~/.remnote-automation-chrome` (Chrome does not
allow remote control of your normal profile). Log in once in that profile:

```bash
node rn_set_due.mjs --login     # opens a Chrome window; log in to RemNote there yourself
```

The scripts never read, print or store your password or login token. They call RemNote's own internal functions, so
RemNote saves, syncs and records undo history itself. They can stop working when RemNote changes its app.

**Every script that changes data previews by default.** Add `--apply` to make the change. After applying, the web-app
scripts keep the page open for a while (`--hold <seconds>`) so RemNote uploads the change; check the result in RemNote
or with the MCP tools afterwards.

**Knowledge base.** Scripts that need your knowledge base find it from the desktop app's folder
`~/remnote/remnote-<knowledge base id>/` (the largest database if there are several). Set `REMNOTE_KB=<id>` (or
`REMNOTE_DB=<path to remnote.db>` for the database readers) to choose another one.

**Reading the database.** Scripts that read RemNote's database copy it (with its `-wal` and `-shm` files) to a
temporary folder and read the copy. They never write to the live database.

## Scripts

| Script | What it does | Changes data |
|---|---|---|
| `rn_upload_pdf.py` | Uploads a PDF or image to RemNote's file storage and prints its URL | uploads a file |
| `rn_table_cards.mjs` | Switches table flashcards on per column; sets the table's card view and other table card options | yes, `--apply` |
| `rn_table_add_column.mjs` | Adds a column to an existing table | yes, `--apply` |
| `rn_set_back.mjs` | Empties a Rem's back text (turns a text cell into a bullets-only cell) | yes, `--apply` |
| `rn_set_due.mjs` | Sets flashcard due dates | yes, `--apply` |
| `rn_compare.py` | Snapshots a document and later lists what changed in it | no |
| `rn_session_stats.py` | Reports a day's flashcard reviews: sessions, first-try results, cards not recalled | no |
| `rn_typed_answers.py` | Lists typed flashcard answers that RemNote's AI checked | no |
| `rn_localstorage.py` | Library used by `rn_upload_pdf.py` to read the desktop app's local storage | no |

### rn_upload_pdf.py

```bash
python3 rn_upload_pdf.py slides.pdf      # also .jpg, .jpeg, .png
```

Uploads the file the way the RemNote app does (it asks RemNote's server for an upload link, then uploads to it) as the
user logged in to the RemNote **desktop app**. The login token is read from the desktop app's local storage into
memory only. Prints the file's permanent URL.

- PDFs: pass the URL to the MCP tool `remnote_attach_pdf`.
- Images: insert them into a note with Markdown `![caption](url)` through `remnote_insert_children`.
- RemNote refuses large files. Split large slide decks into one PDF per lecture with PyMuPDF
  (`insert_pdf`, then `save(garbage=4, deflate=True)`); `pdfseparate` copies every image into every page.

### rn_table_cards.mjs

```bash
node rn_table_cards.mjs --probe <tableRemId>                                  # show the table's settings
node rn_table_cards.mjs <tableRemId> "Method=forward" "Result=forward"        # preview
node rn_table_cards.mjs --apply --layout table <tableRemId> "Method=forward" -- <tableRemId2> "Remission=forward"
```

Switches table flashcards on per column, calling the same RemNote functions as the table's card menu.

- Directions: `forward`, `backward`, `both`, `none`.
- Several tables in one run: separate them with `--`.
- `--layout table|cells|none`: the table's card view, "Show Entire Table", "Test Individual Cells" or "Don't Generate
  Cards". With "Show Entire Table", one card shows the whole row and hides every carded cell in it.
- `--random-order on|off`: "Test Rows In Random Order" (needs Show Entire Table).
- `--header-column on|off`: the "Header Column" toggle (turn it off for tables made with `blankRowNames`).
- `--show` opens a visible window; `--profile <dir>` uses another Chrome profile.
- `--fit` (column widths) does not work yet.

Run it after creating a deck's tables. The MCP tool `remnote_set_table_card_columns` alone did not make RemNote create
the cards in testing.

### rn_table_add_column.mjs

```bash
node rn_table_add_column.mjs <tableRemId> "Limitation" --after "Finding"            # preview
node rn_table_add_column.mjs --apply <tableRemId> "Limitation" --after "Finding"
```

Adds an empty column after an existing one. Refuses if the name already exists. Fill the new cells with the MCP tool
`remnote_set_property` (`remId` = row, `tagRemId` = the table's header Rem, `propertyRemId` = the new column), then
switch on its cards with `rn_table_cards.mjs`.

### rn_set_back.mjs

```bash
node rn_set_back.mjs <remId> [<remId> ...]       # preview: show the current back text
node rn_set_back.mjs --apply <remId> ...
```

Empties the back text (`value`) of the given Rems. Use it to turn a table cell holding text into a cell that shows
only bullets (its child Rems).

### rn_set_due.mjs

```bash
node rn_set_due.mjs <cardId>=2026-10-20 [<cardId>=2026-10-22T09:00 ...]   # preview
node rn_set_due.mjs --apply <cardId>=2026-10-20
```

Sets flashcard due dates through RemNote's own scheduling call (the one its schedule editor uses). Card IDs come from
the MCP tool `remnote_get_cards`. Refuses dates in the past. Review history is not edited: RemNote appends one
"manual date" entry (score 4) per card. `--kb <id>` or `REMNOTE_KB` chooses the knowledge base.

### rn_compare.py

```bash
python3 rn_compare.py snapshot <documentRemId> before.json
python3 rn_compare.py compare before.json
```

`snapshot` saves every note under a document (ID, parent, depth, text, formatting, created and edited times).
`compare` lists, by heading, the notes added since the snapshot, notes whose text changed (old and new text), notes
deleted, and words newly made bold, italic, underlined or highlighted. Use it to tell your own lecture notes apart from
a template made beforehand, or to collect labels someone added while reviewing cards. `--db <remnote.db>` reads that
database file instead of copying the desktop one.

### rn_session_stats.py

```bash
cp ~/remnote/remnote-<id>/remnote.db* /tmp/rncopy/
python3 rn_session_stats.py /tmp/rncopy/remnote.db 2026-10-19 --json report.json
```

Reports one day's reviews from a copy of the database: sessions (a gap of more than 30 minutes starts a new one),
cards reviewed, cards recalled first try, and each card not recalled first try with its number of Forgot ratings,
final rating and next due time. Scores: 0 Forgot, 0.5 Partially recalled, 1 Recalled with effort, 1.5 Easily
recalled.

### rn_typed_answers.py

```bash
python3 rn_typed_answers.py 2026-10-19 --json typed.json
```

RemNote does not keep typed answers in the card history. When its AI checks a typed answer, the question, correct
answer, typed answer and the AI's assessment are logged in `~/remnote/browser/remnote.db` (table `persisted_logging`).
That log keeps only the last 100 AI calls, so run this on the day of the session.
