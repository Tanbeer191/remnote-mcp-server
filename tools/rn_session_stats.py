#!/usr/bin/env python3
"""Read-only flashcard session report from a COPY of the RemNote desktop database.

Usage: rn_session_stats.py <copy/remnote.db> [YYYY-MM-DD] [--json out.json]
Groups reviews on that day by session gap (>30 min = new session); per card: first-try result,
number of Forgot ratings, final rating, next due. Scores: 0 Forgot, 0.5 Partially recalled,
1 Recalled with effort, 1.5 Easily recalled (RemNote's buttons).
"""
import sqlite3, json, sys, time, datetime as dt
db_path = sys.argv[1]
day = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else dt.date.today().isoformat()
out = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
db = sqlite3.connect(db_path)
q = {r[0]: json.loads(r[1]) for r in db.execute("select _id, doc from quanta")}
def text(i, depth=0):
    d = q.get(i) or {}
    t = ''.join(x if isinstance(x, str) else (x.get('text') or (text(x['_id'], depth + 1) if x.get('i') == 'q' and depth < 2 else '')) for x in d.get('key', []))
    return t.strip()
def path(i):
    names, d = [], q.get(i)
    while d and d.get('parent'):
        d = q.get(d['parent']); names.append(text(d['_id']) if d else '')
    return [n for n in reversed(names) if n]
start = time.mktime(time.strptime(day, "%Y-%m-%d")) * 1000; end = start + 86400000
NAMES = {0: 'Forgot', 0.5: 'Partial', 1: 'Recalled with effort', 1.5: 'Easily recalled'}
cards, reviews = [], []
for (doc,) in db.execute("select doc from cards"):
    c = json.loads(doc)
    h = [x for x in (c.get('h') or []) if isinstance(x, dict) and start <= (x.get('date') or 0) < end]
    if not h: continue
    h.sort(key=lambda x: x['date'])
    rid = c.get('rId'); p = path(rid)
    cell = text(rid)
    card = dict(cardId=c['_id'], remId=rid, direction=c.get('c'), text=cell[:120], path=p,
                topic=' > '.join(p[-2:]) if p else '', firstScore=h[0].get('score'),
                forgotCount=sum(1 for x in h if x.get('score') == 0), reviewsToday=len(h),
                finalScore=h[-1].get('score'), nextDue=dt.datetime.fromtimestamp(c['n'] / 1000).isoformat(timespec='minutes') if c.get('n') else None,
                cram=all(x.get('isCram') for x in h), meanResponseS=round(sum(x.get('responseTime', 0) for x in h) / len(h) / 1000, 1))
    cards.append(card); reviews += [x['date'] for x in h]
reviews.sort()
sessions, s0 = [], None
for t in reviews:
    if s0 is None or t - prev > 30 * 60000:
        if s0 is not None: sessions.append((s0, prev))
        s0 = t
    prev = t
if s0 is not None: sessions.append((s0, prev))
fmt = lambda ms: dt.datetime.fromtimestamp(ms / 1000).strftime('%H:%M')
first_try = [c for c in cards if c['firstScore'] and c['firstScore'] >= 1]
struggled = sorted([c for c in cards if not (c['firstScore'] and c['firstScore'] >= 1)], key=lambda c: (-c['forgotCount'], c['text']))
report = dict(date=day, sessions=[dict(start=fmt(a), end=fmt(b), minutes=round((b - a) / 60000)) for a, b in sessions],
              cardsReviewed=len(cards), reviews=len(reviews), firstTryRecalled=len(first_try), struggled=len(struggled),
              byTopic={}, struggledCards=struggled, firstTryCards=first_try)
for c in cards:
    t = report['byTopic'].setdefault(c['path'][2] if len(c['path']) > 2 else c['topic'], dict(cards=0, firstTry=0, forgot=0))
    t['cards'] += 1; t['firstTry'] += c in first_try; t['forgot'] += c['forgotCount']
if out: json.dump(report, open(out, 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in report.items() if k not in ('struggledCards', 'firstTryCards')}, indent=1, ensure_ascii=False))
print('\nSTRUGGLED (forgot count, first score, final, next due):')
for c in struggled: print(f"  {c['forgotCount']}x  first={NAMES.get(c['firstScore'], c['firstScore'])}  final={NAMES.get(c['finalScore'], c['finalScore'])}  due {c['nextDue']}  [{c['direction']}] {c['text'][:90]}  ({c['topic'][:50]})")
