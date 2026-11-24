/**
 * Minimal reader for the bundled OpenAPI spec (`build/openapi.bundled.yaml`, produced by
 * `redocly bundle docs/api/openapi.yaml`). The bundle keeps internal `#/components/...` refs,
 * so this module resolves local JSON pointers and builds sample values from schemas.
 * It never reads `docs/api/` directly: QA tests the same artefact both generators read (ADR-005).
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };
export type OpenApiDoc = JsonObject;

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function loadOpenApi(file: string): OpenApiDoc {
  const doc = parse(readFileSync(file, 'utf8')) as unknown;
  return parseOpenApiObject(doc, file);
}

export function parseOpenApiText(text: string, source = '<inline>'): OpenApiDoc {
  return parseOpenApiObject(parse(text) as unknown, source);
}

function parseOpenApiObject(doc: unknown, source: string): OpenApiDoc {
  if (!isObject(doc) || typeof doc.openapi !== 'string' || !isObject(doc.paths)) {
    throw new Error(`${source}: not an OpenAPI document (missing "openapi" or "paths")`);
  }
  return doc;
}

export function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Resolves a local ref such as `#/components/schemas/Money`. External refs are an error: use the bundle. */
export function resolvePointer(doc: OpenApiDoc, ref: string): Json {
  if (!ref.startsWith('#/')) {
    throw new Error(`Non-local $ref "${ref}": point the generator at the bundled spec`);
  }
  let cur: Json = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(cur) || !(key in cur)) {
      throw new Error(`Unresolvable $ref "${ref}"`);
    }
    cur = cur[key];
  }
  return cur;
}

/** Follows `$ref` chains until a non-ref node is reached. */
export function deref(doc: OpenApiDoc, node: Json | undefined, seen = new Set<string>()): Json | undefined {
  let cur = node;
  while (isObject(cur) && typeof cur.$ref === 'string') {
    if (seen.has(cur.$ref)) throw new Error(`Circular $ref "${cur.$ref}"`);
    seen.add(cur.$ref);
    cur = resolvePointer(doc, cur.$ref);
  }
  return cur;
}

export const SAMPLE_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * Builds a schema-valid sample value: example → default → const → first enum → by type.
 * Objects get their required properties only. Used so the permission matrix sends bodies that
 * pass validation, keeping a 403 from being masked by a 400/422 (see test-plan Q17).
 */
export function sampleFromSchema(doc: OpenApiDoc, schemaNode: Json | undefined, depth = 0, variant = 0): Json {
  const schema = deref(doc, schemaNode);
  if (!isObject(schema) || depth > 8) return null;

  // Array items get variant 0, 1, 2... so enum-keyed rules ("one per order type") differ.
  if (variant > 0 && Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[variant % schema.enum.length];
  if ('example' in schema) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if ('default' in schema) return schema.default;
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  if (Array.isArray(schema.allOf)) {
    const merged: JsonObject = {};
    for (const part of schema.allOf) {
      const v = sampleFromSchema(doc, part, depth + 1, variant);
      if (isObject(v)) Object.assign(merged, v);
    }
    return merged;
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length > 0) {
      return sampleFromSchema(doc, options[0], depth + 1, variant);
    }
  }

  const type = Array.isArray(schema.type)
    ? (schema.type.find((t) => t !== 'null') as string | undefined)
    : (schema.type as string | undefined);

  switch (type ?? (isObject(schema.properties) ? 'object' : undefined)) {
    case 'object': {
      const out: JsonObject = {};
      const props = isObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      for (const name of required) {
        out[name] = sampleFromSchema(doc, props[name], depth + 1, variant);
      }
      return out;
    }
    case 'array': {
      const min = typeof schema.minItems === 'number' ? schema.minItems : 0;
      return min > 0 ? Array.from({ length: min }, (_, i) => sampleFromSchema(doc, schema.items, depth + 1, i)) : [];
    }
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 1;
    case 'boolean':
      return false;
    case 'string':
      return sampleString(schema);
    default:
      return null;
  }
}

function sampleString(schema: JsonObject): string {
  switch (schema.format) {
    case 'uuid':
      return SAMPLE_UUID;
    case 'date-time':
      return '2026-11-21T08:30:00Z';
    case 'date':
      return '2026-11-21';
    case 'email':
      return 'qa@example.test';
    case 'password':
      return 'Sample#Passw0rd';
    default:
      break;
  }
  const min = typeof schema.minLength === 'number' ? schema.minLength : 1;
  return 'x'.repeat(Math.max(min, 1));
}
