import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "schema", "route.schema.json");

let cachedValidator: ValidateFunction | null = null;
let cachedSchema: SchemaNode | null = null;

interface SchemaNode {
  maxLength?: number;
  properties?: Record<string, SchemaNode>;
  definitions?: Record<string, SchemaNode>;
}

function getSchema(): SchemaNode {
  if (!cachedSchema) cachedSchema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
  return cachedSchema as SchemaNode;
}

function getValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;

  const ajv = new Ajv.default({ allErrors: true });
  (addFormats as unknown as (ajv: InstanceType<typeof Ajv.default>) => void)(ajv);

  cachedValidator = ajv.compile(getSchema());
  return cachedValidator;
}

// Every length limit the schema imposes, keyed `<owner>.<field>` — `route.title`,
// `todoItem.text`. The schema is the canonical source ([STORE-04]), so the
// command boundary ([STORE-11]) and the spec's own table ([STORE-10]) read the
// numbers from here rather than restating them, and raising one stays a
// one-line edit to the JSON.
export function maxLengths(): Record<string, number> {
  const schema = getSchema();
  const found: Record<string, number> = {};

  const collect = (owner: string, node: SchemaNode): void => {
    for (const [field, prop] of Object.entries(node.properties ?? {})) {
      if (typeof prop.maxLength === "number") found[`${owner}.${field}`] = prop.maxLength;
    }
  };

  collect("route", schema);
  for (const [name, def] of Object.entries(schema.definitions ?? {})) collect(name, def);

  return found;
}

// The limit a named field carries, for a caller that refuses over-length input
// before writing. Throws on an unknown key rather than defaulting, so a renamed
// schema field fails loudly here instead of silently dropping the check.
export function maxLength(key: string): number {
  const limit = maxLengths()[key];
  if (limit === undefined) throw new Error(`No maxLength in the schema for ${key}`);
  return limit;
}

// Resolve a JSON pointer against the data being validated. Used only to report
// how long an over-length string actually is: "must NOT have more than 1000
// characters" says what the rule is, not how far past it the file sits, and the
// person repairing the file by hand needs the second number.
function valueAt(data: unknown, pointer: string): unknown {
  let node: unknown = data;
  for (const raw of pointer.split("/").slice(1)) {
    if (node === null || typeof node !== "object") return undefined;
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function validate(data: unknown): { valid: boolean; errors: string[] } {
  const validator = getValidator();
  const valid = validator(data);

  if (valid) return { valid: true, errors: [] };

  const errors = (validator.errors ?? []).map(
    (e: { instancePath?: string; message?: string; keyword?: string }) => {
      const path = e.instancePath || "/";
      if (e.keyword !== "maxLength") return `${path}: ${e.message}`;
      const actual = valueAt(data, e.instancePath ?? "");
      const has = typeof actual === "string" ? ` (has ${actual.length})` : "";
      return `${path}: ${e.message}${has}`;
    },
  );

  return { valid: false, errors };
}
