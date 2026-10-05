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
};
