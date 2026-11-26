import { describe, expect, it } from "vitest";

import { strictSchema } from "./claude";

/** Loose view of a transformed schema for assertions. */
type Node = { [key: string]: Node } & Record<string, unknown>;
const view = (x: unknown) => x as Node;

// Claude Sonnet 5.5 and Haiku 5.5 get JSON through structured outputs, which accept a schema
// only when every object has `additionalProperties: false` and carries no numeric/string/array
// length constraints. The kajian and deliverable schemas were written for Gemini; strictSchema
// adapts them. A live run on 2026-11-26 sent all four real schemas through it and the API
// accepted each one; this pins the transformation itself.
describe("strictSchema", () => {
  it("closes every object, at any depth, including array items", () => {
    const out = view(strictSchema({
      type: "object",
      properties: {
        a: { type: "object", properties: { b: { type: "string" } } },
        list: { type: "array", items: { type: "object", properties: { c: { type: "integer" } } } },
      },
    }));
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.a.additionalProperties).toBe(false);
    expect(out.properties.list.items.additionalProperties).toBe(false);
    expect(out.properties.list.additionalProperties).toBeUndefined();
  });

  it("drops the constraints structured outputs reject, and nothing else", () => {
    const out = view(strictSchema({
      type: "object",
      required: ["n"],
      properties: {
        n: { type: "integer", minimum: 0, maximum: 9, description: "kept" },
        s: { type: "string", minLength: 1, maxLength: 80, enum: ["x", "y"] },
        l: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } },
      },
    }));
    expect(out.required).toEqual(["n"]);
    expect(out.properties.n).toEqual({ type: "integer", description: "kept" });
    expect(out.properties.s).toEqual({ type: "string", enum: ["x", "y"] });
    expect(out.properties.l).toEqual({ type: "array", items: { type: "string" } });
  });

  it("keeps a property whose NAME is a constraint keyword", () => {
    const out = view(strictSchema({
      type: "object",
      properties: { minimum: { type: "number" }, pattern: { type: "string" } },
    }));
    expect(Object.keys(out.properties)).toEqual(["minimum", "pattern"]);
  });

  it("does not change the input", () => {
    const input = { type: "object", properties: { a: { type: "string", maxLength: 3 } } };
    strictSchema(input);
    expect(input).toEqual({ type: "object", properties: { a: { type: "string", maxLength: 3 } } });
  });
});
