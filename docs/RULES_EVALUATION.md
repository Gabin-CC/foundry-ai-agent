# D&D 2024 rules evaluation (SRD 5.2.1)

The bridge validates **citation provenance** in production: a cited PDF page
must exist and must have been retrieved for that answer. That alone does not
show that the assistant **understood the rule**. This optional, offline
evaluation suite makes that distinction visible.

## Scope and guarantees

- The [13 benchmark cases](../eval/rules-2024-srd.json) use only the official
  **English SRD 5.2.1**. Each answerable case has a checked **PDF page** and a
  brief reviewer-written summary of the expected interpretation. Cases include
  2024-specific differences from 2014, bilingual prompts, and a deliberately
  unanswerable question about a fictional Vecna ritual.
- The runner matches a small set of required concepts and known bad claims,
  checks the cited page, and — **if actual OpenCode rule-tool calls are
  supplied** — applies the same provenance guard as the live bridge.
- String/regex matches are **smoke checks**, not an LLM judge and not proof of
  semantic correctness. Correct answers phrased unusually may fail; plausible
  but wrong answers may pass. A human must compare the whole response with
  the source and record a separate review verdict.
- The original **offline replay** (`eval:rules`) does not invoke a model,
  OpenCode, any MCP server or Foundry. The separate **opt-in live model
  runner** (`eval:rules:live`) uses OpenCode with a temporary, SRD-only rules
  MCP. Neither command contacts Foundry, posts messages, modifies game state,
  loads `.env` or `.state/`, or changes the running service. The original
  `.rules/` index is only read; private PDF pages are excluded from the
  temporary index before OpenCode starts.

## Run an evaluation

From the project root, prepare the official SRD index if needed:

```bash
npm run rules:setup
npm run eval:rules -- --prompts
```

`--prompts` prints one JSON object per line with a case ID, question and
SRD-only instruction. Feed these prompts to a **separately isolated** model
session with **only** the local SRD rules MCP available (never the production
Foundry MCP). Do not use the live bridge as an unattended evaluation runner.

### Automated real-model collection (explicit opt-in)

PR #14 adds a separate runner that calls the **OpenRouter model specified by
you** through OpenCode. It is **not** invoked by `npm test`, `npm run
eval:rules`, CI, installation, or the production service. Check the setup
without credentials or network calls first:

```bash
npm run eval:rules:live -- --dry-run --model openrouter/baidu/ernie-5.5-flash-preview:free
```

Use the same model ID as your deployed `OPENCODE_MODEL` to compare model
behavior. The example above is a model identifier, **not** a guarantee of
availability, tool support or free pricing. OpenCode must be installed on
the evaluation host. To actually contact the provider, export
`OPENROUTER_API_KEY` in the shell **explicitly** (the runner never reads the
production `.env`) and choose a new output path:

```bash
# Example: type the key without echoing it into shell history
read -rs OPENROUTER_API_KEY && export OPENROUTER_API_KEY

# First, try one question before running the full set
npm run eval:rules:live -- --execute --model openrouter/baidu/ernie-5.5-flash-preview:free \
  --limit 1 --output .rules/model-smoke.jsonl

# After confirming the model and tool connection, run all 13 cases
npm run eval:rules:live -- --execute --model openrouter/baidu/ernie-5.5-flash-preview:free \
  --output .rules/model-all.jsonl

# Grade the captured replies (still requires manual review)
npm run eval:rules -- --responses .rules/model-all.jsonl --json
```

The live runner:

1. Makes a fresh **temporary work directory** and copies only the official
   English SRD pages from the local index. It never passes the private
   PDF list, text or production configuration to OpenCode.
2. Creates an **SRD-only OpenCode config and agent**. The three read-only
   rules tools are explicitly permitted; other tools, providers, MCP
   servers, plugins, skills and web search are denied by OpenCode policies.
3. Passes an allowlisted environment containing the provider key but **no
   Foundry credentials, account data or original OpenCode session state**.
   Every question starts a new OpenCode session.
4. Captures the actual HTML answer and completed rules-tool inputs/status,
   **not** entire MCP excerpts, and writes them as JSON Lines. An unexpected
   tool call aborts the run; earlier completed cases remain on disk.

Provider calls may cost money and send the official SRD passages and
benchmark prompts to your chosen provider. Output files contain model
transcripts; use a path inside gitignored `.rules/` or outside the repo and
keep them private. An existing output file is never overwritten. An
incomplete run leaves a partial file, which is **not** a passing result.

This is **application-level isolation** using OpenCode configuration,
permissions and a clean environment, **not an OS/container network sandbox**.
For additional assurance, run under a separate low-privilege account without
routes or credentials to Foundry. A system administrator's machine-wide
OpenCode configuration may take precedence; inspect it before evaluating.

Save the model's actual HTML responses to an untracked JSON Lines file (one
JSON object per line). The following is an **illustrative format**, not a
claimed model result:

```json
{"id":"opportunity-attack-reaction","reply":"<p>A creature leaving your reach can provoke an Opportunity Attack; you spend your Reaction. SRD 5.2.1 (EN), PDF p. 15.</p>","toolCalls":[{"name":"rules_read_rule_page","status":"completed","input":{"source":"srd","page":15}}]}
```

The optional `toolCalls` field must contain **actual completed calls from the
same model turn**, not calls copied from a different prompt or fabricated for
scoring. Without that trace, citation provenance is marked `not-provided`;
the answer cannot receive a fully reviewed-correct status. **Even a cautious
refusal must have a successful SRD search** before it counts as a reviewed
correct answer; a search shows that a lookup was attempted, not that the
ritual is proved nonexistent everywhere.

For each reply, compare the full model answer to `gold` and the cited PDF page
in `eval/rules-2024-srd.json`. Then add a **human** review:

```json
"review": {"verdict":"correct","reviewer":"Your name","notes":"Checked the complete ruling against PDF page 15."}
```

Also supported: `incorrect` and `uncertain`. Do not mark a case `correct`
just because it has a legitimate citation or its keyword checks pass. Keep
real player chat, identities, private book excerpts and provider credentials
out of response files and pull requests.

Evaluate the recorded answers:

```bash
npm run eval:rules -- --responses /path/to/model-replies.jsonl
npm run eval:rules -- --responses /path/to/model-replies.jsonl --json
npm run eval:rules -- --responses /path/to/model-replies.jsonl --require-reviewed
```

The runner accepts JSON Lines or a JSON array. A custom SRD index can be
specified via `--index /path/to/index.json`. Reports separate:

| Dimension | What it establishes |
| --- | --- |
| `smoke` | Whether the expected concepts and forbidden phrases match the reply; **heuristic only** |
| `citation` | Whether the reply cites the official benchmark PDF page |
| `evidence` | Whether completed tool calls from **this turn** support all cited pages |
| `human` | Independent correctness verdict after reading the source and the full answer |

Statuses: `failed` (or `missing`) signals a concrete regression;
`needs-evidence` means the actual lookup trace is absent; `needs-review`
means there is no confirmed correct human verdict; `reviewed-correct` requires
all checks and a human `correct` verdict. An `uncertain` verdict never counts
as correct. The standard command exits non-zero for failed/missing cases;
`--require-reviewed` additionally requires every case to be `reviewed-correct`.

`summary.human.accuracy` counts only human-reviewed `correct` and `incorrect`
cases; it is `null` when neither exists. Always report coverage alongside it,
including `unreviewed` and `uncertain`. These scores describe only this small
benchmark, **not general D&D rules accuracy**.

## Maintaining the benchmark

1. Keep the gold corpus limited to open SRD 5.2.1 material. **Do not commit**
   commercial book text, PDFs, private indexes, real chats or model secrets.
2. Verify the PDF page number and `reference.anchor` against the current
   pinned official English PDF, not a printed-book page number or 2014 text.
3. Add a short, paraphrased `gold` interpretation, required `checks` and
   `redFlags`; write synthetic tests proving both expected passes and common
   wrong-answer failures. Rubric patterns operate on accent-insensitive,
   lowercased visible reply text.
4. Keep a human review step even if automated heuristics improve. If you want
   to evaluate commercial books, prepare a separate **local, untracked**
   benchmark and review its sharing/license terms first.

Source attribution: This work includes material from the System Reference
Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at
https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative
Commons Attribution 4.0 International License, available at
https://creativecommons.org/licenses/by/4.0/legalcode.
