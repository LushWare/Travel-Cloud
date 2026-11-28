import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  PRICING_BASIS,
  MARGIN_TYPE,
  COST_LINE_SOURCE,
  OPTIONAL_FLIGHT_TYPE,
  ACTOR,
  PRICING,
  COST_LINE_CATEGORY,
  PRICING_BASIS_LABELS,
  MARGIN_TYPE_LABELS,
  COST_LINE_SOURCE_LABELS,
  OPTIONAL_FLIGHT_TYPE_LABELS,
  COST_LINE_CATEGORY_LABELS,
} from '../index.js';

describe('lead pricing enums', () => {
  it('defines the exact pricing basis values', () => {
    expect(PRICING_BASIS).toEqual({
      PER_PERSON: 'PER_PERSON',
      PER_ROOM: 'PER_ROOM',
      PER_VEHICLE: 'PER_VEHICLE',
      PER_KM: 'PER_KM',
      FIXED: 'FIXED',
    });
  });

  it('defines the exact margin types', () => {
    expect(MARGIN_TYPE).toEqual({
      PERCENTAGE: 'PERCENTAGE',
      FIXED: 'FIXED',
    });
  });

  it('defines the exact cost line sources', () => {
    expect(COST_LINE_SOURCE).toEqual({
      AUTO: 'AUTO',
      MANUAL: 'MANUAL',
    });
  });

  it('defines the exact optional flight types', () => {
    expect(OPTIONAL_FLIGHT_TYPE).toEqual({
      TO_START: 'TO_START',
      RETURN_HOME: 'RETURN_HOME',
    });
  });

  it('defines the exact status history actors', () => {
    expect(ACTOR).toEqual({
      USER: 'USER',
      SYSTEM: 'SYSTEM',
    });
  });

  it('defines the global pricing constants', () => {
    expect(PRICING).toEqual({
      DEFAULT_CURRENCY: 'USD',
    });
  });

  it('defines cost line categories matching the billing-service ItemCategory enum', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const schemaPath = path.resolve(here, '../../../../billing-service/prisma/schema.prisma');
    const schema = readFileSync(schemaPath, 'utf8');
    const match = schema.match(/enum ItemCategory \{([^}]*)\}/);
    expect(match).toBeTruthy();
    const prismaValues = match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('@@') && !line.startsWith('//'))
      .map((line) => line.replace(/ @map\(.*\)/, ''));
    expect(prismaValues.sort()).toEqual(Object.values(COST_LINE_CATEGORY).sort());
  });

  it('matches the lead-service Prisma schema enums', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const schemaPath = path.resolve(here, '../../../../lead-service/prisma/schema.prisma');
    const schema = readFileSync(schemaPath, 'utf8');

    const parseEnum = (name) => {
      const match = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
      if (!match) throw new Error(`Prisma enum ${name} not found in lead-service schema`);
      return match[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('@@') && !line.startsWith('//'))
        .map((line) => line.replace(/ @map\(.*\)/, ''));
    };

    expect(parseEnum('PricingBasis').sort()).toEqual(Object.values(PRICING_BASIS).sort());
    expect(parseEnum('MarginType').sort()).toEqual(Object.values(MARGIN_TYPE).sort());
    expect(parseEnum('CostLineSource').sort()).toEqual(Object.values(COST_LINE_SOURCE).sort());
    expect(parseEnum('OptionalFlightType').sort()).toEqual(Object.values(OPTIONAL_FLIGHT_TYPE).sort());
    expect(parseEnum('StatusHistoryActor').sort()).toEqual(Object.values(ACTOR).sort());
    expect(parseEnum('CostLineCategory').sort()).toEqual(Object.values(COST_LINE_CATEGORY).sort());
  });

  it('provides a label for every pricing basis, margin type, source, flight type and category', () => {
    for (const key of Object.keys(PRICING_BASIS)) {
      expect(typeof PRICING_BASIS_LABELS[key]).toBe('string');
    }
    for (const key of Object.keys(MARGIN_TYPE)) {
      expect(typeof MARGIN_TYPE_LABELS[key]).toBe('string');
    }
    for (const key of Object.keys(COST_LINE_SOURCE)) {
      expect(typeof COST_LINE_SOURCE_LABELS[key]).toBe('string');
    }
    for (const key of Object.keys(OPTIONAL_FLIGHT_TYPE)) {
      expect(typeof OPTIONAL_FLIGHT_TYPE_LABELS[key]).toBe('string');
    }
    for (const key of Object.keys(COST_LINE_CATEGORY)) {
      expect(typeof COST_LINE_CATEGORY_LABELS[key]).toBe('string');
    }
  });
});
