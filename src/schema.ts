import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "schema", "route.schema.json");

let cachedValidator: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;

  const schemaText = readFileSync(SCHEMA_PATH, "utf-8");
  const schema = JSON.parse(schemaText);

  const ajv = new Ajv.default({ allErrors: true });
  (addFormats as unknown as (ajv: InstanceType<typeof Ajv.default>) => void)(ajv);

  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

export function validate(data: unknown): { valid: boolean; errors: string[] } {
  const validator = getValidator();
  const valid = validator(data);

  if (valid) return { valid: true, errors: [] };

  const errors = (validator.errors ?? []).map((e: { instancePath?: string; message?: string }) => {
    const path = e.instancePath || "/";
    return `${path}: ${e.message}`;
  });

  return { valid: false, errors };
}
