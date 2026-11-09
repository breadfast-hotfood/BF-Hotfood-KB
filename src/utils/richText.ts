import { normalize } from './kbUtils';

export interface RichTextSegment {
  type: 'text' | 'mark' | 'link';
  text: string;
  href?: string;
}

function push(segments: RichTextSegment[], segment: RichTextSegment): void {
  if (!segment.text) return;
  const previous = segments[segments.length - 1];
  if (previous && previous.type === segment.type && previous.href === segment.href) previous.text += segment.text;
  else segments.push(segment);
}

function highlightedSegments(text: string, query: string, linkHref?: string): RichTextSegment[] {
  if (!text) return [];
  const nq = normalize(query);
  if (!nq) return [{ type: linkHref ? 'link' : 'text', text, ...(linkHref ? { href: linkHref } : {}) }];

  // Keep a source span for each normalized UTF-16 unit. This preserves original text
  // and correct highlighting when normalization removes Arabic marks or expands case.
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceOffset = 0;
  for (const char of text) {
    const part = normalize(char);
    for (let i = 0; i < part.length; i++) {
      starts.push(sourceOffset);
      ends.push(sourceOffset + char.length);
    }
    normalized += part;
    sourceOffset += char.length;
  }

  const segments: RichTextSegment[] = [];
  let normalizedOffset = 0;
  let sourceOffsetCursor = 0;
  while (normalizedOffset <= normalized.length - nq.length) {
    const found = normalized.indexOf(nq, normalizedOffset);
    if (found < 0) break;
    const sourceStart = starts[found];
    const sourceEnd = ends[found + nq.length - 1];
    if (sourceStart >= sourceOffsetCursor && sourceEnd > sourceStart) {
      push(segments, { type: linkHref ? 'link' : 'text', text: text.slice(sourceOffsetCursor, sourceStart), ...(linkHref ? { href: linkHref } : {}) });
      push(segments, { type: 'mark', text: text.slice(sourceStart, sourceEnd), ...(linkHref ? { href: linkHref } : {}) });
      sourceOffsetCursor = sourceEnd;
    }
    normalizedOffset = found + nq.length;
  }
  push(segments, { type: linkHref ? 'link' : 'text', text: text.slice(sourceOffsetCursor), ...(linkHref ? { href: linkHref } : {}) });
  return segments.length ? segments : [{ type: linkHref ? 'link' : 'text', text, ...(linkHref ? { href: linkHref } : {}) }];
}

/** Highlight only, without recognizing URLs. */
export function highlightTextSegments(text: string, query = ''): RichTextSegment[] {
  return highlightedSegments(text, query);
}

function splitUrlPunctuation(url: string): { url: string; punctuation: string } {
  const match = url.match(/[.,;:!?)\]]+$/);
  if (!match) return { url, punctuation: '' };
  return { url: url.slice(0, -match[0].length), punctuation: match[0] };
}

/** Highlights text and turns only plain http(s) URLs into safe link segments. */
export function richTextSegments(text: string, query = ''): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const urlPattern = /https?:\/\/[^\s<]+/gi;
  let cursor = 0;
  for (const match of text.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    const { url, punctuation } = splitUrlPunctuation(match[0]);
    if (!url) continue;
    for (const segment of highlightedSegments(text.slice(cursor, index), query)) push(segments, segment);
    for (const segment of highlightedSegments(url, query, url)) push(segments, segment);
    if (punctuation) for (const segment of highlightedSegments(punctuation, query)) push(segments, segment);
    cursor = index + match[0].length;
  }
  for (const segment of highlightedSegments(text.slice(cursor), query)) push(segments, segment);
  return segments;
}

/** Validate a workbook hyperlink's scheme before assigning it to an anchor href. */
export function safeCellHref(link: string): string | null {
  if (link !== link.trim() || /[\u0000-\u001f\u007f]/.test(link)) return null;
  return /^(https?:|mailto:)/i.test(link) ? link : null;
}

/** Return the target sheet for Excel's internal link notation, if present. */
export function tabLinkTarget(link: string): string | null {
  const match = link.match(/^#'?([^'!]+)'?!/);
  return match?.[1] || null;
}
