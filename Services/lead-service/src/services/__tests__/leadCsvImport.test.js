import { describe, expect, it } from 'vitest';
import { parseLeadCsv, parseLeadCsvWithColumns } from '../leadCsvImport.js';

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

  it('rejects malformed quoting', () => {
    expect(() => parseLeadCsv('name,message\nAlex,"unfinished')).toThrow('not closed');
    expect(() => parseLeadCsv('name,email\nAlex,al"ex@example.com')).toThrow('must start at the beginning');
  });

  it('rejects rows without a contact identifier and mismatched field counts', () => {
    const rows = parseLeadCsv('name,email,city\n,,Paris\nAlex,alex@example.com,NY,extra');

    expect(rows[0].errors.join(' ')).toContain('at least a name');
    expect(rows[1].errors[0]).toContain('does not match');
  });
});

describe('parseLeadCsvWithColumns', () => {
  it('imports a sheet exported from another tool, skipping the columns it does not use', () => {
    const csv = 'id,name,phone,email,google_place_id,city,rating,call_status\n'
      + '42,Sunrise Tours,+94771234567,info@sunrise.test,ChIJ123,Kandy,4.5,called';

    const { rows, ignoredColumns } = parseLeadCsvWithColumns(csv);

    expect(rows[0]).toMatchObject({
      errors: [],
      data: { name: 'Sunrise Tours', phone: '+94771234567', email: 'info@sunrise.test', city: 'Kandy' },
    });
    expect(ignoredColumns).toEqual(['id', 'google_place_id', 'rating', 'call_status']);
  });

  it('never reads a value from a skipped column', () => {
    const { rows } = parseLeadCsvWithColumns('name,role\nAlex,admin');

    expect(rows[0].data).toEqual({ name: 'Alex' });
  });

  it.each([
    ['Full Name', 'Alex', 'name'],
    ['phone_number', '+94771234567', 'phone'],
    ['Mobile', '+94771234567', 'phone'],
    ['E-mail Address', 'a@b.test', 'email'],
    ['travel_date', '2027-01-10', 'travelDate'],
    ['Number of Travellers', '3', 'numberOfTravelers'],
    ['Notes', 'Call after 5', 'message'],
  ])('reads the column "%s" as a lead field', (header, value, field) => {
    const { rows } = parseLeadCsvWithColumns(`${header},whatsapp\n${value},+94770000000`);

    expect(Object.keys(rows[0].data)).toContain(field);
  });

  it('refuses a sheet with no name, email, phone or WhatsApp column', () => {
    expect(() => parseLeadCsvWithColumns('company,rating\nAcme,5')).toThrow('at least one of these columns');
  });

  it('refuses two columns that mean the same thing', () => {
    expect(() => parseLeadCsvWithColumns('phone,mobile\n1,2')).toThrow('More than one column means the same thing: phone');
  });
});
