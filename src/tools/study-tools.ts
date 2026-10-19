/**
 * Study-workflow tools: PDF attachment, sources, folders, delete and card reading.
 * Card due dates are not set through the plugin (RemNote 1.28 forces sandboxed plugins); see
 * FINDINGS.md in the parent folder for the Chrome-automation script that does it.
 *
 * Each tool maps 1:1 to a bridge action of the same name (minus the `remnote_` prefix) in
 * remnote-mcp-bridge `src/api/study-adapter.ts`. Kept in its own module so upstream
 * `tools/index.ts` changes stay easy to rebase. No bundled CLI parity yet (see CHANGELOG).
 */
import { z } from 'zod';

const remId = (description: string) => z.string().min(1).describe(description);
const dryRun = z
  .boolean()
  .default(true)
  .describe('Preview only (default true). Set false to apply after reviewing the preview.');

export const AttachPdfSchema = z
  .object({
    documentRemId: remId('Document Rem that should show the PDF as a source'),
    url: z
      .string()
      .url()
      .startsWith('https://')
      .describe('https URL of an already-uploaded PDF (RemNote file storage)'),
    fileName: z.string().min(1).describe('Display name for the PDF Rem, e.g. "GI Lecture 1.pdf"'),
    uploadsFolderRemId: remId(
      'Folder for the PDF Rem (default: top-level "Uploaded Files")'
    ).optional(),
    dryRun,
  })
  .strict();

export const SourceSchema = z
  .object({
    remId: remId('Rem whose source list changes'),
    sourceRemId: remId('Source Rem to add or remove'),
  })
  .strict();

export const GetSourcesSchema = z.object({ remId: remId('Rem to read sources from') }).strict();

export const SetFolderStatusSchema = z
  .object({
    remId: remId('Rem to change'),
    isFolder: z.boolean().describe('true to make it a folder, false to unmake'),
    dryRun,
  })
  .strict();

export const DeleteNoteSchema = z
  .object({
    remId: remId('Rem to delete together with all descendants'),
    dryRun,
    expectedTitle: z
      .string()
      .optional()
      .describe('Required when dryRun=false: exact title from the dry-run preview'),
  })
  .strict();

export const GetCardsSchema = z
  .object({
    remId: remId('Rem whose own flashcards to read'),
    includeHistory: z.boolean().default(false).describe('Include full repetition history'),
  })
  .strict();

const FOLDER_COLOURS = [
  'yellow',
  'yellow-light',
  'green',
  'green-light',
  'blue',
  'blue-light',
  'purple',
  'purple-light',
  'red',
  'red-light',
] as const;

export const GetDocumentAppearanceSchema = z
  .object({
    remId: remId('Document or folder Rem to read'),
  })
  .strict();

export const SetDocumentAppearanceSchema = z
  .object({
    remId: remId('Document or folder Rem to change'),
    folderColour: z
      .enum(FOLDER_COLOURS)
      .optional()
      .describe('Folder icon colour shortcut (sets the Bullet Icon to that folder SVG)'),
    bulletIcon: z
      .string()
      .min(1)
      .optional()
      .describe('Raw icon value: emoji or icon path; use folderColour for folders'),
    hideBullets: z.boolean().optional().describe('true = no-bullet document, false = bulleted'),
    fullWidth: z.boolean().optional().describe('Full-width document layout'),
    dryRun,
  })
  .strict();

export const CreateTableSchema = z
  .object({
    parentRemId: remId('Rem to create the table under'),
    columns: z.array(z.string().min(1)).min(1).describe('Header row, left to right'),
    rows: z
      .array(z.array(z.string()))
      .optional()
      .describe('Body rows: one array of cell texts per row, left to right'),
    position: z.enum(['first', 'last']).default('last').describe('Place under the parent'),
    blankRowNames: z
      .boolean()
      .optional()
      .describe('Add an empty row-name column so every given column can make flashcards'),
    dryRun,
  })
  .strict();

const direction = z.enum(['forward', 'backward', 'both', 'none']);
export const SetTableCardColumnsSchema = z
  .object({
    tableRemId: remId('Table Rem (from create_table)'),
    columns: z
      .record(z.string().min(1), direction)
      .refine((c) => Object.keys(c).length > 0, 'Name at least one column')
      .describe('Column header text -> card direction'),
    dryRun,
  })
  .strict();

export const SetCollapsedSchema = z
  .object({
    remId: remId('Rem to collapse or expand'),
    collapsed: z.boolean(),
    portalId: remId('Document or portal the Rem is shown in'),
    dryRun,
  })
  .strict();

export const CreatePdfHighlightSchema = z
  .object({
    pdfRemId: remId('PDF Rem (Uploaded File), e.g. the pdfRemId from attach_pdf'),
    pageNumber: z.number().int().min(1).describe('1-based page number'),
    text: z.string().min(1).describe('Highlighted text; becomes the highlight Rem text'),
    rects: z
      .array(
        z
          .object({
            x1: z.number().min(0),
            y1: z.number().min(0),
            x2: z.number().min(0),
            y2: z.number().min(0),
          })
          .strict()
      )
      .min(1)
      .describe('Boxes around the text in PDF points from the top-left (e.g. pdftotext -bbox)'),
    pageWidth: z.number().positive().describe('Page width in PDF points'),
    pageHeight: z.number().positive().describe('Page height in PDF points'),
    textBefore: z.string().optional(),
    textAfter: z.string().optional(),
    colorInEditor: z
      .boolean()
      .default(false)
      .describe(
        'Show the colour where notes reference it; false = underlined (No Color in Editor)'
      ),
    color: z
      .string()
      .min(1)
      .optional()
      .describe('Colour when colorInEditor is true, default Yellow'),
    dryRun,
  })
  .strict();

export const SetPdfHighlightColorSchema = z
  .object({
    remId: remId('PDF highlight Rem'),
    colorInEditor: z
      .boolean()
      .describe('false = No Color in Editor (references underlined); true = coloured'),
    color: z
      .string()
      .min(1)
      .optional()
      .describe('Colour when colorInEditor is true, default Yellow'),
    dryRun,
  })
  .strict();

const props = (shape: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties: shape,
  required,
  additionalProperties: false,
});
const DRY_RUN_PROP = {
  type: 'boolean',
  description: 'Preview only (default true). Set false to apply after reviewing the preview.',
};

export const STUDY_TOOLS = [
  {
    name: 'remnote_attach_pdf',
    description:
      'Attach an already-uploaded PDF to a document the way RemNote does: creates a PDF Rem (Uploaded File powerup with URL and name) in "Uploaded Files" and adds it to the document\'s Sources. Dry-run by default.',
    inputSchema: props(
      {
        documentRemId: { type: 'string', description: 'Document Rem that should show the PDF' },
        url: { type: 'string', description: 'https URL of the uploaded PDF' },
        fileName: { type: 'string', description: 'Display name for the PDF Rem' },
        uploadsFolderRemId: {
          type: 'string',
          description: 'Folder for the PDF Rem (default: top-level "Uploaded Files")',
        },
        dryRun: DRY_RUN_PROP,
      },
      ['documentRemId', 'url', 'fileName']
    ),
  },
  {
    name: 'remnote_add_source',
    description: "Add a Rem to another Rem's Sources list (e.g. link a paper note to its PDF Rem).",
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem whose sources change' },
        sourceRemId: { type: 'string', description: 'Source Rem to add' },
      },
      ['remId', 'sourceRemId']
    ),
  },
  {
    name: 'remnote_remove_source',
    description: "Remove a Rem from another Rem's Sources list.",
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem whose sources change' },
        sourceRemId: { type: 'string', description: 'Source Rem to remove' },
      },
      ['remId', 'sourceRemId']
    ),
  },
  {
    name: 'remnote_get_sources',
    description: "List a Rem's Sources, with the file URL for uploaded PDFs.",
    inputSchema: props({ remId: { type: 'string', description: 'Rem to read' } }, ['remId']),
  },
  {
    name: 'remnote_set_folder_status',
    description: 'Make a Rem a folder (or not). Dry-run by default.',
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem to change' },
        isFolder: { type: 'boolean', description: 'true = folder' },
        dryRun: DRY_RUN_PROP,
      },
      ['remId', 'isFolder']
    ),
  },
  {
    name: 'remnote_delete_note',
    description:
      'Delete a Rem and all its descendants. Requires the bridge "Accept replace operation" setting. Always run the dry-run first, show the user the title and descendant count, and only then call again with dryRun=false and expectedTitle.',
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem to delete' },
        dryRun: DRY_RUN_PROP,
        expectedTitle: {
          type: 'string',
          description: 'Required when dryRun=false: exact title from the dry-run',
        },
      },
      ['remId']
    ),
  },
  {
    name: 'remnote_get_cards',
    description:
      "Read a Rem's own flashcards: card IDs, type, next due time, whether due now, last review time, review count, last score (0 again, 0.5 hard, 1 good, 1.5 easy, 4 manual date), wrong-in-a-row.",
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem whose cards to read' },
        includeHistory: { type: 'boolean', description: 'Include full repetition history' },
      },
      ['remId']
    ),
  },
  {
    name: 'remnote_get_document_appearance',
    description:
      "Read a document/folder's icon (folder colour SVG path or emoji), Hide Bullets and Full Width settings.",
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem to read' },
      },
      ['remId']
    ),
  },
  {
    name: 'remnote_set_document_appearance',
    description:
      "Set a document/folder's folder icon colour (or raw icon/emoji), Hide Bullets (no-bullet document) and/or Full Width. Dry-run by default; the result reads values back after writing.",
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem to change' },
        folderColour: {
          type: 'string',
          description: `Folder icon colour: ${FOLDER_COLOURS.join(', ')}`,
        },
        bulletIcon: { type: 'string', description: 'Raw icon value (emoji or icon path)' },
        hideBullets: { type: 'boolean', description: 'true = no bullets' },
        fullWidth: { type: 'boolean', description: 'Full-width layout' },
        dryRun: DRY_RUN_PROP,
      },
      ['remId']
    ),
  },
  {
    name: 'remnote_create_table',
    description:
      'Create a simple table (the grid /table makes) under a parent, from a header row and body rows of cell text. Cell text is Markdown (e.g. **bold**); pipes and line breaks are escaped. Dry-run by default; the preview shows the Markdown sent.',
    inputSchema: props(
      {
        parentRemId: { type: 'string', description: 'Rem to create the table under' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Header row, left to right',
        },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Body rows: one array of cell texts per row',
        },
        position: { type: 'string', enum: ['first', 'last'], description: 'Default last' },
        blankRowNames: {
          type: 'boolean',
          description:
            'Add an empty row-name column so every given column is a property column (RemNote cannot make cards from the row-name column); use for reverse tables',
        },
        dryRun: DRY_RUN_PROP,
      },
      ['parentRemId', 'columns']
    ),
  },
  {
    name: 'remnote_set_table_card_columns',
    description:
      "Turn table flashcards on or off per column, as RemNote's table card settings do: sets the column's card direction (forward, backward, both, none), includes or excludes each cell in that column from practice, and marks the table as making cards. Columns not listed are unchanged. The row-name column cannot make cards. Dry-run by default.",
    inputSchema: props(
      {
        tableRemId: { type: 'string', description: 'Table Rem (from create_table)' },
        columns: {
          type: 'object',
          additionalProperties: { type: 'string', enum: ['forward', 'backward', 'both', 'none'] },
          description: 'Column header text -> card direction, e.g. {"Disease": "forward"}',
        },
        dryRun: DRY_RUN_PROP,
      },
      ['tableRemId', 'columns']
    ),
  },
  {
    name: 'remnote_set_collapsed',
    description:
      "Collapse or expand a Rem's children as shown in a given document or portal (RemNote stores collapse state per view). Dry-run by default.",
    inputSchema: props(
      {
        remId: { type: 'string', description: 'Rem to collapse or expand' },
        collapsed: { type: 'boolean', description: 'true = collapse' },
        portalId: { type: 'string', description: 'Document or portal the Rem is shown in' },
        dryRun: DRY_RUN_PROP,
      },
      ['remId', 'collapsed', 'portalId']
    ),
  },
  {
    name: 'remnote_create_pdf_highlight',
    description:
      "Create a text highlight on an uploaded PDF, stored the way RemNote's PDF viewer stores one (PDF -> Highlights -> Page NN -> highlight). Reference the returned highlightRemId in a note as [[id:<highlightRemId>]] to link that note to the place in the PDF. Box coordinates are PDF points from the page's top-left, e.g. from pdftotext -bbox. Dry-run by default.",
    inputSchema: props(
      {
        pdfRemId: { type: 'string', description: 'PDF Rem (Uploaded File)' },
        pageNumber: { type: 'integer', minimum: 1, description: '1-based page number' },
        text: { type: 'string', description: 'Highlighted text' },
        rects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              x1: { type: 'number' },
              y1: { type: 'number' },
              x2: { type: 'number' },
              y2: { type: 'number' },
            },
            required: ['x1', 'y1', 'x2', 'y2'],
            additionalProperties: false,
          },
          description: 'Boxes around the text, PDF points from top-left',
        },
        pageWidth: { type: 'number', description: 'Page width in PDF points' },
        pageHeight: { type: 'number', description: 'Page height in PDF points' },
        textBefore: { type: 'string', description: 'Optional text just before the highlight' },
        textAfter: { type: 'string', description: 'Optional text just after the highlight' },
        colorInEditor: {
          type: 'boolean',
          description:
            "Show the colour where notes reference it (default false: underlined, like RemNote's No Color in Editor; the PDF shows the default colour)",
        },
        color: { type: 'string', description: 'Colour when colorInEditor is true, default Yellow' },
        dryRun: DRY_RUN_PROP,
      },
      ['pdfRemId', 'pageNumber', 'text', 'rects', 'pageWidth', 'pageHeight']
    ),
  },
  {
    name: 'remnote_set_pdf_highlight_color',
    description:
      "Turn a PDF highlight's colour in the editor off (RemNote's No Color in Editor: notes referencing it show it underlined; the PDF keeps the highlight) or on with a colour. Dry-run by default.",
    inputSchema: props(
      {
        remId: { type: 'string', description: 'PDF highlight Rem' },
        colorInEditor: {
          type: 'boolean',
          description: 'false = underlined in notes; true = coloured',
        },
        color: { type: 'string', description: 'Colour when colorInEditor is true, default Yellow' },
        dryRun: DRY_RUN_PROP,
      },
      ['remId', 'colorInEditor']
    ),
  },
];

/** Tool name -> [bridge action, argument schema]. */
export const STUDY_TOOL_ROUTES: Record<string, [string, z.ZodTypeAny]> = {
  remnote_attach_pdf: ['attach_pdf', AttachPdfSchema],
  remnote_add_source: ['add_source', SourceSchema],
  remnote_remove_source: ['remove_source', SourceSchema],
  remnote_get_sources: ['get_sources', GetSourcesSchema],
  remnote_set_folder_status: ['set_folder_status', SetFolderStatusSchema],
  remnote_delete_note: ['delete_note', DeleteNoteSchema],
  remnote_get_cards: ['get_cards', GetCardsSchema],
  remnote_get_document_appearance: ['get_document_appearance', GetDocumentAppearanceSchema],
  remnote_set_document_appearance: ['set_document_appearance', SetDocumentAppearanceSchema],
  remnote_create_table: ['create_table', CreateTableSchema],
  remnote_create_pdf_highlight: ['create_pdf_highlight', CreatePdfHighlightSchema],
  remnote_set_table_card_columns: ['set_table_card_columns', SetTableCardColumnsSchema],
  remnote_set_collapsed: ['set_collapsed', SetCollapsedSchema],
  remnote_set_pdf_highlight_color: ['set_pdf_highlight_color', SetPdfHighlightColorSchema],
};
