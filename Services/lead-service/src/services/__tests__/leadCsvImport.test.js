import { describe, expect, it } from 'vitest';
import { parseLeadCsv } from '../leadCsvImport.js';

describe('parseLeadCsv', () => {
  it('parses quoted commas, escaped quotes, and embedded newlines', () => {
    const rows = parseLeadCsv('name,email,message\r\n"Smith, Jane",JANE@EXAMPLE.COM,"Asked ""today""\nplease call"');

    expect(rows).toEqual([{
      rowNumber: 2,
      data: {
        name: 'Smith, Jane',
        email: 'jane@example.com',
        message: 'Asked "today"\nplease call',
      },
      errors: [],
    }]);
  });

  it('returns row-specific errors without discarding valid rows', () => {
    const rows = parseLeadCsv('name,email,numberOfTravelers\nAlex,alex@example.com,2\n,not-an-email,zero');

    expect(rows[0].errors).toEqual([]);
    expect(rows[1].rowNumber).toBe(3);
    expect(rows[1].errors.join(' ')).toContain('email');
  });

  it('rejects unknown columns and malformed quoting', () => {
    expect(() => parseLeadCsv('name,role\nAlex,admin')).toThrow('Unsupported CSV columns');
    expect(() => parseLeadCsv('name,message\nAlex,"unfinished')).toThrow('not closed');
    expect(() => parseLeadCsv('name,email\nAlex,al"ex@example.com')).toThrow('must start at the beginning');
  });

  it('rejects rows without a contact identifier and mismatched field counts', () => {
    const rows = parseLeadCsv('name,email,city\n,,Paris\nAlex,alex@example.com,NY,extra');

    expect(rows[0].errors.join(' ')).toContain('at least a name');
    expect(rows[1].errors[0]).toContain('does not match');
  });
});
