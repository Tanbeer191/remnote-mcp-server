#!/usr/bin/env node
/**
 * Turn on RemNote table flashcards per column (and fit table width) through the RemNote web app,
 * using RemNote's own internal functions — the ones its table card menu calls
 * (setColumnGenerateCardsDirection, setTableTestShowEntireTable). The app then saves,
 * adds to undo history and syncs the change itself. The plugin SDK cannot do this: its
 * setPracticeDirection/setEnablePractice write different fields (tested 12 Oct 2026).
 *
 * Usage:
 *   node rn_table_cards.mjs --probe <tableRemId>                       # list internals, change nothing
 *   node rn_table_cards.mjs <tableRemId> "Column=forward" [...]        # preview
 *   node rn_table_cards.mjs --apply <tableRemId> "Column=both" [...]   # apply
 *   several tables: separate jobs with "--" ; options: --fit (equal column widths, like
 *   "Fit to table"; not working yet), --layout table|cells|none (the table's flashcard view menu:
 *   "Show Entire Table", "Test Individual Cells" or "Don't Generate Cards"), --header-column on|off (the table menu's "Header Column" toggle;
 *   off for blank-row-name tables), --random-order on|off
 *   (the "Test Rows In Random Order" toggle in the same menu; needs "Show Entire Table"), --show, --profile <dir>
 *   A job may give no columns, e.g.  node rn_table_cards.mjs --apply --random-order on <tableRemId>
 * Directions: forward | backward | both | none.
 *
 * Uses the dedicated Chrome profile shared with rn_set_due.mjs (~/.remnote-automation-chrome).
 * Waits until RemNote reports sync finished and every target table is loaded before acting,
 * and until no unsynced changes remain after applying.
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = 'https://www.remnote.com/';
const DIRS = ['forward', 'backward', 'both', 'none'];
/** The table's flashcard view menu ("Show Entire Table" / "Test Individual Cells"; "Don't Generate Cards"
 *  when neither). RemNote's setTableTestShowEntireTable takes these strings, not booleans (read from the
 *  web app's code, 12 Oct 2026). "show_entire_table" adds the Card Cluster powerup (code "cc", stored on the
 *  table as apu.cc) and sets ttic false; "test_individual_cells" sets ttic true and removes the powerup;
 *  "none" removes the powerup and sets ttic false. The menu shows "Show Entire Table" when the table has the
 *  cc powerup (ttic false alone is not enough), "Test Individual Cells" when ttic is true. */
const LAYOUTS = { table: 'show_entire_table', cells: 'test_individual_cells', none: 'none' };
/** "Test Rows In Random Order" (table flashcard menu, shown only under "Show Entire Table"). It is slot "t"
 *  (TestRowsInRandomOrder) of the Card Cluster powerup "cc", stored as the string "true"/"false". The menu's
 *  switch calls tableRem.setPowerupProperty("cc", "t", ["true"|"false"]) and reads
 *  getPowerupProperty("cc", "t") === "true" (web-app chunk 5401, read 12 Oct 2026). */
const RANDOM_ORDER = { on: 'true', off: 'false' };
/** Total width RemNote's "Fit to table" used for a full-width document (3 columns x 258.661 px, measured 12 Oct 2026). */
const TABLE_WIDTH = 775.983;

function parseArgs(argv) {
  const opts = { hold: 60, apply: false, probe: false, fit: false, layout: null, randomOrder: null, headerColumn: null, show: false, profile: path.join(os.homedir(), '.remnote-automation-chrome'), jobs: [] };
  let cur = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--probe') opts.probe = true;
    else if (a === '--fit') opts.fit = true;
    else if (a === '--layout') { opts.layout = argv[++i]; if (!(opts.layout in LAYOUTS)) throw new Error('--layout must be table, cells or none'); }
    else if (a === '--header-column') { opts.headerColumn = argv[++i]; if (!['on', 'off'].includes(opts.headerColumn)) throw new Error('--header-column must be on or off'); }
    else if (a === '--random-order') { opts.randomOrder = argv[++i]; if (!(opts.randomOrder in RANDOM_ORDER)) throw new Error('--random-order must be on or off'); }
    else if (a === '--show') opts.show = true;
    else if (a === '--hold') opts.hold = Number(argv[++i]);
    else if (a === '--profile') opts.profile = argv[++i];
    else if (a === '--') cur = null;
    else if (!cur) { cur = { table: a, columns: {} }; opts.jobs.push(cur); }
    else {
      const k = a.lastIndexOf('=');
      const name = a.slice(0, k), dir = a.slice(k + 1);
      if (k < 1 || !DIRS.includes(dir)) throw new Error(`Bad column spec "${a}" (want "Column=forward|backward|both|none")`);
      cur.columns[name] = dir;
    }
  }
  if (!opts.jobs.length) throw new Error('No table given');
  return opts;
}

/** Read RemNote's sync state from its TabSyncedSession store. */
const SYNC_STATE = () => {
  const S = window.TabSyncedSession;
  // Each entry is a function returning a synced reactive store, or the store itself; read its current value.
  const val = (v) => (typeof v?.get === 'function' ? v.get() : v?.reactiveVar ? v.reactiveVar.curValue : v);
  const g = (k) => { try { const v = S?.[k]; return val(typeof v === 'function' ? v() : v); } catch { return 'error'; } };
  return { saving: g('savingToDatabase'), unsynced: g('numUnsyncedChanges'), haveUnsynced: g('haveUnsyncedInformation'), status: g('syncingStatus'), last: g('lastSyncedTime') };
};

async function waitFor(page, label, fn, arg, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const prev = JSON.stringify(last?.sync?.status ?? last?.st?.status);
      last = await page.evaluate(fn, arg);
      const now = JSON.stringify(last?.sync?.status ?? last?.st?.status);
      if (now !== prev) console.log(`${label}: status ${now}`);
      if (last?.ok) return last;
    } catch { /* navigating */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${label}: timed out (${JSON.stringify(last)?.slice(0, 200)})`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = await puppeteer.launch({ executablePath: CHROME, userDataDir: opts.profile, headless: !opts.show, defaultViewport: null, protocolTimeout: 600000, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await waitFor(page, 'RemNote load', () => ({ ok: typeof window.Rem === 'function' && location.pathname.startsWith('/w/') && !!localStorage.getItem('userToken') }), null, 5 * 60000);
    // Wait until every target table has synced into this window.
    const ids = opts.jobs.map((j) => j.table);
    const ready = await waitFor(page, 'tables to sync', async ({ ids, syncSrc }) => {
      const c = window.Rem(window.CURRENT_KNOWLEDGE_BASE);
      const found = await Promise.all(ids.map((id) => c.findOneAsync(id).then((r) => !!r)));
      const s = (0, eval)(`(${syncSrc})`)();
      return { ok: found.every(Boolean), found, sync: s };
    }, { ids, syncSrc: SYNC_STATE.toString() }, 10 * 60000);
    console.log('Loaded:', JSON.stringify(ready.sync));

    for (const job of opts.jobs) {
      const res = await page.evaluate(async ({ job, apply, probe, fit, layout, randomOrder, headerColumn, TABLE_WIDTH }) => {
        const c = window.Rem(window.CURRENT_KNOWLEDGE_BASE);
        const methodsOf = (o) => { const out = []; let p = Object.getPrototypeOf(o); while (p && p !== Object.prototype) { out.push(...Object.getOwnPropertyNames(p)); p = Object.getPrototypeOf(p); } return [...new Set(out)]; };
        const children = async (id) => {
          if (typeof c.findAsync === 'function') return await c.findAsync({ parent: id });
          const cur = c.find({ parent: id });
          return typeof cur.fetchAsync === 'function' ? await cur.fetchAsync() : cur.fetch();
        };
        const text = (r) => (r.key || []).map((k) => (typeof k === 'string' ? k : k?.text ?? '')).join('').trim();
        const table = await c.findOneAsync(job.table);
        if (!table) return { table: job.table, error: 'table not found' };
        const headerRef = (table.ps?.sp_q?.v?.v || []).find((x) => x && typeof x === 'object' && x._id);
        if (!headerRef) return { table: job.table, error: 'not a table (no header reference)' };
        const header = await c.findOneAsync(headerRef._id);
        // Columns load with the rest of the knowledge base; wait for them rather than assume.
        let cols = [];
        for (let i = 0; i < 90 && !cols.length; i++) {
          // The header's column-order map (tco) lists every column id; look each up directly,
          // since find-by-parent only searches notes already in memory.
          const ids = Object.keys(header.tco || {}).filter((id) => id !== header._id);
          const byId = (await Promise.all(ids.map((id) => c.findOneAsync(id)))).filter((k) => k?.apu?.y);
          cols = byId.length ? byId : (await children(header._id)).filter((k) => k.apu?.y);
          if (!cols.length) await new Promise((r) => setTimeout(r, 2000));
        }
        if (!cols.length) return { table: job.table, error: 'columns did not load within 3 minutes' };
        if (probe) {
          return {
            table: job.table,
            collMethods: methodsOf(c).filter((m) => /find|fetch/i.test(m)),
            columns: cols.map((x) => ({ id: x._id, name: text(x), gc: x.gc })),
            tableWidthMethods: methodsOf(table).filter((m) => /width|Width|fit|Fit|Column|Table|table|Card|card|Context|Layout|ttic|Practice/.test(m)),
            tw: table.tw ?? null, ttic: table.ttic ?? null, tcld: table.tcld ?? null,
            randomOrder: table.getPowerupProperty('cc', 't') ?? null,
          };
        }
        const plan = [];
        for (const [name, dir] of Object.entries(job.columns)) {
          const col = cols.find((x) => text(x) === name.trim());
          if (!col) return { table: job.table, error: `no column "${name}"; columns: ${cols.map(text).join(', ')}` };
          plan.push({ name, dir, col, before: col.gc ?? null });
        }
        const roBefore = table.getPowerupProperty('cc', 't') ?? null;
        if (randomOrder !== undefined && layout !== 'show_entire_table' && !table.apu?.cc?.v)
          return { table: job.table, error: 'Test Rows In Random Order needs "Show Entire Table" (Card Cluster powerup on the table); add --layout table' };
        if (!apply) return { table: job.table, headerColumn: headerColumn === undefined ? undefined : { before: { stsh: table.stsh ?? null, stsc: table.stsc ?? null }, set: headerColumn }, randomOrder: randomOrder === undefined ? undefined : { before: roBefore, set: randomOrder }, layout: layout === undefined ? undefined : { before: { cardClusterPowerup: !!table.apu?.cc?.v, ttic: table.ttic ?? null }, set: layout, canEnable: table.canEnableTableTestShowEntireTable() }, preview: plan.map((p) => ({ column: p.name, before: p.before, set: p.dir })) };
        const after = [];
        if (fit) {
          // "Fit to table": equal column widths across the table, stored on the table as tw
          // (same shape as RemNote writes: {columnId: {w: px}}, the row-name column keyed by the header id).
          const colIds = [header._id, ...Object.keys(header.tco || {}).filter((id) => id !== header._id)];
          const w = TABLE_WIDTH / colIds.length;
          await table.update({ tw: Object.fromEntries(colIds.map((id) => [id, { w }])) });
        }
        if (layout !== undefined) {
          // Same call as the table's "Show Entire Table" / "Test Individual Cells" menu items.
          if (layout === 'show_entire_table' && !table.canEnableTableTestShowEntireTable()) return { table: job.table, error: 'RemNote says this is not the primary table for its tag' };
          await table.setTableTestShowEntireTable(layout);
          const want = { show_entire_table: { cc: true, ttic: false }, test_individual_cells: { cc: false, ttic: true }, none: { cc: false, ttic: false } }[layout];
          let st;
          for (let i = 0; i < 20; i++) { const t = await c.findOneAsync(job.table); st = { cc: !!t?.apu?.cc?.v, ttic: !!t?.ttic }; if (st.cc === want.cc && st.ttic === want.ttic) break; await new Promise((r) => setTimeout(r, 500)); }
          after.push({ layout: st.cc ? 'Show Entire Table' : st.ttic ? 'Test Individual Cells' : "Don't Generate Cards", cardClusterPowerup: st.cc, ttic: st.ttic, ok: st.cc === want.cc && st.ttic === want.ttic });
        }
        if (headerColumn !== undefined) {
          // The table menu's "Header Column" toggle (shades the row-name column). Off for tables with a blank row-name column.
          const before = { stsh: table.stsh ?? null, stsc: table.stsc ?? null };
          await (await c.findOneAsync(job.table)).setShowHeaderColumn(headerColumn);
          await new Promise((r) => setTimeout(r, 1500));
          const t3 = await c.findOneAsync(job.table);
          // Stored as stsc (show table header column); checked 12 Oct 2026.
          after.push({ headerColumn, before, now: { stsc: t3.stsc ?? null }, ok: (t3.stsc ?? true) === headerColumn });
        }
        if (randomOrder !== undefined) {
          // Same call as the "Test Rows In Random Order" switch in the table's flashcard menu.
          const t = await c.findOneAsync(job.table);
          await t.setPowerupProperty('cc', 't', [randomOrder]);
          let v;
          for (let i = 0; i < 20; i++) { v = (await c.findOneAsync(job.table))?.getPowerupProperty('cc', 't'); if (v === randomOrder) break; await new Promise((r) => setTimeout(r, 500)); }
          const t2 = await c.findOneAsync(job.table);
          after.push({ randomOrder: v ?? null, before: roBefore, cardClusterPowerup: !!t2?.apu?.cc?.v, ttic: !!t2?.ttic, ok: v === randomOrder && !!t2?.apu?.cc?.v });
        }
        for (const p of plan) {
          // Same call as the table card menu: saves the column direction, then applies it to every cell.
          const col = await c.findOneAsync(p.col._id);
          await col.setColumnGenerateCardsDirection(p.dir === 'none' ? undefined : p.dir);
          let gc;
          for (let i = 0; i < 20; i++) { gc = (await c.findOneAsync(p.col._id))?.gc; if ((gc ?? 'none') === p.dir) break; await new Promise((r) => setTimeout(r, 500)); }
          // Check the cells too: setColumnGenerateCardsDirection finds them through column.referenceRemsAsync(),
          // which misses cells created moments earlier (e.g. by the MCP set_property tool) until the app indexes them.
          const wantEfc = p.dir !== 'none' ? false : true;
          let cells = [];
          for (let i = 0; i < 30; i++) {
            const colNow = await c.findOneAsync(p.col._id);
            cells = (await colNow.referenceRemsAsync()).filter((r) => r.getSlotThisRepresentsId() == p.col._id);
            if (cells.length && cells.every((r) => !!r.efc === wantEfc)) break;
            if (i === 10) await colNow.applyColumnDirectionToInstances();
            await new Promise((r) => setTimeout(r, 1000));
          }
          const cellsOk = cells.length > 0 && cells.every((r) => !!r.efc === wantEfc);
          after.push({ column: p.name, gc: gc ?? null, cells: cells.map((r) => ({ id: r._id, efc: r.efc ?? null })), ok: (gc ?? 'none') === p.dir && cellsOk });
        }
        return { table: job.table, applied: true, after, error: after.every((x) => x.ok) ? undefined : 'a setting did not save' };
      }, { job, apply: opts.apply, probe: opts.probe, fit: opts.fit, layout: opts.layout ? LAYOUTS[opts.layout] : undefined, randomOrder: opts.randomOrder ? RANDOM_ORDER[opts.randomOrder] : undefined, headerColumn: opts.headerColumn ? opts.headerColumn === 'on' : undefined, TABLE_WIDTH });
      console.log(JSON.stringify(res, null, 1));
    }

    if (opts.apply) {
      await new Promise((r) => setTimeout(r, 3000));
      const done = await waitFor(page, 'save and sync to finish', (s) => { const st = (0, eval)(`(${s})`)(); return { ok: st.saving === false && st.unsynced === 0 && st.haveUnsynced === false, st }; }, SYNC_STATE.toString(), 3 * 60000);
      console.log('Synced:', JSON.stringify(done.st));
      // The counter above reads 0 in this window even before upload (12 Oct 2026: writes made just before
      // closing reached the server only when the profile was next opened). Keep the page open a while.
      console.log(`Holding ${opts.hold}s for upload`);
      await new Promise((r) => setTimeout(r, opts.hold * 1000));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
