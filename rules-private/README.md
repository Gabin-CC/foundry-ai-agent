# Your private D&D 2024 rulebooks

You can put additional **lawfully obtained, text-readable PDF** rulebooks in
this folder, for example `Players_Handbook_2024.pdf`. Only the PDF files placed
directly in this folder are indexed (not subdirectories). Do not add D&D 2014
rules or house rules when your campaign uses D&D 2024 only.

Then run `npm run rules:setup` from the project root and restart the bridge.
The local `rules` MCP tools can search both the official SRD 5.2.1 and these
PDFs, and can report the source **filename and actual PDF page number**.
Re-run the command after adding, replacing or removing a PDF.

## Two categories: rules for everyone / GM content

All books are indexed once. Access is determined by their exact filename,
without splitting the PDF or uploading another copy:

- **Rules for everyone:** books explicitly listed in `rules-private/access.json`.
  Players and GMs can search and cite them.
- **GM content:** every other private book, including adventures and campaign
  secrets. Only GMs and Assistant GMs can list, search or read those pages.
  The official SRD 5.2.1 is always available to everyone.

Create `rules-private/access.json` locally, using the actual filenames on your
server (case-sensitive):

```json
{
  "version": 1,
  "rules_for_all": [
    "Players_Handbook_2024.pdf",
    "Tashas_Cauldron_of_Everything.pdf"
  ]
}
```

**Default: private books not in `rules_for_all` are GM-only.** Thus
`Vecna_Eve_of_Ruin.pdf`, `Descent_into_Avernus.pdf`, `Out_of_the_Abyss.pdf`,
`Phandelver_and_Below.pdf`, and any new campaign remain hidden from players
without listing each one. Do not add campaign PDFs to `rules_for_all`.

This policy file is ignored by Git and is **not** a published example of your
actual private collection. No re-indexing is required when changing its
classification. A policy change resets the affected player's OpenCode context
on their next question, without losing their Foundry chat cursor. The bridge
uses a private OpenCode V2 server per request to isolate the player/GM rule
tool environment. It can increase response latency compared with a shared
OpenCode background service.

Classification is **whole-book**, not page-level. If a book mixes player rules
with GM spoilers, leave it GM-only until those parts can be separated into
independently indexed PDFs. This protects the local rules MCP; it is not a
substitute for Foundry's separate journal/document permission settings.

- PDFs here, their contents, and the generated `.rules/` index are **ignored
  by Git**. Do not force-add or upload commercial books to this public repo.
- **PDF filenames are not proof of authenticity.** Check that the files really
  are official and compatible with your campaign. The agent cannot validate
  their edition or the licensing of uploaded files automatically.
- Local PDFs have no public web link. Citations are filename + PDF page number
  (which may differ from the book's printed page number).
- Only **text-extractable, unencrypted PDFs** work. Scanned image-only PDFs
  require OCR first. There is no arbitrary PDF file-size cap; large illustrated
  books can take longer and require more memory/disk space. Maximum 30 PDFs.
- The index is stored locally, but **retrieved text excerpts are sent by
  OpenCode to your configured AI model provider** when answering questions.
  Only index files you are entitled and comfortable to use that way.

This file is public; your PDFs are not.
