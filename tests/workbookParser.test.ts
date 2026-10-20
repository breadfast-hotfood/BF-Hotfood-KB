import assert from 'node:assert/strict';
import { parseWorkbookRows } from '../src/utils/workbookParser';

let n = 0; const ok = (m: string) => { n++; console.log('  ✓', m); };

// Layout used by the real workbook: notes row, group row, header row, then cases grouped by category divider rows.
const rows = [
  ['Important Notes', 'Note A', 'Note B', ''],
  ['', 'Delivery', '', 'Scripts'],
  ['Category', 'Complaint Type', 'Description', 'Retention Team Call'],
  ['Late Orders'],
  ['', 'Late delivery', 'Order is late', 'Call script 1'],
  ['', 'Wrong item', 'Wrong item sent', 'Call script 2'],
  // category divider that also has a stray cell under another column
  ['Customer Support Experience', '', '', 'Quality Team Validation'],
  ['', 'Rude agent', 'Complaint about tone', 'Call script 3'],
  ['', 'Slow reply', 'Waited too long', 'Call script 4'],
];

{
  const kb: any = parseWorkbookRows(rows);
  assert.deepEqual(kb.importantNotes, ['Note A', 'Note B']);
  assert.ok(!kb.importantNotes.join('|').includes('Quality Team Validation'));
  assert.ok(!kb.importantNotes.join('|').includes('›'));
  ok('stray text on a category divider row is NOT added to the Important Notes');
}
{
  const kb: any = parseWorkbookRows(rows);
  assert.equal(kb.records.length, 4);
  assert.deepEqual(kb.records.map((r: any) => r._section), ['Late Orders', 'Late Orders', 'Customer Support Experience', 'Customer Support Experience']);
  assert.equal(kb.records[2].fields['Complaint Type'], 'Rude agent');
  assert.equal(kb.records[3].fields['Retention Team Call'], 'Call script 4');
  assert.deepEqual(kb.fieldOrder.map((f: any) => f.key), ['Category', 'Complaint Type', 'Description', 'Retention Team Call']);
  ok('the divider row still starts a section and all case records import exactly as before');
}
{
  // a divider row without any stray cell, and a divider row that repeats the column labels (other tabs): unchanged behaviour
  const r2 = [
    ['Inquiry', 'English', 'Arabic'],
    ['Section One'],
    ['Q1', 'Answer one', 'الإجابة الأولى'],
    ['Section Two', '', 'English', 'Arabic'.slice(0, 0)],
    ['Q2', 'Answer two', 'الإجابة الثانية'],
  ];
  const kb: any = parseWorkbookRows(r2);
  assert.equal(kb.records.length, 2);
  assert.deepEqual(kb.records.map((r: any) => r._section), ['Section One', 'Section Two']);
  assert.deepEqual(kb.importantNotes, []);
  ok('plain divider rows and the other tab layouts are unaffected');
}
{
  // real notes (rows above the header) keep working, including several note cells and a note label
  const kb: any = parseWorkbookRows([
    ['Important Notes', 'First note', 'Second note', 'Third note'],
    ['Type', 'Detail'],
    ['Case A', 'Detail A'],
  ]);
  assert.deepEqual(kb.importantNotes, ['First note', 'Second note', 'Third note']);
  ok('genuine notes above the table are still imported');
}
console.log(`\nALL ${n} TESTS PASSED`);
