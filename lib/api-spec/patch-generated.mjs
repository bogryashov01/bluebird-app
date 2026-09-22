#!/usr/bin/env node
/**
 * patch-generated.mjs
 *
 * Post-generation patch applied automatically after every `orval` run
 * (see the "codegen" script in package.json).
 *
 * Problem
 * -------
 * Orval generates hook signatures like:
 *
 *   options?: { query?: UseQueryOptions<TData, TError, TReturn>, ... }
 *
 * TanStack Query's UseQueryOptions<> requires `queryKey` as a mandatory field,
 * so callers who pass only `{ enabled: false }` get a TypeScript error:
 *   "Property 'queryKey' is missing in type …"
 *
 * The generated factory always supplies `queryKey` internally
 * (`{ queryKey, queryFn, ...queryOptions }`), so callers should never
 * need to provide it.  The correct parameter type is therefore:
 *
 *   options?: { query?: Partial<UseQueryOptions<TData, TError, TReturn>>, ... }
 *
 * Fix
 * ---
 * Replace every  query?:UseQueryOptions<X, Y, Z>
 * with           query?:Partial<UseQueryOptions<X, Y, Z>>
 * in the generated api.ts file.  The extra `Partial<` opening bracket is
 * closed by inserting `>` immediately after the matching closing `>` of
 * each UseQueryOptions<…> using a bracket-depth counter.
 *
 * Idempotency
 * -----------
 * The pattern `query?:Partial<UseQueryOptions<` is only matched if it
 * does NOT already contain `Partial<`, so running this script twice is safe.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(
  __dirname,
  "..",
  "api-client-react",
  "src",
  "generated",
  "api.ts"
);
const ZOD_TARGET = path.resolve(
  __dirname,
  "..",
  "api-zod",
  "src",
  "generated",
  "api.ts"
);
const API_SCHEMAS_TARGET = path.resolve(
  __dirname,
  "..",
  "api-client-react",
  "src",
  "generated",
  "api.schemas.ts"
);

const NEEDLE = "query?:UseQueryOptions<";
const REPLACEMENT = "query?:Partial<UseQueryOptions<";

/**
 * Given a line that already contains REPLACEMENT, insert a closing `>`
 * immediately after the matching `>` of the inner UseQueryOptions<…>.
 */
function addClosingAngle(line) {
  const marker = REPLACEMENT;
  const idx = line.indexOf(marker);
  if (idx === -1) return line;

  // Start depth counting from the `<` of UseQueryOptions<
  const innerStart = idx + "query?:Partial<".length; // points to 'U' of UseQueryOptions<
  let depth = 0;
  let pos = innerStart;

  while (pos < line.length) {
    const ch = line[pos];
    if (ch === "<") {
      depth++;
    } else if (ch === ">") {
      depth--;
      if (depth === 0) {
        // pos is the closing > of UseQueryOptions<…>; insert > after it
        line = line.slice(0, pos + 1) + ">" + line.slice(pos + 1);
        break;
      }
    }
    pos++;
  }
  return line;
}

const original = readFileSync(TARGET, "utf8");

// Idempotency guard: count only the *bare* (unpatched) occurrences.
// When everything is already patched, bareCount === 0 and we exit immediately.
//
// The previous implementation computed `toFix = bareCount - patchedCount` and
// exited only when toFix === 0.  That was wrong: on a fully-patched file
// bareCount=0 and patchedCount=20, so toFix=-20 (not 0), and the script
// continued — running addClosingAngle on every already-patched line and
// appending a spurious extra '>' each time, corrupting the file.
const bareCount = (original.split(NEEDLE).length - 1);

if (bareCount > 0) {
  // Replace every bare occurrence.  There are no already-patched occurrences.
  const afterReplace = original.replaceAll(NEEDLE, REPLACEMENT);
  const lines = afterReplace.split("\n");
  const fixed = lines
    .map((line) => (line.includes(REPLACEMENT) ? addClosingAngle(line) : line))
    .join("\n");
  writeFileSync(TARGET, fixed, "utf8");
}

// Orval can emit scalar limits/regex constants after schemas that reference
// them, causing TS2448 and a runtime temporal-dead-zone failure. Hoist only
// single-line scalar/RegExp constants; Zod schema declarations remain in place.
const zodOriginal = readFileSync(ZOD_TARGET, "utf8");
const zodLines = zodOriginal.split("\n");
const scalarConstantPattern =
  /^export const [A-Za-z0-9_]+ = (?:-?\d+(?:\.\d+)?|'(?:[^'\\]|\\.)*'|new RegExp\(.+\));$/;
const scalarConstants = zodLines.filter((line) => scalarConstantPattern.test(line));
const withoutScalarConstants = zodLines.filter((line) => !scalarConstantPattern.test(line));
if (scalarConstants.length > 0) {
  const importEnd = withoutScalarConstants.findIndex((line) => line.startsWith("import "));
  withoutScalarConstants.splice(importEnd + 1, 0, "", ...scalarConstants);
  writeFileSync(ZOD_TARGET, withoutScalarConstants.join("\n"), "utf8");
}

// Orval emits zod.int() for OpenAPI integer fields, but this workspace uses
// Zod 3, where integer validation is expressed as zod.number().int().
const zodContent = readFileSync(ZOD_TARGET, "utf8");
const zodCompatibleContent = zodContent.replaceAll("zod.int()", "zod.number().int()");
if (zodCompatibleContent !== zodContent) {
  writeFileSync(ZOD_TARGET, zodCompatibleContent, "utf8");
}

// Orval leaves multiple blank lines at EOF. Normalize generated files so
// codegen always leaves a clean diff.
for (const generatedFile of [TARGET, API_SCHEMAS_TARGET, ZOD_TARGET]) {
  const content = readFileSync(generatedFile, "utf8");
  writeFileSync(generatedFile, `${content.trimEnd()}\n`, "utf8");
}

console.log(
  `patch-generated: wrapped ${bareCount} UseQueryOptions occurrence(s) in Partial<>; hoisted ${scalarConstants.length} Zod constants.`
);
