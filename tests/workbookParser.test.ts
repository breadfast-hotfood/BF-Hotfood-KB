import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbookRows, parseWorkbookBytes, readSheetGrid } from '../src/utils/workbookParser';

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
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['Complaint Type', 'Description', 'Chat Label', 'Resolution'],
    ['Smashed', 'Broken product', 'Damged Item', 'Refund'],
  ]);
  ws['!cols'] = [{}, {}, { hidden: true }, {}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customer Complaints');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer;
  const parsed = parseWorkbookBytes(new Uint8Array(bytes), 'hidden-column-test.xlsx');
  const tab = parsed.tabs[0];
  assert.deepEqual(parsed.hiddenColumnsOmitted, [{ sheetName: 'Customer Complaints', column: 'C', heading: 'Chat Label' }]);
  assert.deepEqual(tab.kb.fieldOrder.map(field => field.key), ['Complaint Type', 'Description', 'Resolution']);
  assert.equal(tab.kb.records[0].fields['Chat Label'], undefined);
  assert.equal(tab.grid[1].some(cell => cell?.v === 'Damged Item'), false);
  assert.equal(tab.grid[0].length, 3);
  ok('hidden Excel columns are omitted from case records, search fields, and the table grid and are reported by heading');

  const csv = 'Complaint Type,Description,Chat Label\nSmashed,Broken product,Damged Item';
  const parsedCsv = parseWorkbookBytes(new TextEncoder().encode(csv), 'no-hidden-metadata.csv');
  assert.equal(parsedCsv.hiddenColumnsOmitted?.length, 0);
  assert.equal(parsedCsv.tabs[0].kb.records[0].fields['Chat Label'], 'Damged Item');
  ok('CSV import keeps all columns because CSV files do not encode hidden-column state');
}
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['Merged heading', '', '', 'Visible field'],
    ['A value', 'Hidden value', 'C value', 'D value'],
  ]);
  ws['!cols'] = [{}, { hidden: true }, {}, {}];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  const grid = readSheetGrid(ws);
  assert.deepEqual(grid[0][0], { v: 'Merged heading', l: '', rs: 1, cs: 2 });
  assert.deepEqual(grid[0][1], { cov: [0, 0] });
  assert.equal(grid[1].some(cell => cell?.v === 'Hidden value'), false);
  assert.equal(grid[1].map(cell => cell?.v || '').join('|'), 'A value|C value|D value');

  const hiddenMaster = XLSX.utils.aoa_to_sheet([
    ['Complaint Type', 'Hidden heading', ''],
    ['Smashed', 'Private merged text', ''],
  ]);
  hiddenMaster['!cols'] = [{}, { hidden: true }, {}];
  hiddenMaster['!merges'] = [{ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 1 }, e: { r: 1, c: 2 } }];
  const hiddenMasterGrid = readSheetGrid(hiddenMaster);
  assert.equal(hiddenMasterGrid.flat().some(cell => cell?.v === 'Private merged text'), false);
  ok('removing a hidden column remaps merged-cell spans and coordinates without exposing its value');
}
console.log(`\nALL ${n} TESTS PASSED`);
