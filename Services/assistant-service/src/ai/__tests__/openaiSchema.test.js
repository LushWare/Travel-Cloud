import { describe, it, expect } from 'vitest';
import { stripOptionalNulls, toOpenAIJsonSchema } from '../openaiSchema.js';

describe('toOpenAIJsonSchema', () => {
  it('lowercases Gemini-style uppercase types', () => {
    const { schema } = toOpenAIJsonSchema({ type: 'OBJECT', properties: { tags: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['tags'] });

    expect(schema.type).toBe('object');
    expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('marks every property required and forbids extra keys for strict mode', () => {
    const { schema, strict } = toOpenAIJsonSchema({
      type: 'object',
      properties: { title: { type: 'string' }, note: { type: 'string' } },
      required: ['title'],
    });

    expect(strict).toBe(true);
    expect(schema.required).toEqual(['title', 'note']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('turns an optional property into a nullable one', () => {
    const { schema } = toOpenAIJsonSchema({ type: 'object', properties: { note: { type: 'string' } }, required: [] });

    expect(schema.properties.note.type).toEqual(['string', 'null']);
  });

  it('adds null to the enum of an optional enum property', () => {
    const { schema } = toOpenAIJsonSchema({ type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } });

    expect(schema.properties.mode.enum).toEqual(['a', 'b', null]);
  });

  it('keeps a required property non-nullable', () => {
    const { schema } = toOpenAIJsonSchema({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] });

    expect(schema.properties.title.type).toBe('string');
  });

  it('applies strict rules to objects nested inside arrays', () => {
    const { schema } = toOpenAIJsonSchema({
      type: 'object',
      properties: { days: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, x: { type: 'string' } }, required: ['n'] } } },
      required: ['days'],
    });

    expect(schema.properties.days.items.required).toEqual(['n', 'x']);
    expect(schema.properties.days.items.additionalProperties).toBe(false);
  });

  it('drops keywords strict mode does not accept', () => {
    const { schema } = toOpenAIJsonSchema({
      type: 'object',
      properties: { n: { type: 'number', default: 3, propertyOrdering: ['x'], format: 'float', minimum: 1 } },
      required: ['n'],
    });

    expect(schema.properties.n).toEqual({ type: 'number', minimum: 1 });
  });

  it('honours a Gemini nullable flag', () => {
    const { schema } = toOpenAIJsonSchema({ type: 'object', properties: { n: { type: 'number', nullable: true } }, required: ['n'] });

    expect(schema.properties.n.type).toEqual(['number', 'null']);
  });

  it('falls back to non-strict when an object lists no properties', () => {
    const { strict } = toOpenAIJsonSchema({ type: 'object', properties: { meta: { type: 'object' } } });

    expect(strict).toBe(false);
  });

  it('does not mutate the schema it was given', () => {
    const original = { type: 'object', properties: { a: { type: 'string' } } };
    toOpenAIJsonSchema(original);

    expect(original).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
  });
});

describe('stripOptionalNulls', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      note: { type: 'string' },
      maybe: { type: 'string', nullable: true },
      days: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, x: { type: 'string' } }, required: ['n'] } },
    },
    required: ['title', 'days', 'maybe'],
  };

  it('removes nulls standing in for optional properties', () => {
    expect(stripOptionalNulls({ title: 't', note: null, maybe: 'm', days: [] }, schema)).toEqual({ title: 't', maybe: 'm', days: [] });
  });

  it('removes optional nulls inside array items', () => {
    const result = stripOptionalNulls({ title: 't', maybe: 'm', days: [{ n: 1, x: null }] }, schema);

    expect(result.days).toEqual([{ n: 1 }]);
  });

  it('keeps a null the original schema declared nullable', () => {
    expect(stripOptionalNulls({ title: 't', maybe: null, days: [] }, schema).maybe).toBeNull();
  });

  it('keeps optional properties that carry a value', () => {
    expect(stripOptionalNulls({ title: 't', note: 'n', maybe: 'm', days: [] }, schema).note).toBe('n');
  });
});
