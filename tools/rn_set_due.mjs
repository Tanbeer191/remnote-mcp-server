#!/usr/bin/env node
/**
 * Set RemNote flashcard due dates through the RemNote web app, using RemNote's own
 * internal card API (the same call RemNote's schedule editor makes). The app then saves,
 * adds to undo history and syncs the change itself. Existing review history is not edited:
 * one "manual date" entry (score 4, forceNextRevealDate) is appended per card.
 *
 * Usage:
 *   node rn_set_due.mjs --login                      # first run: log in to RemNote in the window
 *   node rn_set_due.mjs <cardId>=<date> [...]        # preview (default)
 *   node rn_set_due.mjs --apply <cardId>=<date> ...  # apply
 *   options: --show (visible window), --profile <dir>
 * <date> is an ISO date/time (e.g. 2026-10-20 or 2026-10-20T09:00) and must not be in the past.
 *
 * Uses a dedicated Chrome profile (default ~/.remnote-automation-chrome) because Chrome does
 * not allow remote control of the normal profile. The login there is yours; this script never
 * reads or prints it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = 'https://www.remnote.com/';
const MANUAL_DATE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Knowledge base id from the desktop app's data folder ~/remnote/remnote-<id>/ (the largest database wins). */
function detectKb() {
  const root = path.join(os.homedir(), 'remnote');
  let best = null;
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const m = /^remnote-([0-9a-f]{24})$/.exec(name);
    const db = path.join(root, name, 'remnote.db');
    if (m && fs.existsSync(db) && (!best || fs.statSync(db).size > best.size)) best = { id: m[1], size: fs.statSync(db).size };
  }
  return best ? best.id : null;
}

function parseArgs(argv) {
  const opts = {
    apply: false,
    login: false,
    show: false,
    profile: path.join(os.homedir(), '.remnote-automation-chrome'),
    kb: process.env.REMNOTE_KB || detectKb(), // --kb or REMNOTE_KB to choose another knowledge base
    jobs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--login') opts.login = true;
    else if (a === '--diagnose') opts.diagnose = true;
    else if (a === '--show') opts.show = true;
    else if (a === '--profile') opts.profile = argv[++i];
    else if (a === '--kb') opts.kb = argv[++i];
    else if (a.includes('=')) {
      const [cardId, date] = a.split('=');
      const dueMs = Date.parse(date);
      if (!cardId || !Number.isFinite(dueMs)) throw new Error(`Bad job "${a}" (want cardId=YYYY-MM-DD)`);
      if (dueMs < Date.now() - DAY_MS) throw new Error(`Date in the past: ${a}`);
      opts.jobs.push({ cardId, dueMs });
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

/**
 * Wait until some tab shows RemNote logged in with the expected knowledge base loaded.
 * RemNote defines window.Cards even when logged out (empty local KB), so also require:
 * a login token present (existence only — the value is never read out of the page),
 * the expected knowledge base, and no "Upgrading your Knowledge Base" screen.
 * Polls every tab and survives reloads/redirects (login navigates the page).
 * Returns the ready page.
 */
async function waitForRemNote(browser, kbId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!browser.connected) throw new Error('Chrome window was closed');
    for (const page of await browser.pages()) {
      if (!page.url().startsWith('https://www.remnote.com')) continue;
      try {
        const ready = await page.evaluate(
          (kb) =>
            typeof window.Cards === 'function' &&
            // CURRENT_KNOWLEDGE_BASE is a placeholder string RemNote resolves internally, not the
            // KB id, so check the open KB from the address (/w/<kbId>/...).
            location.pathname.startsWith(`/w/${kb}`) &&
            !!localStorage.getItem('userToken') &&
            !location.pathname.startsWith('/migrating'),
          kbId
        );
        if (ready) return page;
      } catch {
        // Page navigating or reloading; try again on the next poll.
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`RemNote not ready after ${Math.round(timeoutMs / 1000)} s`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const headless = !(opts.login || opts.show);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    userDataDir: opts.profile,
    headless,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    if (opts.diagnose) {
      const page = (await browser.pages())[0] ?? (await browser.newPage());
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const d = await page.evaluate(() => ({
            path: location.pathname.split('/').slice(0, 3).join('/'),
            hasCards: typeof window.Cards === 'function',
            kb: typeof window.CURRENT_KNOWLEDGE_BASE === 'string' ? window.CURRENT_KNOWLEDGE_BASE : null,
            // Key names only (no values) that look login-related, to find where the token lives.
            loginKeys: Object.keys(localStorage).filter((k) => /token|auth|user/i.test(k)),
          }));
          console.log(`${(i + 1) * 5}s`, JSON.stringify(d));
        } catch (e) {
          console.log(`${(i + 1) * 5}s page busy: ${e.message.slice(0, 80)}`);
        }
      }
      return;
    }
    if (!opts.login && opts.jobs.length === 0) throw new Error('No cardId=date jobs given');
    const first = (await browser.pages())[0] ?? (await browser.newPage());
    await first.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    const started = Date.now();

    if (opts.login) {
      console.log('Log in to RemNote in the Chrome window. Waiting up to 15 minutes...');
      await waitForRemNote(browser, opts.kb, 15 * 60 * 1000);
      console.log(`Logged in and knowledge base loaded after ${Math.round((Date.now() - started) / 1000)} s.`);
      return;
    }

    let page;
    try {
      page = await waitForRemNote(browser, opts.kb, 5 * 60 * 1000);
    } catch (e) {
      throw new Error(`RemNote did not load (${e.message}). If not logged in here, run with --login.`);
    }
    console.log(`RemNote ready after ${Math.round((Date.now() - started) / 1000)} s.`);

    for (const { cardId, dueMs } of opts.jobs) {
      const res = await page.evaluate(
        async ({ cardId, dueMs, apply, MANUAL_DATE }) => {
          const coll = window.Cards(window.CURRENT_KNOWLEDGE_BASE);
          const card = await coll.findOneAsync(cardId);
          if (!card) return { cardId, error: 'card not found in this knowledge base' };
          if (typeof card.updateCardRepetitionStatus !== 'function')
            return { cardId, error: 'RemNote internal card API changed' };
          const before = card.n ?? null;
          if (!apply) return { cardId, remId: card.rId, before, wouldSet: dueMs, applied: false };
          // Same arguments as RemNote's schedule editor:
          // (queueItem, score, responseTime, revealTime, isCram, subQueueId, metadata, <flag>,
          //  addedExternally, forceNextRevealDate)
          await card.updateCardRepetitionStatus(
            { schedulerMetadata: {} }, MANUAL_DATE, 0, 0, false, undefined, {}, true, true, dueMs
          );
          const after = await coll.findOneAsync(cardId);
          return { cardId, remId: card.rId, before, after: after?.n ?? null, applied: true };
        },
        { cardId, dueMs, apply: opts.apply, MANUAL_DATE }
      );
      const fmt = (ms) => (ms ? new Date(ms).toISOString() : '—');
      if (res.error) console.log(`${cardId}: ERROR ${res.error}`);
      else if (!res.applied)
        console.log(`${cardId} (rem ${res.remId}): due ${fmt(res.before)} -> would set ${fmt(res.wouldSet)} [preview]`);
      else console.log(`${cardId} (rem ${res.remId}): due ${fmt(res.before)} -> ${fmt(res.after)} [applied]`);
    }

    if (opts.apply) {
      // Give the web app time to push the change to RemNote's servers before closing.
      console.log('Waiting 20 s for sync...');
      await new Promise((r) => setTimeout(r, 20000));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
