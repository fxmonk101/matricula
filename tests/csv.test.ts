import { describe, expect, it } from 'vitest';

import {
  CsvError,
  cell,
  detectDelimiter,
  mapColumns,
  normaliseHeader,
  parseCsv,
} from '@/lib/domain/csv';

/*
 * Reading a file a registry actually sends.
 *
 * Every case below is something a real export contains, and every one of them
 * is silently wrong under `split(',')` — the failure is not an exception, it is
 * a student whose address swallowed their phone number and a row nobody checks
 * again.
 */

describe('the basics', () => {
  it('reads a header row and records', () => {
    const table = parseCsv('First Name,Last Name\nAda,Okafor\nChidi,Eze\n');
    expect(table.headers).toEqual(['First Name', 'Last Name']);
    expect(table.rows).toEqual([
      ['Ada', 'Okafor'],
      ['Chidi', 'Eze'],
    ]);
  });

  it('trims cells, because spreadsheets are full of stray spaces', () => {
    const table = parseCsv('a,b\n  x  ,  y  \n');
    expect(table.rows[0]).toEqual(['x', 'y']);
  });
});

describe('the things that break a naive split', () => {
  it('keeps a comma inside a quoted field', () => {
    const table = parseCsv('name,address\nAda,"12 Broad Street, Lagos"\n');
    expect(table.rows[0]).toEqual(['Ada', '12 Broad Street, Lagos']);
  });

  it('keeps a NEWLINE inside a quoted field', () => {
    // Typed with Alt+Enter in Excel. A line-based parser turns this one student
    // into two, the second of which has no name.
    const table = parseCsv('name,address\nAda,"12 Broad Street\nLagos"\nChidi,Enugu\n');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][1]).toBe('12 Broad Street\nLagos');
    expect(table.rows[1]).toEqual(['Chidi', 'Enugu']);
  });

  it('reads a doubled quote as one literal quote', () => {
    const table = parseCsv('name,note\nAda,"she said ""yes"""\n');
    expect(table.rows[0][1]).toBe('she said "yes"');
  });

  it('strips a UTF-8 BOM from the first header', () => {
    /*
     * The nastiest one. Excel writes it by default, it is invisible in every
     * editor, and it makes the first header "﻿First Name" — so the column
     * match fails and the importer reports a missing "first name" column in a
     * file that plainly has one.
     */
    const table = parseCsv('﻿First Name,Last Name\nAda,Okafor\n');
    expect(table.headers[0]).toBe('First Name');
    expect(normaliseHeader(table.headers[0])).toBe('firstname');
  });

  it('handles CRLF, LF and a lone CR, including mixed', () => {
    const table = parseCsv('a,b\r\n1,2\r3,4\n5,6\r\n');
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('drops trailing blank lines rather than importing empty people', () => {
    const table = parseCsv('a,b\n1,2\n\n\n,\n');
    expect(table.rows).toEqual([['1', '2']]);
  });

  it('pads a short row instead of returning a ragged array', () => {
    const table = parseCsv('a,b,c\n1,2\n');
    expect(table.rows[0]).toEqual(['1', '2', '']);
  });

  it('ignores extra columns beyond the header width', () => {
    const table = parseCsv('a,b\n1,2,3,4\n');
    expect(table.rows[0]).toEqual(['1', '2']);
  });

  it('reads the last row when the file does not end in a newline', () => {
    const table = parseCsv('a,b\n1,2');
    expect(table.rows).toEqual([['1', '2']]);
  });

  it('refuses an empty file rather than returning nothing useful', () => {
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('\n\n')).toThrow(CsvError);
  });
});

describe('which character separates the columns', () => {
  it('detects semicolons, which a European Excel export uses', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    const table = parseCsv('First Name;Last Name\nAda;Okafor\n');
    expect(table.rows[0]).toEqual(['Ada', 'Okafor']);
  });

  it('detects tabs, which a database paste uses', () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
  });

  it('does not count a delimiter inside quotes', () => {
    // "Lagos, Nigeria" must not make this look comma-heavy when it is not.
    expect(detectDelimiter('name;"Lagos, Nigeria, West Africa";level')).toBe(';');
  });

  it('falls back to a comma when there is nothing to go on', () => {
    expect(detectDelimiter('justoneheader')).toBe(',');
  });
});

describe('matching their headers to ours', () => {
  const specs = [
    { key: 'firstName', aliases: ['First Name', 'Firstname', 'Given Name'], required: true },
    { key: 'lastName', aliases: ['Last Name', 'Surname', 'Family Name'], required: true },
    { key: 'email', aliases: ['Email', 'Email Address'] },
    { key: 'matricNumber', aliases: ['Matric Number', 'Matric No', 'Registration Number'] },
  ];

  it('matches regardless of case, spacing, underscores and hyphens', () => {
    const map = mapColumns(['FIRST_NAME', '  last-name ', 'E-mail'], specs);
    expect(map.index.firstName).toBe(0);
    expect(map.index.lastName).toBe(1);
    expect(map.index.email).toBe(2);
    expect(map.missing).toEqual([]);
  });

  it('accepts the words a Nigerian registry actually uses', () => {
    const map = mapColumns(['Surname', 'Given Name', 'Matric No'], specs);
    expect(map.index.lastName).toBe(0);
    expect(map.index.firstName).toBe(1);
    expect(map.index.matricNumber).toBe(2);
  });

  it('names the required columns that are missing', () => {
    const map = mapColumns(['Email'], specs);
    expect(map.missing).toEqual(['firstName', 'lastName']);
  });

  it('REPORTS columns it did not understand rather than ignoring them', () => {
    /*
     * Somebody who exported a "Guardian Phone" column believes they have
     * imported guardian phones. Saying nothing is how they find out in March.
     */
    const map = mapColumns(['First Name', 'Last Name', 'Guardian Phone'], specs);
    expect(map.unmatched).toEqual(['Guardian Phone']);
  });

  it('does not let two of our fields claim the same column', () => {
    const ambiguous = [
      { key: 'a', aliases: ['Name'] },
      { key: 'b', aliases: ['Name'] },
    ];
    const map = mapColumns(['Name'], ambiguous);
    expect(map.index.a).toBe(0);
    expect(map.index.b).toBeUndefined();
  });

  it('reads a cell by field name, and an absent column as empty', () => {
    const map = mapColumns(['First Name', 'Last Name'], specs);
    const row = ['Ada', 'Okafor'];
    expect(cell(row, map, 'firstName')).toBe('Ada');
    expect(cell(row, map, 'email')).toBe('');
  });
});

describe('size limits', () => {
  it('refuses a file with absurdly many rows', () => {
    const huge = 'a\n' + '1\n'.repeat(20_001);
    expect(() => parseCsv(huge)).toThrow(/more than/);
  });
});
