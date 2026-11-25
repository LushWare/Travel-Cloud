// Translates the response schemas this service already writes for Gemini into
// what OpenAI Structured Outputs accepts, so no prompt module has to know which
// provider answered.
//
// Strict mode is the reason this is more than a rename. It guarantees the reply
// matches the schema, but only for schemas where every object lists ALL of its
// properties as required and forbids extra keys. Our schemas lean on optional
// properties (the assistant's flat `args` object has dozens, of which a turn
// fills two), so an optional property becomes a required-but-nullable one, and
// `stripOptionalNulls` removes those nulls from the reply again — callers keep
// seeing an absent key exactly as Gemini returned it, and a Zod `.optional()`
// downstream never meets a `null` it would reject.
//
// Keywords outside the subset OpenAI documents for strict schemas are dropped
// rather than sent: an unsupported keyword fails the whole request with a 400,
// which would take an AI feature down over a hint like `default`. A schema strict
// mode cannot express at all (an object with no listed properties) is sent
// non-strict instead — valid JSON is still guaranteed, schema adherence is not,
// and every caller validates the result anyway.

const KEPT_KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'const', 'description', 'anyOf',
  'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems',
]);
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid']);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const lowerType = (type) => (Array.isArray(type) ? type.map(lowerType) : typeof type === 'string' ? type.toLowerCase() : type);

// Gemini spelling → JSON Schema spelling, unsupported keywords removed. Reports
// whether every object in the tree lists its properties (the strict-mode test).
function normalize(node, state) {
  if (!isPlainObject(node)) return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'format') {
      if (SUPPORTED_FORMATS.has(value)) out.format = value;
    } else if (key === 'type') {
      out.type = lowerType(value);
    } else if (key === 'properties') {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, normalize(child, state)]));
    } else if (key === 'items') {
      out.items = normalize(value, state);
    } else if (key === 'anyOf') {
      out.anyOf = value.map((branch) => normalize(branch, state));
    } else if (KEPT_KEYWORDS.has(key)) {
      out[key] = value;
    }
  }
  if (node.nullable === true) makeNullable(out);
  if (out.type === 'object' && !isPlainObject(out.properties)) state.strict = false;
  return out;
}

function makeNullable(schema) {
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((branch) => branch.type === 'null')) schema.anyOf.push({ type: 'null' });
    return;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.includes('null')) schema.type = [...types, 'null'];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(null)) schema.enum = [...schema.enum, null];
}

function toStrict(node) {
  if (!isPlainObject(node)) return node;
  if (node.items) node.items = toStrict(node.items);
  if (node.anyOf) node.anyOf = node.anyOf.map(toStrict);
  if (isPlainObject(node.properties)) {
    const required = new Set(node.required ?? []);
    for (const [name, child] of Object.entries(node.properties)) {
      node.properties[name] = toStrict(child);
      if (!required.has(name)) makeNullable(node.properties[name]);
    }
    node.required = Object.keys(node.properties);
    node.additionalProperties = false;
  }
  return node;
}

/** `{ schema, strict }` ready for the Responses API `text.format` block. */
export function toOpenAIJsonSchema(schema) {
  const state = { strict: true };
  const normalized = normalize(schema, state);
  if (!state.strict || normalized?.type !== 'object') return { schema: normalized, strict: false };
  return { schema: toStrict(normalized), strict: true };
}

/**
 * Drops the `null`s strict mode put in place of properties the ORIGINAL schema
 * left optional, recursing through nested objects, arrays and anyOf branches.
 * A null for a property the original schema declared nullable is kept.
 */
export function stripOptionalNulls(value, schema) {
  if (!isPlainObject(schema)) return value;
  if (Array.isArray(value)) {
    return schema.items ? value.map((item) => stripOptionalNulls(item, schema.items)) : value;
  }
  if (!isPlainObject(value)) return value;

  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.reduce((acc, branch) => stripOptionalNulls(acc, branch), value);
  }
  if (!isPlainObject(schema.properties)) return value;

  const required = new Set(schema.required ?? []);
  const out = { ...value };
  for (const [name, child] of Object.entries(schema.properties)) {
    if (out[name] === null && !required.has(name) && child?.nullable !== true) {
      delete out[name];
    } else if (name in out) {
      out[name] = stripOptionalNulls(out[name], child);
    }
  }
  return out;
}
