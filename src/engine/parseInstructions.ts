import type { ParsedInstruction, Seconds } from './types';

/**
 * Parse free-form "where to put each visual" instructions produced by an AI
 * (or written by hand) into structured segments.
 *
 * The parser is intentionally forgiving. It handles, among others:
 *
 *   visual 1: 00:00 - 00:56
 *   virtual one is from 00:00 to 00:56
 *   virtual 2 is till 01:03
 *   Visual 3 till 01:40
 *   4) 1:40 - 2:10
 *   [00:00 - 00:56] scene 1
 *   1. 0:00
 *
 * Timecodes may be SS, MM:SS or HH:MM:SS, with optional .ms / ,ms fractions.
 * A line with a single timecode phrased as an end ("till/until/to X", or a
 * leading "- X") sets only `end`; the start is filled in later from the
 * previous segment. A single timecode phrased as a start ("from/at X") sets
 * only `start`.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

/** Matches a timecode like 1:02:03.5, 01:23, or 45 (bare seconds w/ unit). */
const TIMECODE_RE = /(?<![\d.])(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?|(?<![\d:.])\d{1,3}(?:[.,]\d{1,3})?\s*(?:s|sec|secs|seconds)\b/gi;

/** Convert a matched timecode token to seconds. */
export function timecodeToSeconds(token: string): Seconds {
  const t = token.trim().toLowerCase().replace(',', '.');
  // Bare "45s" / "45 seconds" form.
  const unit = t.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)$/);
  if (unit) return parseFloat(unit[1]);

  const parts = t.split(':').map((p) => parseFloat(p));
  if (parts.some((n) => Number.isNaN(n))) return NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** Extract the 1-based visual number referenced by a line, if any. */
function extractVisualNumber(line: string): number | undefined {
  // "visual 3", "virtual #3", "image 3", "scene 3", "clip 3", "shot 3", "v3"
  const labeled = line.match(
    /\b(?:virtual|visual|image|img|scene|clip|shot|pic(?:ture)?|slide|v)\s*#?\s*(\d{1,3}|[a-z]+)/i,
  );
  if (labeled) {
    const tok = labeled[1].toLowerCase();
    if (/^\d+$/.test(tok)) return parseInt(tok, 10);
    if (tok in NUMBER_WORDS) return NUMBER_WORDS[tok];
  }
  // Leading "1." / "1)" / "1 -" enumerations. Note the separator class excludes
  // ":" so a bare timecode like "00:00 - ..." is not mistaken for item 0.
  const lead = line.match(/^\s*(\d{1,3})\s*[.)\-]/);
  if (lead) return parseInt(lead[1], 10);
  return undefined;
}

/**
 * Parse an instructions blob. Returns one entry per line that references a
 * timecode, in source order. Lines are auto-numbered when they carry a
 * timecode but no explicit visual number.
 */
export function parseInstructions(text: string): ParsedInstruction[] {
  const out: ParsedInstruction[] = [];
  // Split on newlines and on sentence-ish separators so multiple instructions
  // packed on one line ("virtual 1 ..., virtual 2 ...") are handled.
  const rawLines = text
    .split(/\r?\n|(?<=\d)\s*[;•]\s*|,(?=\s*(?:virtual|visual|image|scene|clip|shot|slide)\b)/i)
    .map((l) => l.trim())
    .filter(Boolean);

  let autoNumber = 0;

  for (const line of rawLines) {
    const codes = line.match(TIMECODE_RE);
    if (!codes || codes.length === 0) continue;

    const seconds = codes
      .map((c) => timecodeToSeconds(c))
      .filter((n) => !Number.isNaN(n));
    if (seconds.length === 0) continue;

    autoNumber += 1;
    const explicit = extractVisualNumber(line);
    const visualNumber = explicit ?? autoNumber;

    let start: Seconds | undefined;
    let end: Seconds | undefined;

    if (seconds.length >= 2) {
      start = seconds[0];
      end = seconds[1];
    } else {
      const single = seconds[0];
      // Decide whether the single timecode is a start or an end.
      const endish = /\b(?:till|until|to|end|ends?|through|thru)\b|(?:^|\s)[-–—]\s*\d/i.test(line);
      const startish = /\b(?:from|at|start|starts?|begin|begins?|@)\b/i.test(line);
      if (endish && !startish) {
        end = single;
      } else if (startish && !endish) {
        start = single;
      } else {
        // Ambiguous single timecode: treat as a start marker.
        start = single;
      }
    }

    out.push({ visualNumber, start, end, raw: line });
  }

  return out;
}
