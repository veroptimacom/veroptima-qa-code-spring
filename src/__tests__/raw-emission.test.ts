/**
 * RAW-emission proof for veroptima-qa-code-spring (0c model split).
 *
 * The conformance suite is PRIVATE (host-only) now — this plugin depends ONLY on the
 * PUBLIC `@qa-expert/code-enumerator-spi` and CANNOT import the suite, the lift, or
 * the feature model. So instead of clearing the host's behavioral bar here, these
 * tests assert the plugin's OWN contract: that `enumerate()` returns SPI `RawBranch[]`
 * with the expected kinds/conditions over a Spring fixture, that NO `id` field is
 * present (the host assigns identity), and that emission is DETERMINISTIC
 * (two calls JSON-identical). Types come from the SPI ONLY.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import type {
  CodeSource,
  RawBranch,
  RawEnumeratorResult,
} from "@qa-expert/code-enumerator-spi";

import factory from "../index.js";
import { springEnumerator } from "../enumerator.js";

// ── Minimal context stubs (a parser backend ignores them; satisfy the factory sig).
const noSecrets = { resolve: async () => "" } as never;
const ctx = {
  cwd: "/tmp/veroptima-qa-code-spring",
  source: "external",
  resolvedCommit: "0".repeat(40),
  logger: { info() {}, warn() {}, error() {} },
} as never;

// ---------------------------------------------------------------------------
// Fixtures (the real Spring snapshots that ship with this plugin)
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const SPRING_FIXTURE_DIR = join(FIXTURES_DIR, "spring");
const SPRING_SOURCES_FIXTURE_DIR = join(FIXTURES_DIR, "spring-sources");

function dirSource(dir: string, label: string): CodeSource {
  return {
    files: readdirSync(dir)
      .filter((f) => f.endsWith(".java"))
      .sort()
      .map((name) => ({
        path: `fixtures/${label}/${name}`,
        content: readFileSync(join(dir, name), "utf8"),
      })),
  };
}

const springSource = (): CodeSource => dirSource(SPRING_FIXTURE_DIR, "spring");
const sourceKindsSource = (): CodeSource =>
  dirSource(SPRING_SOURCES_FIXTURE_DIR, "spring-sources");

describe("veroptima-qa-code-spring — RAW emission against the SPI", () => {
  it("create() returns a raw enumerator; enumerate() yields RawBranch[] (NO id)", async () => {
    const e = await factory.create({ stack: "spring" }, noSecrets, ctx);
    const result: RawEnumeratorResult = e.enumerate(springSource());

    expect(result.stack).toBe("spring");
    expect(result.scannedFiles).toBeGreaterThan(0);
    expect(result.branches.length).toBeGreaterThan(0);

    for (const b of result.branches) {
      // ZERO model IP: the plugin assigns NO id; the host lifts and assigns identity.
      expect(b).not.toHaveProperty("id");
      // Structural RawBranch shape: stack + kind + condition + provenance{...}.
      expect(b.stack).toBe("spring");
      expect(typeof b.kind).toBe("string");
      expect(typeof b.condition).toBe("string");
      expect(b.provenance.file).toMatch(/\.java$/);
      expect(typeof b.provenance.line).toBe("number");
      expect(typeof b.provenance.node_kind).toBe("string");
      expect(typeof b.provenance.node_path).toBe("string");
    }
  });

  it("classifies @GetMapping → an `endpoint` RawBranch", () => {
    const branches: RawBranch[] = springEnumerator
      .enumerate(sourceKindsSource())
      .branches;
    const endpoints = branches.filter((b) => b.kind === "endpoint");
    // The HTTP allow-list excludes non-HTTP @*Mapping pollution → exactly one endpoint.
    expect(endpoints.length).toBe(1);
    expect(endpoints[0]!.condition).toContain("/widgets");
    expect(endpoints[0]!).not.toHaveProperty("id");
  });

  it("classifies an `if` guard → a method-guard / conditional RawBranch", () => {
    const SOURCE: CodeSource = {
      files: [
        {
          path: "Guard.java",
          content: [
            "class Guard {",
            "  String check(Long page) {",
            "    if (page == null) {",
            '      return "missing";',
            "    }",
            '    return "ok";',
            "  }",
            "}",
            "",
          ].join("\n"),
        },
      ],
    };
    const branches = springEnumerator.enumerate(SOURCE).branches;
    const guards = branches.filter((b) => b.kind === "method-guard");
    expect(guards.length).toBe(1);
    expect(guards[0]!.condition).toContain("page == null");
    expect(guards[0]!.arms).toEqual(["then"]);
    expect(guards[0]!).not.toHaveProperty("id");
  });

  it("is deterministic — two enumerations are byte-identical (the SET, no ids)", async () => {
    const e = await factory.create({ stack: "spring" }, noSecrets, ctx);
    const source = springSource();
    expect(JSON.stringify(e.enumerate(source))).toBe(
      JSON.stringify(e.enumerate(source)),
    );
  });

  it("emits NO `id` anywhere in the serialized result (zero model IP)", () => {
    const json = JSON.stringify(springEnumerator.enumerate(springSource()));
    expect(json).not.toContain('"id"');
  });

  it("rejects a non-spring stack at create()", async () => {
    await expect(
      factory.create({ stack: "vue" }, noSecrets, ctx),
    ).rejects.toThrow();
  });
});
