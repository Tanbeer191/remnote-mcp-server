"""Read the RemNote desktop app's localStorage (Chromium LevelDB) without extra packages.

Used to fetch the app's own `userToken` in memory so scripts can call RemNote's
backend as the logged-in user. Never print or store the token.
"""
import os
import struct

LS_DIR = os.path.expanduser("~/Library/Application Support/RemNote/Local Storage/leveldb")


def _varint(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        if x < 0x80:
            return r, i
        s += 7


def _snappy(b):
    n, i = _varint(b, 0)
    out = bytearray()
    while i < len(b):
        t = b[i]
        i += 1
        k = t & 3
        if k == 0:  # literal
            ln = t >> 2
            if ln >= 60:
                nb = ln - 59
                ln = int.from_bytes(b[i:i + nb], "little")
                i += nb
            ln += 1
            out += b[i:i + ln]
            i += ln
            continue
        if k == 1:
            ln = ((t >> 2) & 7) + 4
            off = ((t >> 5) << 8) | b[i]
            i += 1
        elif k == 2:
            ln = (t >> 2) + 1
            off = int.from_bytes(b[i:i + 2], "little")
            i += 2
        else:
            ln = (t >> 2) + 1
            off = int.from_bytes(b[i:i + 4], "little")
            i += 4
        for _ in range(ln):
            out.append(out[-off])
    assert len(out) == n
    return bytes(out)


def _block(f, off, size):
    f.seek(off)
    raw = f.read(size + 5)
    data, ctype = raw[:size], raw[size]
    return _snappy(data) if ctype == 1 else data


def _entries(block):
    nrest = struct.unpack("<I", block[-4:])[0]
    end = len(block) - 4 - 4 * nrest
    i, key = 0, b""
    while i < end:
        shared, i = _varint(block, i)
        nonshared, i = _varint(block, i)
        vlen, i = _varint(block, i)
        key = key[:shared] + block[i:i + nonshared]
        i += nonshared
        yield key, block[i:i + vlen]
        i += vlen


def _table(path):
    with open(path, "rb") as f:
        f.seek(-48, 2)
        foot = f.read(48)
        _, j = _varint(foot, 0)
        _, j = _varint(foot, j)
        ioff, j = _varint(foot, j)
        isz, j = _varint(foot, j)
        for _, handle in _entries(_block(f, ioff, isz)):
            off, k = _varint(handle, 0)
            sz, _ = _varint(handle, k)
            for ikey, val in _entries(_block(f, off, sz)):
                seq = struct.unpack("<Q", ikey[-8:])[0]
                yield ikey[:-8], seq >> 8, seq & 0xFF, val


def _log(path):
    data = open(path, "rb").read()
    recs, i, buf = [], 0, b""
    while i + 7 <= len(data):
        blk_left = 32768 - (i % 32768)
        if blk_left < 7:
            i += blk_left
            continue
        ln, typ = struct.unpack("<H", data[i + 4:i + 6])[0], data[i + 6]
        payload = data[i + 7:i + 7 + ln]
        i += 7 + ln
        if typ in (1,):
            recs.append(payload)
        elif typ == 2:
            buf = payload
        elif typ == 3:
            buf += payload
        elif typ == 4:
            recs.append(buf + payload)
    for r in recs:
        seq, count = struct.unpack("<QI", r[:12])
        j = 12
        for n in range(count):
            kind = r[j]
            j += 1
            kl, j = _varint(r, j)
            key = r[j:j + kl]
            j += kl
            val = b""
            if kind == 1:
                vl, j = _varint(r, j)
                val = r[j:j + vl]
                j += vl
            yield key, seq + n, kind, val


def read_all(ls_dir=LS_DIR):
    """Return {key_bytes: value_bytes} with the newest live value per key."""
    best = {}
    for name in os.listdir(ls_dir):
        p = os.path.join(ls_dir, name)
        it = _table(p) if name.endswith(".ldb") else _log(p) if name.endswith(".log") else ()
        for key, seq, kind, val in it:
            if key not in best or seq > best[key][0]:
                best[key] = (seq, kind, val)
    return {k: v for k, (s, kind, v) in best.items() if kind == 1}


def _decode(v):
    if v[:1] == b"\x01":
        return v[1:].decode("latin-1")
    if v[:1] == b"\x00":
        return v[1:].decode("utf-16-le")
    return v.decode("utf-8", "replace")


def get_item(name, ls_dir=LS_DIR):
    """Return the localStorage value for `name` from the RemNote app origin, or None."""
    items = read_all(ls_dir)
    for origin in (b"_app://js", b"_file://"):  # current app origin first, legacy second
        val = items.get(origin + b"\x00\x01" + name.encode())
        if val is not None:
            return _decode(val)
    return None


if __name__ == "__main__":
    # Lists key names and value lengths only — never values.
    for key, val in sorted(read_all().items()):
        if key.startswith(b"_"):
            origin, _, k = key[1:].partition(b"\x00\x01")
            print(origin.decode("utf-8", "replace"), "|", k.decode("utf-8", "replace"), f"(length {len(val)})")
