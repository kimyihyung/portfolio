# Vendored dependencies

Everything below is committed here on purpose. FileForge must work with **zero
external requests** — not to a CDN, not to a font host — so every library is
served from this folder, from the same origin as the page.

| File | Package | Version | License |
| --- | --- | --- | --- |
| `pdf-lib.min.js` | [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT (© Andrew Dillon) |
| `pdf.min.js`, `pdf.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 3.11.174 (legacy build) | Apache-2.0 (© Mozilla Foundation) |
| `cmaps/` | pdf.js character maps | 3.11.174 | Apache-2.0 / BSD-style (see `cmaps/LICENSE`) |
| `standard_fonts/` | pdf.js standard font data | 3.11.174 | see `standard_fonts/LICENSE_*` |

- pdf-lib writes PDFs (images → one PDF).
- pdf.js reads PDFs and rasterises pages (PDF → JPG / PNG / WebP).
- `cmaps/` and `standard_fonts/` are fetched by pdf.js **only when a PDF needs
  them** (CJK encodings, non-embedded base-14 fonts). They are same-origin
  requests, and they never leave the browser.

Upgrade by replacing the files together (`pdf.min.js` and `pdf.worker.min.js`
must stay on the same version) and bumping this table.
