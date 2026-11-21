// Fast drop-in for csv-reader 1.0.0: identical answers, much less CPU.
// Approach: single pass, native indexOf to jump between delimiters, slice
// for field values, quoted fields handled by slicing to the closing quote
// (doubled quotes and CRs inside quotes are the rare slow path). A field is
// never built character by character in the common case.
//
// Unquoted fields take a fast path driven by a per-line cache: the cache
// records the current physical line's start/end and whether it holds a stray
// CR (a CR that is not the line's CRLF terminator). It self-validates on
// every use (the field's start must lie inside the cached line), so record
// starts, line breaks and multi-line quoted fields need no explicit
// invalidation. With a clean line the field end is min(next comma, line
// end), one slice, no rescans; lines with a stray CR fall back to the
// original field-by-field CR handling, byte-identical.

// Convert one quoted segment (no quote chars in it) that contains a CR:
// every CR or CRLF becomes one LF, every LF stays one LF. Returns
// [converted string, number of line breaks in it].
function convertSeg(seg) {
  const parts = [];
  let breaks = 0;
  let cur = 0;
  const n = seg.length;
  while (cur < n) {
    const r = seg.indexOf('\r', cur);
    const lf = seg.indexOf('\n', cur);
    if (r === -1 && lf === -1) { parts.push(seg.slice(cur)); break; }
    if (lf !== -1 && (r === -1 || lf < r)) {
      parts.push(seg.slice(cur, lf + 1));
      breaks += 1;
      cur = lf + 1;
    } else {
      parts.push(seg.slice(cur, r));
      parts.push('\n');
      breaks += 1;
      cur = (r + 1 < n && seg.charCodeAt(r + 1) === 10) ? r + 2 : r + 1;
    }
  }
  return [parts.join(''), breaks];
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = 0;
  let line = 1;
  // Per-line cache for the unquoted fast path. lineStart < 0 means invalid.
  // lineEnd is the offset of the line's LF, or -1 when the line runs to EOF.
  // lineStray is true when the line holds a CR other than its CRLF
  // terminator (any CR at all on a line with no LF).
  let lineStart = -1;
  let lineEnd = -1;
  let lineStray = false;
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Skip lines with no characters (LF or CRLF only).
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (ch === 10) { pos += 1; line += 1; }
      else if (ch === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = (header && columns === null) ? null : rows.length;
    const fields = [];
    let lastQuoted = false;

    // One record: fields until a line break or the end of the text.
    while (true) {
      let fval;
      let fended; // 0 = comma, 1 = line break, 2 = end of text
      let initVal = '';
      let junkFlag = false;
      let doUnquoted = false;

      if (text.charCodeAt(pos) === 34) {
        // ---- Quoted field ----
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let segStart = open + 1;
        let search = open + 1;
        let parts = null;
        let qline = line;
        let closedQ = -1;
        let unterminated = false;
        while (true) {
          const q = text.indexOf('"', search);
          if (q === -1) { unterminated = true; break; }
          if (text.charCodeAt(q + 1) === 34) {
            // Doubled quote: segment + one literal quote.
            const seg = text.slice(segStart, q);
            if (parts === null) parts = [];
            if (seg.indexOf('\r') !== -1) {
              const conv = convertSeg(seg);
              parts.push(conv[0]);
              parts.push('"');
              qline += conv[1];
            } else {
              parts.push(seg);
              parts.push('"');
              let idx = seg.indexOf('\n');
              while (idx !== -1) { qline += 1; idx = seg.indexOf('\n', idx + 1); }
            }
            segStart = q + 2;
            search = q + 2;
            continue;
          }
          closedQ = q;
          break;
        }
        if (unterminated) {
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          initVal = '"';
          doUnquoted = true;
        } else {
          const seg = text.slice(segStart, closedQ);
          let qval;
          if (parts === null) {
            if (seg.indexOf('\r') !== -1) {
              const conv = convertSeg(seg);
              qval = conv[0];
              qline += conv[1];
            } else {
              qval = seg;
              let idx = seg.indexOf('\n');
              while (idx !== -1) { qline += 1; idx = seg.indexOf('\n', idx + 1); }
            }
          } else {
            if (seg.indexOf('\r') !== -1) {
              const conv = convertSeg(seg);
              parts.push(conv[0]);
              qline += conv[1];
            } else {
              parts.push(seg);
              let idx = seg.indexOf('\n');
              while (idx !== -1) { qline += 1; idx = seg.indexOf('\n', idx + 1); }
            }
            qval = parts.join('');
          }
          line = qline;
          pos = closedQ + 1;
          if (pos >= len) { fval = qval; fended = 2; }
          else {
            const cc = text.charCodeAt(pos);
            if (cc === 44) { pos += 1; fval = qval; fended = 0; }
            else if (cc === 10) { pos += 1; line += 1; fval = qval; fended = 1; }
            else if (cc === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; fval = qval; fended = 1; }
            else { initVal = qval; junkFlag = true; doUnquoted = true; }
          }
        }
      } else {
        lastQuoted = false;
        doUnquoted = true;
      }

      if (doUnquoted) {
        // ---- Unquoted field (also: junk after a closing quote, and the
        // re-read after an unterminated quote, both with initVal set) ----
        const p = pos;
        // (Re)build the per-line cache when the field starts outside it.
        if (lineStart < 0 || p < lineStart || (lineEnd !== -1 && p >= lineEnd)) {
          lineStart = text.lastIndexOf('\n', p - 1) + 1;
          lineEnd = text.indexOf('\n', p);
          const segEnd = lineEnd === -1 ? len : lineEnd;
          const rInSeg = text.slice(lineStart, segEnd).indexOf('\r');
          lineStray = lineEnd === -1 ? rInSeg !== -1 : (rInSeg !== -1 && rInSeg !== segEnd - lineStart - 1);
        }
        if (!lineStray) {
          // Fast path: no stray CR on this line, so the field ends at the
          // next comma or at the line's LF (or EOF), and a trailing CR is
          // exactly the CRLF terminator.
          const cIdx = text.indexOf(',', p);
          let end;
          let endKind;
          if (cIdx !== -1 && (lineEnd === -1 || cIdx < lineEnd)) { end = cIdx; endKind = 0; pos = cIdx + 1; }
          else if (lineEnd !== -1) { end = lineEnd; endKind = 1; pos = lineEnd + 1; line += 1; }
          else { end = len; endKind = 2; pos = len; }
          let sliceEnd = end;
          if (endKind === 1 && end > p && text.charCodeAt(end - 1) === 13) sliceEnd = end - 1;
          fval = initVal === '' ? text.slice(p, sliceEnd) : initVal + text.slice(p, sliceEnd);
          fended = endKind;
          if (junkFlag && sliceEnd > p) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        } else {
          // Slow path: the line holds a stray CR; handle it exactly as
          // before, field by field.
          // Only search for the comma in the text: a LF before that comma
          // shows up inside the sliced field (a short string), so looking
          // for '\n' in the whole text — which scans to the end of the line
          // on every field — is never needed. A LF search in the text is
          // done only when there is no comma left, i.e. once per record.
          const cIdx = text.indexOf(',', p);
          let raw;
          let endKind;
          if (cIdx !== -1) {
            raw = text.slice(p, cIdx);
            const lfIn = raw.indexOf('\n');
            if (lfIn !== -1) {
              raw = raw.slice(0, lfIn);
              pos = p + lfIn + 1;
              line += 1;
              endKind = 1;
            } else {
              pos = cIdx + 1;
              endKind = 0;
            }
          } else {
            const nIdx = text.indexOf('\n', p);
            if (nIdx === -1) { raw = text.slice(p, len); pos = len; endKind = 2; }
            else { raw = text.slice(p, nIdx); pos = nIdx + 1; line += 1; endKind = 1; }
          }
          // Any CR in raw is either the CRLF terminator (a trailing CR when
          // the field ended at LF) or a stray CR. No CR can hide a LF in
          // the middle: the first LF already ended the field.
          let cleaned = raw;
          let added = raw.length;
          if (raw.indexOf('\r') !== -1) {
            const trailingCRLF = endKind === 1 && raw.charCodeAt(raw.length - 1) === 13;
            const limit = trailingCRLF ? raw.length - 1 : raw.length;
            let parts2 = null;
            let s = 0;
            while (true) {
              const r = raw.indexOf('\r', s);
              if (r === -1 || r >= limit) break;
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              if (parts2 === null) parts2 = [];
              parts2.push(raw.slice(s, r));
              s = r + 1;
            }
            if (parts2 === null) cleaned = raw.slice(0, limit);
            else { parts2.push(raw.slice(s, limit)); cleaned = parts2.join(''); }
            added = cleaned.length;
          }
          fval = initVal === '' ? cleaned : initVal + cleaned;
          fended = endKind;
          if (junkFlag && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
      }

      fields.push(fval);
      if (fended !== 0) break;
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
