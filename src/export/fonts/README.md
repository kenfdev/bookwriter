# Embedded Japanese fonts

`regular.json` and `bold.json` contain base64-encoded, **unmodified** TrueType
files from M PLUS 1p. Encoding them as JSON keeps the synchronous PDF generator
usable in both Vite/Tauri and Node without network requests, filesystem APIs,
or separate font-loading setup. The PDF module is loaded only when exporting
from the app; decoded font faces are cached, and each PDF embeds each used Japanese face intact. Complete fonts preserve their
original tables and checksums for native viewer compatibility; character IDs and
Unicode maps remain local to each document.

- Copyright 2016 The M+ Project Authors.
- License: SIL Open Font License 1.1; the complete notice is in [`public/licenses/MPLUS1p-OFL.txt`](../../../public/licenses/MPLUS1p-OFL.txt)
  and is copied into the packaged app by Vite.
- Source: https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/mplus1p
- Files: `MPLUS1p-Regular.ttf`, `MPLUS1p-Bold.ttf`.
- Both faces contain 8,331 mapped Unicode code points, including kana and common
  Japanese kanji. This is the bundled font's repertoire, not all Unicode.

To reproduce a JSON asset from the corresponding source TTF (Python 3):

```python
import base64, json
from pathlib import Path
for face in ("Regular", "Bold"):
    data = Path(f"MPLUS1p-{face}.ttf").read_bytes()
    Path(f"{face.lower()}.json").write_text(json.dumps(base64.b64encode(data).decode()) + "\n")
```

Original-file SHA-256 checksums:
2f294ad496432b1608f070d310e3aa2adcf1de4af429f4901df97ec4bd361ed1  MPLUS1p-Regular.ttf
76eb077b0a31ca33ca40238e47da5a17e2786741607cec09678d7d2e5ab1afc1  MPLUS1p-Bold.ttf
