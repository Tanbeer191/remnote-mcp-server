#!/usr/bin/env node
/**
 * Add a column (property) to a RemNote table through the RemNote web app, using RemNote's own
 * internal functions, the same steps as the table's "add column" code (onCreateSlot, read from
 * the web app's code 12 Oct 2026): header.createSlotForTag() (new Rem under the table's header,
 * setIsSlot(true) -> apu.y), set its key (the column name), setPropertyLocation(<same as the other
 * columns, "label">), then header.setColumnOrderInTable([...]) to write the header's `tco` order map.
 * The new column has no flashcards (`gc` unset); switch them on with rn_table_cards.mjs.
 * Cells are not created here; fill them with the MCP tool remnote_set_property.
 *
 * Usage:
 *   node rn_table_add_column.mjs <tableRemId> <name> --after <column> [--profile <dir>] [--show]   # preview
 *   node rn_table_add_column.mjs --apply <tableRemId> <name> --after <column>                      # apply
 *   Several tables: repeat "<tableRemId> <name> --after <column>" separated by "--".
 * Refuses if a column with that name already exists. Uses the Chrome profile ~/.remnote-automation-chrome.
 * After applying it keeps the page open (--hold seconds, default 90) so the change uploads: RemNote's
 * "unsynced changes" counter reads 0 in this window even before upload (sync status stays "dl.Initializing").
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = 'https://www.remnote.com/';

function parseArgs(argv) {
  const o = { apply: false, show: false, hold: 90, profile: path.join(os.homedir(), '.remnote-automation-chrome'), jobs: [] };
  let cur = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--show') o.show = true;
    else if (a === '--hold') o.hold = Number(argv[++i]);
    else if (a === '--profile') o.profile = argv[++i];
    else if (a === '--after') cur.after = argv[++i];
    else if (a === '--') cur = null;
    else if (!cur) { cur = { table: a }; o.jobs.push(cur); }
    else cur.name = a;
  }
  for (const j of o.jobs) if (!j.name || !j.after) throw new Error(`Job ${j.table}: need <name> and --after <column>`);
  if (!o.jobs.length) throw new Error('No table given');
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = await puppeteer.launch({ executablePath: CHROME, userDataDir: opts.profile, headless: !opts.show, defaultViewport: null, protocolTimeout: 600000, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    let ok = false;
    for (let i = 0; i < 150 && !ok; i++) {
      ok = await page.evaluate(() => typeof window.Rem === 'function' && location.pathname.startsWith('/w/') && !!localStorage.getItem('userToken')).catch(() => false);
      if (!ok) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!ok) throw new Error('RemNote did not load (login needed?)');
    for (const job of opts.jobs) {
      const res = await page.evaluate(async ({ job, apply }) => {
        const c = window.Rem(window.CURRENT_KNOWLEDGE_BASE);
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const text = (r) => (r?.key || []).map((k) => (typeof k === 'string' ? k : k?.text ?? '')).join('').trim();
        let table;
        for (let i = 0; i < 90 && !table; i++) { table = await c.findOneAsync(job.table); if (!table) await sleep(2000); }
        if (!table) return { table: job.table, error: 'table not found' };
        const headerId = (table.ps?.sp_q?.v?.v || []).find((x) => x && typeof x === 'object' && x._id)?._id;
        if (!headerId) return { table: job.table, error: 'not a table' };
        const loadCols = async () => {
          const h = await c.findOneAsync(headerId);
          const ids = Object.entries(h.tco || {}).sort((a, b) => (a[1].f < b[1].f ? -1 : 1)).map(([id]) => id);
          const rems = await Promise.all(ids.map((id) => c.findOneAsync(id)));
          return { h, cols: rems.map((r, i) => ({ id: ids[i], rem: r, name: r ? (r._id === headerId ? '(row names)' : text(r)) : '?', f: h.tco[ids[i]].f, gc: r?.gc ?? null, opfl: r?.opfl ?? null })) };
        };
        let st;
        for (let i = 0; i < 90; i++) { st = await loadCols(); if (st.cols.length > 1 && st.cols.every((x) => x.rem)) break; await sleep(2000); }
        const show = (s) => s.cols.map((x) => ({ id: x.id, name: x.name, f: x.f, gc: x.gc, opfl: x.opfl }));
        if (st.cols.find((x) => x.name === job.name)) return { table: job.table, error: `column "${job.name}" already exists`, columns: show(st) };
        const afterIdx = st.cols.findIndex((x) => x.name === job.after);
        if (afterIdx < 0) return { table: job.table, error: `no column "${job.after}"`, columns: show(st) };
        const ref = st.cols[afterIdx].rem;
        const loc = ref.opfl;
        const allowed = ref.allowedPropertyLocationsForRem?.();
        if (!apply) return { table: job.table, header: headerId, columns: show(st), plan: { add: job.name, after: job.after, location: loc, allowedLocations: allowed, newOrder: [...st.cols.slice(0, afterIdx + 1).map((x) => x.name), job.name, ...st.cols.slice(afterIdx + 1).map((x) => x.name)] } };
        // Apply: RemNote's own steps.
        const slot = await st.h.createSlotForTag();
        if (!slot) return { table: job.table, error: 'createSlotForTag returned nothing (property paywall?)' };
        await slot.update({ key: [job.name] });
        if (loc) await slot.setPropertyLocation(loc);
        const order = [...st.cols.slice(0, afterIdx + 1).map((x) => x.rem), slot, ...st.cols.slice(afterIdx + 1).map((x) => x.rem)];
        await (await c.findOneAsync(headerId)).setColumnOrderInTable(order);
        let after;
        for (let i = 0; i < 20; i++) { await sleep(500); after = await loadCols(); if (after.cols.map((x) => x.id).join() === order.map((x) => x._id).join()) break; }
        const s2 = await c.findOneAsync(slot._id);
        const okOrder = after.cols.map((x) => x.id).join() === order.map((x) => x._id).join();
        return { table: job.table, applied: true, newColumn: { id: slot._id, key: s2.key, parent: s2.parent, apuY: !!s2.apu?.y?.v, opfl: s2.opfl, gc: s2.gc ?? null }, columns: show(after), error: okOrder && s2.parent === headerId && s2.apu?.y?.v ? undefined : 'verification failed' };
      }, { job, apply: opts.apply });
      console.log(JSON.stringify(res, null, 1));
    }
    if (opts.apply) { console.log(`Holding ${opts.hold}s for upload`); await new Promise((r) => setTimeout(r, opts.hold * 1000)); }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
