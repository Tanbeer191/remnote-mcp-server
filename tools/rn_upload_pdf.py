"""Upload a local PDF to RemNote's file storage as the logged-in desktop user.

Usage: python3 rn_upload_pdf.py <file.pdf|.jpg|.jpeg|.png>
Images (13 Oct 2026) go through the same route; insert them with Markdown ![caption](url).
Prints the uploaded file's permanent URL. The auth token is read from the
RemNote desktop app's localStorage into memory only — never printed or saved.

Flow (same as the RemNote app): POST /files/upload_pdf -> presigned S3 PUT (valid 60 s).
"""
import json
import os
import secrets
import string
import sys
import urllib.request

from rn_localstorage import get_item

BACKEND = "https://backend.remnote.com"
# Cloudflare rejects Python's default User-Agent (error 1010); send a browser one.
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/138.0 Safari/537.36")


def _rand(n):
    # Same alphabet as names the app generates (letters, digits, '-', '_').
    abc = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(abc) for _ in range(n))


TYPES = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def upload_pdf(path):
    token = get_item("userToken")
    if not token:
        raise SystemExit("No userToken found — is the RemNote desktop app logged in?")
    ext = os.path.splitext(path)[1].lower()
    ctype = TYPES[ext]
    data = open(path, "rb").read()
    body = json.dumps({
        "fileType": ctype,
        "fileSize": len(data),
        # The server rejects other lengths ("File name has invalid length"); the app sends 128 + ".pdf".
        "forceFileName": f"{_rand(128)}{'.jpg' if ext == '.jpeg' else ext}",
    }).encode()
    req = urllib.request.Request(
        f"{BACKEND}/files/upload_pdf", data=body, method="POST",
        headers={"Content-Type": "application/json", "x-auth-token": token,
                 "Origin": "https://www.remnote.com", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if "signedRequest" not in res:
        raise SystemExit(f"RemNote refused the upload: {json.dumps(res)[:500]}")
    put = urllib.request.Request(res["signedRequest"], data=data, method="PUT",
                                 headers={"Content-Type": ctype})
    with urllib.request.urlopen(put, timeout=300) as r:
        if r.status != 200:
            raise SystemExit(f"S3 upload failed: HTTP {r.status}")
    return res["url"]


if __name__ == "__main__":
    if len(sys.argv) != 2 or os.path.splitext(sys.argv[1])[1].lower() not in TYPES:
        raise SystemExit(__doc__)
    print(upload_pdf(os.path.expanduser(sys.argv[1])))
