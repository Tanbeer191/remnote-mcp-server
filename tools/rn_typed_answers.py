#!/usr/bin/env python3
"""Read-only report of typed flashcard answers that RemNote's AI marked.

RemNote does not keep typed answers in the card history. When a typed answer
is checked by RemNote's AI, the call is logged in the browser database
(~/remnote/browser/remnote.db, table persisted_logging, message
explain_flashcard_answer). That log is a ring buffer of the last 100 AI calls,
so run this after every session.

Copies the database (+ wal/shm) to a new temporary folder and reads the copy.
Usage: rn_typed_answers.py [YYYY-MM-DD] [--json out.json]
"""
import datetime as dt
import json
import os
import shutil
import sqlite3
import sys
import tempfile

SRC = os.path.expanduser('~/remnote/browser/')
day = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else dt.date.today().isoformat()
out = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None

tmp = tempfile.mkdtemp(prefix='rn_typed_')
for f in os.listdir(SRC):
    if f.startswith('remnote.db'):
        shutil.copy(os.path.join(SRC, f), tmp)
con = sqlite3.connect(f'file:{tmp}/remnote.db?immutable=1', uri=True)

start = dt.datetime.fromisoformat(day).timestamp() * 1000
end = start + 86400 * 1000
rows = []
for ts, js in con.execute(
        "select timestamp, json from persisted_logging where message like '%explain_flashcard_answer%'"
        " or json like '%explain_flashcard_answer%' order by timestamp"):
    if not (start <= (ts or 0) < end):
        continue
    j = json.loads(js) if isinstance(js, str) else (js or {})
    a = j.get('args', {})
    rows.append({
        'time': dt.datetime.fromtimestamp(ts / 1000).strftime('%H:%M'),
        'where': (a.get('context') or '').strip().splitlines()[-1:] or [''],
        'question': a.get('question'),
        'correct': a.get('correct_answer'),
        'typed': a.get('student_answer'),
        'assessment': a.get('assessment'),
        'ai': (j.get('response') or {}).get('output'),
    })
for r in rows:
    r['where'] = r['where'][0]
    print(f"{r['time']}  {r['assessment']}  [{r['where']}] {r['question']}")
    print(f"    typed:   {r['typed']}")
    print(f"    correct: {r['correct']}")
print(f'{len(rows)} typed answers on {day}')
if out:
    with open(out, 'w') as f:
        json.dump({'date': day, 'answers': rows}, f, ensure_ascii=False, indent=1)
