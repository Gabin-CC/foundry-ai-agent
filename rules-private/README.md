# Your private D&D 2024 rulebooks

You can put additional **lawfully obtained, text-readable PDF** rulebooks in
this folder, for example `Players_Handbook_2024.pdf`. Only the PDF files placed
directly in this folder are indexed (not subdirectories). Do not add D&D 2014
rules or house rules when your campaign uses D&D 2024 only.

Then run `npm run rules:setup` from the project root and restart the bridge.
The local `rules` MCP tools can search both the official SRD 5.2.1 and these
PDFs, and can report the source **filename and actual PDF page number**.
Re-run the command after adding, replacing or removing a PDF.

- PDFs here, their contents, and the generated `.rules/` index are **ignored
  by Git**. Do not force-add or upload commercial books to this public repo.
- **PDF filenames are not proof of authenticity.** Check that the files really
  are official and compatible with your campaign. The agent cannot validate
  their edition or the licensing of uploaded files automatically.
- Local PDFs have no public web link. Citations are filename + PDF page number
  (which may differ from the book's printed page number).
- Only **text-extractable, unencrypted PDFs** work. Scanned image-only PDFs
  require OCR first. Each PDF must be no larger than 250 MB; maximum 30 PDFs.
- The index is stored locally, but **retrieved text excerpts are sent by
  OpenCode to your configured AI model provider** when answering questions.
  Only index files you are entitled and comfortable to use that way.

This file is public; your PDFs are not.
