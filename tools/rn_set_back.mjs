#!/usr/bin/env node
/**
 * Empty the back text (the `value` field) of RemNote rems through the RemNote web app, using
 * RemNote's own Rem functions. Used to turn a table cell that holds text into a "bulleted" cell
 * (empty value, one child per point). The MCP bridge cannot do
 * this: set_property with kind "clear" times out and an empty text is ignored (13 Oct 2026).
 *
 * Usage:
 *   node rn_set_back.mjs --probe <remId>            # list the Rem's methods that touch back text
 *   node rn_set_back.mjs <remId> [<remId> ...]      # preview: show current back text
 *   node rn_set_back.mjs --apply <remId> ...        # empty the back text, re-read, wait for sync
 * Uses the Chrome profile ~/.remnote-automation-chrome (already logged in). Keeps the page open
 * after applying (--hold seconds, default 60) so the change uploads.
 */
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = 'https://www.remnote.com/';

function parseArgs(argv) {
  const o = { apply: false, probe: false, show: false, hold: 60, profile: path.join(os.homedir(), '.remnote-automation-chrome'), ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--probe') o.probe = true;
    else if (a === '--show') o.show = true;
    else if (a === '--hold') o.hold = Number(argv[++i]);
    else if (a === '--profile') o.profile = argv[++i];
    else o.ids.push(a);
  }
  if (!o.ids.length) throw new Error('No rem id given');
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
    // wait until the rems have synced into this window
    for (let i = 0; i < 120; i++) {
      const found = await page.evaluate(async (ids) => { const c = window.Rem(window.CURRENT_KNOWLEDGE_BASE); return (await Promise.all(ids.map((id) => c.findOneAsync(id)))).every(Boolean); }, opts.ids).catch(() => false);
      if (found) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const res = await page.evaluate(async ({ ids, apply, probe }) => {
      const c = window.Rem(window.CURRENT_KNOWLEDGE_BASE);
      const methodsOf = (o) => { const out = []; let p = Object.getPrototypeOf(o); while (p && p !== Object.prototype) { out.push(...Object.getOwnPropertyNames(p)); p = Object.getPrototypeOf(p); } return [...new Set(out)]; };
      const out = [];
      for (const id of ids) {
        const r = await c.findOneAsync(id);
        if (!r) { out.push({ id, error: 'not found' }); continue; }
        if (probe) { out.push({ id, methods: methodsOf(r).filter((m) => /^(set|update|change|replace|edit)/i.test(m)).slice(0, 400) }); continue; }
        const before = r.value ?? null;
        if (!apply) { out.push({ id, before }); continue; }
        let used = null;
        for (const m of ['setBackText', 'setBack', 'setValue']) {
          if (typeof r[m] === 'function') { await r[m]([]); used = m; break; }
        }
        if (!used && typeof r.update === 'function') { await r.update({ value: [] }); used = 'update'; }
        let now = null;
        for (let i = 0; i < 20; i++) { now = (await c.findOneAsync(id))?.value ?? null; if (!now || (Array.isArray(now) && now.length === 0)) break; await new Promise((s) => setTimeout(s, 500)); }
        out.push({ id, used, before, now, ok: !now || (Array.isArray(now) && now.length === 0) });
      }
      return out;
    }, { ids: opts.ids, apply: opts.apply, probe: opts.probe });
    console.log(JSON.stringify(res, null, 1));
    if (opts.apply) {
      console.log(`Holding ${opts.hold}s for upload`);
      await new Promise((r) => setTimeout(r, opts.hold * 1000));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
