import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const validators = new Map();
const schemas = new Map();
function getSchema(name = "route") {
    let schema = schemas.get(name);
    if (!schema) {
        const path = resolve(__dirname, "..", "schema", `${name}.schema.json`);
        schema = JSON.parse(readFileSync(path, "utf-8"));
        schemas.set(name, schema);
    }
    return schema;
}
function getValidator(name) {
    const cached = validators.get(name);
    if (cached)
        return cached;
    const ajv = new Ajv.default({ allErrors: true });
    addFormats(ajv);
    const validator = ajv.compile(getSchema(name));
    validators.set(name, validator);
    return validator;
}
// Every length limit the schema imposes, keyed `<owner>.<field>` — `route.title`,
// `todoItem.text`. The schema is the canonical source ([STORE-04]), so the
// command boundary ([STORE-11]) and the spec's own table ([STORE-10]) read the
// numbers from here rather than restating them, and raising one stays a
// one-line edit to the JSON.
export function maxLengths() {
    const schema = getSchema();
    const found = {};
    const collect = (owner, node) => {
        for (const [field, prop] of Object.entries(node.properties ?? {})) {
            if (typeof prop.maxLength === "number")
                found[`${owner}.${field}`] = prop.maxLength;
        }
    };
    collect("route", schema);
    for (const [name, def] of Object.entries(schema.definitions ?? {}))
        collect(name, def);
    return found;
}
// The limit a named field carries, for a caller that refuses over-length input
// before writing. Throws on an unknown key rather than defaulting, so a renamed
// schema field fails loudly here instead of silently dropping the check.
export function maxLength(key) {
    const limit = maxLengths()[key];
    if (limit === undefined)
        throw new Error(`No maxLength in the schema for ${key}`);
    return limit;
}
// Resolve a JSON pointer against the data being validated. Used only to report
// how long an over-length string actually is: "must NOT have more than 1000
// characters" says what the rule is, not how far past it the file sits, and the
// person repairing the file by hand needs the second number.
function valueAt(data, pointer) {
    let node = data;
    for (const raw of pointer.split("/").slice(1)) {
        if (node === null || typeof node !== "object")
            return undefined;
        const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
        node = node[key];
    }
    return node;
}
// Fields [COMPAT-07] retired, and the release each left in. A file carrying one
// is a file from before that release — restored from a backup, or written by a
// tool built against an earlier one — so the report names the field and the
// release instead of ajv's `additionalProperties` message, which says only that
// something unknown is present.
const RETIRED_FIELDS = {
    before: "1.7",
    after: "1.7",
    depends_on: "1.7",
};
export function validate(data, name = "route") {
    const validator = getValidator(name);
    const valid = validator(data);
    if (valid)
        return { valid: true, errors: [] };
    const errors = (validator.errors ?? []).map((e) => {
        const path = e.instancePath || "/";
        if (e.keyword === "additionalProperties") {
            const field = e.params?.additionalProperty ?? "";
            // A route written before the session store carries the records it now
            // owns. The generic retirement message would say to remove the field,
            // which would throw those records away — so this one says where they
            // belong instead.
            if (name === "route" && field === "sessions") {
                return `${path}: sessions live in their own store now, under <root>/<year>/sessions/ — this file predates it`;
            }
            const since = RETIRED_FIELDS[field];
            // Tack-level `depends_on` is live, so it is a known property there and
            // never reaches this branch; only the retired route-level one does.
            if (since) {
                return `${path}: \`${field}\` was retired in ${since}; remove it to load this file`;
            }
            return `${path}: ${e.message}`;
        }
        if (e.keyword !== "maxLength")
            return `${path}: ${e.message}`;
        const actual = valueAt(data, e.instancePath ?? "");
        const has = typeof actual === "string" ? ` (has ${actual.length})` : "";
        return `${path}: ${e.message}${has}`;
    });
    return { valid: false, errors };
}
