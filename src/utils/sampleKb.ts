import type { Workbook } from '../types';

/**
 * Built-in PLACEHOLDER knowledge base, shown only while nothing has been published.
 * It contains no company data: only neutral example text that demonstrates the layout.
 * The real knowledge base lives in Firestore and is published from the Administration Center.
 */
const c = (v: string) => ({ v, l: '', rs: 1, cs: 1 });

export const SAMPLE_KB: Workbook & { publishedAt: string } = {
  versionId: 'test-v1-initial',
  fileName: 'Sample_KB.xlsx',
  publishedAt: '2026-01-01T00:00:00.000Z',
  tabs: [
    {
      name: 'Sample Cases',
      kind: 'cases',
      view: 'smart',
      skip: {},
      kb: {
        importantNotes: [
          'This is placeholder content. Publish your real workbook from the Administration Center to replace it.',
        ],
        primaryKey: 'Complaint Type',
        descKey: 'Description',
        fieldOrder: [
          { key: 'Complaint Type', group: 'Overview', cols: [0], link: '' },
          { key: 'Category', group: 'Overview', cols: [1], link: '' },
          { key: 'Description', group: 'Details', cols: [2], link: '' },
          { key: 'Required Info', group: 'Action Steps', cols: [3], link: '' },
          { key: 'Resolution', group: 'Resolution', cols: [4], link: '' },
          { key: 'Reply Template', group: 'Scripts', cols: [5], link: '' },
        ],
        records: [
          {
            _section: 'Example section A',
            _row: 1,
            fields: {
              'Complaint Type': 'Example case 1',
              Category: 'Example category',
              Description: 'Placeholder description of an example case.',
              'Required Info': 'Placeholder list of the details to collect.',
              Resolution: 'Placeholder resolution steps.',
              'Reply Template': 'Placeholder reply template text.',
            },
          },
          {
            _section: 'Example section A',
            _row: 2,
            fields: {
              'Complaint Type': 'Example case 2',
              Category: 'Example category',
              Description: 'Another placeholder description.',
              'Required Info': 'Placeholder list of the details to collect.',
              Resolution: 'Placeholder resolution steps.',
              'Reply Template': 'Placeholder reply template text.',
            },
          },
          {
            _section: 'Example section B',
            _row: 3,
            fields: {
              'Complaint Type': 'Example case 3',
              Category: 'Another example category',
              Description: 'A third placeholder description.',
              'Required Info': 'Placeholder list of the details to collect.',
              Resolution: 'Placeholder resolution steps.',
              'Reply Template': 'Placeholder reply template text.',
            },
          },
        ],
        hasGroup: true,
        hasSections: true,
      },
      grid: [
        [c('Complaint Type'), c('Category'), c('Description'), c('Required Info'), c('Resolution'), c('Reply Template')],
        [c('Example case 1'), c('Example category'), c('Placeholder description of an example case.'), c('Placeholder list of the details to collect.'), c('Placeholder resolution steps.'), c('Placeholder reply template text.')],
        [c('Example case 2'), c('Example category'), c('Another placeholder description.'), c('Placeholder list of the details to collect.'), c('Placeholder resolution steps.'), c('Placeholder reply template text.')],
        [c('Example case 3'), c('Another example category'), c('A third placeholder description.'), c('Placeholder list of the details to collect.'), c('Placeholder resolution steps.'), c('Placeholder reply template text.')],
      ],
    },
    {
      name: 'Sample Table',
      kind: 'table',
      view: 'table',
      skip: {},
      kb: {
        importantNotes: [],
        primaryKey: 'Item',
        descKey: '',
        fieldOrder: [
          { key: 'Item', group: '', cols: [0], link: '' },
          { key: 'Value A', group: '', cols: [1], link: '' },
          { key: 'Value B', group: '', cols: [2], link: '' },
        ],
        records: [
          { _section: '', _row: 1, fields: { Item: 'Example row', 'Value A': 'Placeholder', 'Value B': 'Placeholder' } },
        ],
        hasGroup: false,
        hasSections: false,
      },
      grid: [
        [c('Item'), c('Value A'), c('Value B')],
        [c('Example row'), c('Placeholder'), c('Placeholder')],
      ],
    },
  ],
};
