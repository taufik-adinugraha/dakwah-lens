import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ---------------------------------------------------------------------------------------------
// Waris engine guard (docs/waris-plan.md §10 M1.3, §9.4). The float rules apply ONLY to
// src/lib/waris/**; the network ban also covers the waris UI (src/components/waris/**) and its
// routes (src/app/[locale]/waris/**), which hold the answers and the rupiah amounts.
// Core ESLint rules only; no new dependency.
//  - no float arithmetic: shares are exact bigint rationals (frac.ts). Non-integer numeric
//    literals, Math, parseFloat, Number(), toFixed, ** and the `/` `%` operators are banned
//    outside frac.ts (bigint-only `/` `%`), checks/prng.ts (uint32 `%`) and the named display
//    module format.ts (the only file exempt from the float rules).
//  - no network: fetch, XMLHttpRequest, navigator.sendBeacon, WebSocket, EventSource, and
//    node/http imports are banned in every waris file, format.ts included.
// ---------------------------------------------------------------------------------------------
const WARIS = ["src/lib/waris/**/*.ts", "src/lib/waris/**/*.tsx"];
// "src/app/*/waris" is the [locale] segment (a glob "*" avoids escaping the brackets)
const WARIS_UI = ["src/components/waris/**/*.ts", "src/components/waris/**/*.tsx", "src/app/*/waris/**/*.ts", "src/app/*/waris/**/*.tsx"];
const NO_NET = "waris: no network calls — answers never leave the browser (plan §9.4).";
const NO_FLOAT = "waris: no float arithmetic — use exact bigint rationals from frac.ts (plan §7.1, M1.3).";

const networkGlobals = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map((name) => ({ name, message: NO_NET }));
const networkProperties = [
  { object: "navigator", property: "sendBeacon", message: NO_NET },
  ...["window", "globalThis", "self"].flatMap((object) =>
    ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].map((property) => ({ object, property, message: NO_NET })),
  ),
];
const networkImports = {
  paths: ["http", "https", "net", "tls", "dgram", "undici", "axios", "node-fetch"].map((name) => ({ name, message: NO_NET })),
  patterns: [{ group: ["node:*"], message: NO_NET }],
};
const floatGlobals = ["Math", "parseFloat", "Number"].map((name) => ({ name, message: NO_FLOAT }));
const floatSyntax = [
  // 1.5, .5, 1e3 (hex/octal/binary and bigint literals are integers)
  { selector: "Literal[raw=/^[0-9_]*\\.[0-9]|^[0-9][0-9_]*[eE]/]", message: NO_FLOAT },
  { selector: "MemberExpression[property.name='toFixed']", message: NO_FLOAT },
  { selector: "BinaryExpression[operator='**']", message: NO_FLOAT },
  { selector: "AssignmentExpression[operator='**=']", message: NO_FLOAT },
];
const divisionSyntax = [
  { selector: "BinaryExpression[operator='/']", message: `${NO_FLOAT} Division lives in frac.ts (bigint only).` },
  { selector: "BinaryExpression[operator='%']", message: `${NO_FLOAT} Remainder lives in frac.ts (bigint only).` },
  { selector: "AssignmentExpression[operator='/=']", message: NO_FLOAT },
  { selector: "AssignmentExpression[operator='%=']", message: NO_FLOAT },
];
const FRAC_AND_PRNG = ["src/lib/waris/frac.ts", "src/lib/waris/checks/prng.ts"];
const FORMAT = ["src/lib/waris/format.ts"];

const warisGuard = [
  {
    files: WARIS,
    ignores: [...FRAC_AND_PRNG, ...FORMAT],
    rules: {
      "no-restricted-globals": ["error", ...networkGlobals, ...floatGlobals],
      "no-restricted-properties": ["error", ...networkProperties],
      "no-restricted-imports": ["error", networkImports],
      "no-restricted-syntax": ["error", ...floatSyntax, ...divisionSyntax],
    },
  },
  {
    // bigint `/` `%` (frac.ts) and uint32 `%` (seeded PRNG) are allowed; floats are not
    files: FRAC_AND_PRNG,
    rules: {
      "no-restricted-globals": ["error", ...networkGlobals, ...floatGlobals],
      "no-restricted-properties": ["error", ...networkProperties],
      "no-restricted-imports": ["error", networkImports],
      "no-restricted-syntax": ["error", ...floatSyntax],
    },
  },
  {
    // the named display-formatting module: exempt from the float rules, never from the network ban
    files: FORMAT,
    rules: {
      "no-restricted-globals": ["error", ...networkGlobals],
      "no-restricted-properties": ["error", ...networkProperties],
      "no-restricted-imports": ["error", networkImports],
    },
  },
  {
    // the waris UI and routes: the network ban only (the UI formats percentages; plan §9.4).
    // Unit tests run in node under vitest and read fixtures with node:fs; they never ship.
    files: WARIS_UI,
    ignores: ["src/components/waris/**/*.test.ts"],
    rules: {
      "no-restricted-globals": ["error", ...networkGlobals],
      "no-restricted-properties": ["error", ...networkProperties],
      "no-restricted-imports": ["error", networkImports],
    },
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...warisGuard,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
