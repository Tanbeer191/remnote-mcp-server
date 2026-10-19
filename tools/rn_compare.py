#!/usr/bin/env python3
"""Snapshot a RemNote lecture document before a lecture, and compare it afterwards.

Read-only: works on a copy of the desktop database, never the live file.

  rn_compare.py snapshot <docRemId> <out.json>      save every note under the document
  rn_compare.py compare  <snapshot.json>            list new / edited / deleted notes by heading,
                                                    plus words newly bolded, italicised, underlined
                                                    or highlighted
  Option: --db <remnote.db>  use this database file instead of copying the desktop one.

Formatting is stored per text span in a note's `key`: b = bold, l = italic, u = underline,
h = highlight colour. Snapshots taken before 13 Oct 2026 hold plain text only; for those,
formatting found in template notes is listed as "formatting (no baseline)".
"""
import json, os, re, shutil, sqlite3, sys, tempfile, datetime, glob

# Desktop database: REMNOTE_DB if set, else the largest ~/remnote/remnote-<knowledge base id>/remnote.db.
DESKTOP = ([os.environ['REMNOTE_DB']] if os.environ.get('REMNOTE_DB') else
           sorted((f for f in glob.glob(os.path.expanduser('~/remnote/remnote-*/remnote.db'))
                   if re.fullmatch(r'remnote-[0-9a-f]{24}', os.path.basename(os.path.dirname(f)))),
                  key=os.path.getsize, reverse=True))
FMT = {'b': 'bold', 'l': 'italic', 'u': 'underline', 'h': 'highlight'}


def load_db(path=None):
    tmp = tempfile.mkdtemp()
    src = path or DESKTOP[0]
    for f in glob.glob(src + '*'):  # db plus -wal / -shm, so recent edits are included
        shutil.copy(f, tmp)
    db = sqlite3.connect(os.path.join(tmp, os.path.basename(src)))
    q = {r[0]: json.loads(r[1]) for r in db.execute('select _id, doc from quanta')}
    shutil.rmtree(tmp)
    return q


def children(q):
    kids = {}
    for i, r in q.items():
        kids.setdefault(r.get('parent'), []).append(i)
    for v in kids.values():
        v.sort(key=lambda i: str(q[i].get('f', '')))
    return kids


def render(arr):
    return ''.join(x if isinstance(x, str) else (f"[[id:{x['_id']}]]" if x.get('i') == 'q' else x.get('text') or '')
                   for x in arr or [])


def plain(q, i, d=0):
    return ''.join(x if isinstance(x, str) else (x.get('text') or (plain(q, x['_id'], d + 1) if x.get('i') == 'q' and d < 2 else ''))
                   for x in q.get(i, {}).get('key', []))


def spans(arr):
    """(format, text) pairs for formatted spans in a note's rich text."""
    out = set()
    for x in arr or []:
        if isinstance(x, dict) and x.get('i') == 'm' and (x.get('text') or '').strip():
            for k, name in FMT.items():
                if x.get(k):
                    out.add((name, x['text'].strip()))
    return out


def snapshot(doc, out, dbpath):
    q = load_db(dbpath); kids = children(q); notes = []

    def walk(p, depth):
        for i in kids.get(p, []):
            r = q[i]
            notes.append(dict(id=i, parent=p, depth=depth, text=render(r.get('key')), back=render(r.get('value')),
                              key=r.get('key'), value=r.get('value'), created=r.get('createdAt'), edited=r.get('u')))
            walk(i, depth + 1)
    walk(doc, 1)
    json.dump({'doc': doc, 'taken': datetime.datetime.now().strftime('%Y-%m-%dT%H:%M'), 'notes': notes},
              open(out, 'w'), indent=1, ensure_ascii=False)
    print(f'{len(notes)} notes saved to {out}')


def compare(snap_path, dbpath):
    snap = json.load(open(snap_path)); q = load_db(dbpath); kids = children(q)
    if isinstance(snap, list):  # first snapshot layout (GH L1, 12 Oct): a list of notes with raw keys
        doc = next(n['parent'] for n in snap if n.get('depth') == 0)
        snap = {'doc': doc, 'notes': [dict(n, text=render(n.get('key')), back=render(n.get('value'))) for n in snap]}
    S = {n['id']: n for n in snap['notes']}; doc = snap['doc']
    seen, heading, rows = set(), '(top of document)', []

    def walk(p, depth):
        nonlocal heading
        for i in kids.get(p, []):
            seen.add(i); r = q[i]; t = render(r.get('key'))
            if depth == 1 and (r.get('h') or t.startswith('[[id:')):
                heading = plain(q, i) or heading
            txt = plain(q, i)
            if i not in S:
                if txt.strip():
                    rows.append((heading, 'NEW', '  ' * (depth - 1) + txt, ''))
            else:
                old = S[i]
                if old['text'] != t:
                    rows.append((heading, 'EDITED', txt, old['text']))
                now = spans(r.get('key')) | spans(r.get('value'))
                if 'key' in old:
                    added = now - (spans(old.get('key')) | spans(old.get('value')))
                    tag = 'FORMAT'
                else:
                    added, tag = now, 'FORMAT (no baseline)'
                for fmt, s in sorted(added):
                    rows.append((heading, tag, f'{fmt}: "{s}"', txt[:80]))
            if i not in S:  # formatting inside the user's own new notes
                for fmt, s in sorted(spans(r.get('key')) | spans(r.get('value'))):
                    rows.append((heading, 'FORMAT', f'{fmt}: "{s}"', '(in a new note)'))
            walk(i, depth + 1)
    walk(doc, 1)
    deleted = [n for n in snap['notes'] if n['id'] not in seen]

    last = None
    for h, kind, a, b in rows:
        if h != last:
            print(f'\n## {h}'); last = h
        line = f'  {kind:<8} {a}'
        if kind == 'EDITED':
            line += f'\n           was: {b}'
        elif kind.startswith('FORMAT'):
            line += f'   [{b}]'
        print(line)
    if deleted:
        print('\n## Deleted since the snapshot')
        for n in deleted:
            print('  ', n['text'][:120])
    counts = {k: sum(1 for r in rows if r[1].startswith(k)) for k in ('NEW', 'EDITED', 'FORMAT')}
    print(f"\n{counts['NEW']} new, {counts['EDITED']} edited, {counts['FORMAT']} formatted spans, {len(deleted)} deleted")


if __name__ == '__main__':
    args = sys.argv[1:]
    dbpath = None
    if '--db' in args:
        k = args.index('--db'); dbpath = args[k + 1]; del args[k:k + 2]
    if args[:1] == ['snapshot'] and len(args) == 3:
        snapshot(args[1], args[2], dbpath)
    elif args[:1] == ['compare'] and len(args) == 2:
        compare(args[1], dbpath)
    else:
        print(__doc__); sys.exit(1)
