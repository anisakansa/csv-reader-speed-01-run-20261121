# csv-reader-speed — fast drop-in for csv-reader 1.0.0

`run({text, header})` returns exactly what csv-reader 1.0.0 returns
(`{columns, rows, errors}`), much faster.

## Approach

- Single pass, left to right. No per-character loop in the common case.
- Unquoted fields: jump with native `indexOf(',')` / `indexOf('\n')` to the
  next delimiter and `slice` the field. A CR inside a field slice is the
  rare path: it is either the CRLF terminator or a `stray_cr`.
- Quoted fields: `indexOf('"')` to the closing quote and `slice` the
  content directly. Doubled quotes (`""`) and CRs inside quotes are handled
  by a small segment converter (CRLF / lone CR inside quotes become LF);
  newlines inside quotes are counted for the line numbers errors carry.
- Unterminated quotes fall back to re-reading from after the opening quote
  as unquoted, exactly like the reference.
- `main.ts` is the harness driver: it sets `--no-incremental-marking`
  before importing `solve.js`, reads `/input/cases.json`, and writes
  `/output/answers.json`.

## Test

```sh
mkdir -p /tmp/out /tmp/scores
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out \
  node main.ts
MAKEFUN_OUTPUT_DIR=/tmp/out \
  MAKEFUN_REFERENCE_DIR=<kit>/practice/reference \
  MAKEFUN_SCORES_DIR=/tmp/scores \
  node <kit>/program/scorer/main.ts
cat /tmp/scores/scores.json
```
