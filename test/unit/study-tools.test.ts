import { describe, it, expect, vi } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerAllTools } from '../../src/tools/index.js';
import { STUDY_TOOLS, STUDY_TOOL_ROUTES } from '../../src/tools/study-tools.js';
import { createMockLogger } from '../setup.js';

class MockMCPServer {
  handlers = new Map<unknown, (request: unknown) => Promise<unknown>>();
  setRequestHandler(schema: unknown, handler: (request: unknown) => Promise<unknown>) {
    this.handlers.set(schema, handler);
  }
}

function setup() {
  const server = new MockMCPServer();
  const sendRequest = vi.fn().mockResolvedValue({ ok: true });
  registerAllTools(server as never, { sendRequest } as never, createMockLogger());
  const call = (name: string, args: Record<string, unknown>) =>
    server.handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } }) as Promise<{
      isError?: boolean;
      content: { text: string }[];
    }>;
  return { call, sendRequest };
}

describe('study tools', () => {
  it('defines a route for every advertised study tool', () => {
    for (const tool of STUDY_TOOLS) {
      expect(STUDY_TOOL_ROUTES[tool.name], tool.name).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('forwards attach_pdf with dryRun defaulting to true', async () => {
    const { call, sendRequest } = setup();
    const result = await call('remnote_attach_pdf', {
      documentRemId: 'doc',
      url: 'https://remnote-user-data.s3.amazonaws.com/x.pdf',
      fileName: 'x.pdf',
    });
    expect(result.isError).toBeUndefined();
    expect(sendRequest).toHaveBeenCalledWith('attach_pdf', {
      documentRemId: 'doc',
      url: 'https://remnote-user-data.s3.amazonaws.com/x.pdf',
      fileName: 'x.pdf',
      dryRun: true,
    });
  });

  it('rejects non-https PDF URLs before reaching the bridge', async () => {
    const { call, sendRequest } = setup();
    const result = await call('remnote_attach_pdf', {
      documentRemId: 'doc',
      url: 'http://example.com/x.pdf',
      fileName: 'x.pdf',
    });
    expect(result.isError).toBe(true);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('forwards delete_note as a dry run by default', async () => {
    const { call, sendRequest } = setup();
    await call('remnote_delete_note', { remId: 'n1' });
    expect(sendRequest).toHaveBeenLastCalledWith('delete_note', { remId: 'n1', dryRun: true });
  });

  it('rejects unknown fields', async () => {
    const { call } = setup();
    const result = await call('remnote_get_cards', { remId: 'n1', extra: 1 });
    expect(result.isError).toBe(true);
  });

  it('forwards set_document_appearance as a dry run and validates folderColour', async () => {
    const { call, sendRequest } = setup();
    await call('remnote_set_document_appearance', { remId: 'f1', folderColour: 'yellow' });
    expect(sendRequest).toHaveBeenLastCalledWith('set_document_appearance', {
      remId: 'f1',
      folderColour: 'yellow',
      dryRun: true,
    });
    const bad = await call('remnote_set_document_appearance', {
      remId: 'f1',
      folderColour: 'pink',
    });
    expect(bad.isError).toBe(true);
  });
  it('forwards create_table as a dry run with defaults and rejects empty columns', async () => {
    const { call, sendRequest } = setup();
    await call('remnote_create_table', {
      parentRemId: 'p1',
      columns: ['Drug', 'Target'],
      rows: [['Linaclotide', 'GC-C agonist']],
    });
    expect(sendRequest).toHaveBeenLastCalledWith('create_table', {
      parentRemId: 'p1',
      columns: ['Drug', 'Target'],
      rows: [['Linaclotide', 'GC-C agonist']],
      position: 'last',
      dryRun: true,
    });
    const bad = await call('remnote_create_table', { parentRemId: 'p1', columns: [] });
    expect(bad.isError).toBe(true);
  });
});
