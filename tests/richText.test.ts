import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { highlightTextSegments, richTextSegments, safeCellHref, tabLinkTarget } from '../src/utils/richText';

let n = 0;
const ok = (message: string) => { n++; console.log('  ✓', message); };

{
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  ];
  for (const payload of payloads) {
    const segments = richTextSegments(payload);
    assert.equal(segments.map(segment => segment.text).join(''), payload);
    assert.ok(segments.every(segment => segment.type === 'text' && segment.href === undefined), payload);
    assert.equal(safeCellHref(payload), null, payload);
  }
  ok('script, markup, entity, and unsafe-scheme payloads remain inert text');
}

{
  for (const link of [' https://example.com', '\nhttps://example.com', '\thttps://example.com', 'https://exa\nmple.com', 'https://example.com\u0000']) {
    assert.equal(safeCellHref(link), null, JSON.stringify(link));
  }
  assert.equal(safeCellHref('https://example.com'), 'https://example.com');
  assert.equal(safeCellHref('mailto:help@example.com'), 'mailto:help@example.com');
  assert.equal(safeCellHref('javascript:alert(1)'), null);
  assert.equal(safeCellHref('data:text/html,hello'), null);
  ok('cell hyperlinks allow http(s) and mailto only, rejecting whitespace and control characters');
}

{
  const arabic = 'مُشْكِلَة العميل';
  const segments = richTextSegments(arabic, 'مشكلة');
  assert.deepEqual(segments, [{ type: 'mark', text: 'مُشْكِلَة' }, { type: 'text', text: ' العميل' }]);
  const multi = richTextSegments('case CASE Case', 'case');
  assert.deepEqual(multi, [
    { type: 'mark', text: 'case' }, { type: 'text', text: ' ' },
    { type: 'mark', text: 'CASE' }, { type: 'text', text: ' ' },
    { type: 'mark', text: 'Case' },
  ]);
  assert.deepEqual(highlightTextSegments('problem', 'b'), [
    { type: 'text', text: 'pro' }, { type: 'mark', text: 'b' }, { type: 'text', text: 'lem' },
  ]);
  ok('highlights preserve original text across Arabic diacritics and repeated matches');
}

{
  const segments = richTextSegments('Visit https://example.com/path). now');
  assert.deepEqual(segments, [
    { type: 'text', text: 'Visit ' },
    { type: 'link', text: 'https://example.com/path', href: 'https://example.com/path' },
    { type: 'text', text: '). now' },
  ]);
  const highlightedUrl = richTextSegments('https://example.com', 'example');
  assert.deepEqual(highlightedUrl, [
    { type: 'link', text: 'https://', href: 'https://example.com' },
    { type: 'mark', text: 'example', href: 'https://example.com' },
    { type: 'link', text: '.com', href: 'https://example.com' },
  ]);
  ok('plain URLs retain trailing punctuation and URL text can still be highlighted');
}

{
  const longText = 'x'.repeat(100_000);
  const segments = richTextSegments(longText);
  assert.deepEqual(segments, [{ type: 'text', text: longText }]);
  assert.equal(tabLinkTarget("#'Complaint Types'!A1"), 'Complaint Types');
  assert.equal(tabLinkTarget('#Summary!A1'), 'Summary');
  assert.equal(tabLinkTarget('javascript:alert(1)'), null);
  ok('very long text remains inert and internal sheet links are detected');
}

{
  const table = readFileSync('src/components/TableView.tsx', 'utf8');
  assert.equal(table.includes('dangerouslySetInnerHTML'), false);
  ok('TableView renders without dangerouslySetInnerHTML');
}

console.log(`\nALL ${n} TESTS PASSED`);
