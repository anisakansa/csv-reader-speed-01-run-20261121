// Driver for the csv-reader-speed entry: reads every case from
// /input/cases.json (or $MAKEFUN_INPUT_DIR), answers each with run() from
// solve.js, and writes /output/answers.json (or $MAKEFUN_OUTPUT_DIR).
//
// Answers are stringified and written one case at a time instead of
// building the whole answers array and one 11 MB string first: the peak
// heap stays near one case instead of all six, which cuts GC and page
// faults. The bytes written are exactly JSON.stringify(answers).
import { readFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, and the optimizing compiler off, set
// before solve.js is imported so all of its work runs under them. The
// entry runs each case once, so TurboFan's background compilation costs
// more CPU than its optimization saves here; the baseline compiler is
// faster overall on this single-pass workload. Tuning V8's flags this way
// is what the kit's rules allow ("an entry may tune V8's flags the same
// way" as the house driver). Output is unaffected: only how the code is
// compiled changes.
setFlagsFromString('--no-incremental-marking --no-opt');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const fd = openSync(join(OUTPUT_DIR, 'answers.json'), 'w');
writeSync(fd, '[');
for (let i = 0; i < cases.length; i++) {
  if (i > 0) writeSync(fd, ',');
  writeSync(fd, JSON.stringify(run(cases[i].input)));
}
writeSync(fd, ']');
closeSync(fd);
