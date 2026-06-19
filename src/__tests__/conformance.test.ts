/**
 * Conformance proof for veroptima-qa-code-spring.
 *
 * Drives the standalone Spring (java-parser) backend through the contract's own
 * `runConformanceSuite` — the SAME behavioral bar the bundled spring suite clears —
 * to PROVE this extracted plugin satisfies `@qa-expert/code-enumerator-contract`
 * with ZERO core edits. The required-branch + required-source-kind sets are copied
 * faithfully from the bundled spring suite (SPRING_REQUIRED / SOURCE_KINDS), incl.
 * the source-kind completeness on the SourceKinds.java fixture.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, test } from "bun:test";

import {
  runConformanceSuite,
  CONFORMANCE_CHECKS,
  type CodeSource,
  type RequiredBranch,
} from "@qa-expert/code-enumerator-contract";
import type { BranchKind } from "@qa-expert/feature-model";
import type {
  PluginContext,
  SecretResolver,
} from "@qa-expert/plugin-contract";

import factory from "../index.js";
import { springEnumerator } from "../enumerator.js";

// ── Minimal context stubs (a parser backend ignores them; they satisfy the types).
const secrets: SecretResolver = {
  async resolve(_ref: string): Promise<string> {
    return "";
  },
};

const ctx: PluginContext = {
  cwd: "/tmp/veroptima-qa-code-spring",
  source: "github:veroptima/veroptima-qa-code-spring@0.1.0",
  resolvedCommit: "0000000000000000000000000000000000000000",
  logger: { info() {}, warn() {}, error() {} },
};

// ---------------------------------------------------------------------------
// Fixtures (the real Spring snapshots, copied from the bundled adapter tests)
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const SPRING_FIXTURE_DIR = join(FIXTURES_DIR, "spring");
const SPRING_SOURCES_FIXTURE_DIR = join(FIXTURES_DIR, "spring-sources");

function springSource(): CodeSource {
  const files = readdirSync(SPRING_FIXTURE_DIR)
    .filter((f) => f.endsWith(".java"))
    .sort()
    .map((name) => ({
      path: `fixtures/spring/${name}`,
      content: readFileSync(join(SPRING_FIXTURE_DIR, name), "utf8"),
    }));
  return { files };
}

/** The SourceKinds fixture — one branch of EACH backend source kind + the
 *  non-HTTP `@*Mapping` pollution the allow-list must EXCLUDE. */
function sourceKindsSource(): CodeSource {
  return {
    files: readdirSync(SPRING_SOURCES_FIXTURE_DIR)
      .filter((f) => f.endsWith(".java"))
      .sort()
      .map((name) => ({
        path: `fixtures/spring-sources/${name}`,
        content: readFileSync(join(SPRING_SOURCES_FIXTURE_DIR, name), "utf8"),
      })),
  };
}

// ---------------------------------------------------------------------------
// Required-branch sets (the worked-example branches that must appear EVERY run)
// ---------------------------------------------------------------------------

const SPRING_REQUIRED: RequiredBranch[] = [
  { kind: "spatial-gate", conditionIncludes: "imovelContidoMunicipio" },
  { kind: "status-transition", conditionIncludes: "RURAL" },
  { kind: "status-transition", conditionIncludes: "URBANO" },
  { kind: "spatial-gate", conditionIncludes: "<= 100" },
];

// The backend source kinds the enumerator must NOT be blind to (mirror of the
// bundled spring suite's SOURCE_KINDS).
const SOURCE_KINDS: BranchKind[] = [
  "endpoint",
  "scheduled",
  "queue-listener",
  "websocket-mapping",
  "event-listener",
  "app-entry",
];

// ---------------------------------------------------------------------------
// POSITIVE — the standalone backend clears the conformance bar
// ---------------------------------------------------------------------------

describe("veroptima-qa-code-spring — conformance suite", () => {
  it("springEnumerator passes ALL checks (5 core + graph_edges_resolve, nodes-only)", async () => {
    const e = await factory.create({ stack: "spring" }, secrets, ctx);
    const report = runConformanceSuite({
      enumerator: e,
      source: springSource(),
      requiredBranches: SPRING_REQUIRED,
    });
    for (const c of report.checks) {
      expect(c.passed, `${c.check}: ${c.detail}`).toBe(true);
    }
    expect(report.passed).toBe(true);
    // 5 core dims + graph_edges_resolve (always-on; nodes-only AST backend → trivially satisfied).
    expect(report.checks.length).toBe(6);
  });

  it("detects EVERY source kind on the SourceKinds fixture (blind-to-a-kind → RED)", async () => {
    const e = await factory.create({ stack: "spring" }, secrets, ctx);
    const report = runConformanceSuite({
      enumerator: e,
      source: sourceKindsSource(),
      requiredBranches: [],
      requiredSourceKinds: SOURCE_KINDS,
    });
    const check = report.checks.find(
      (c) => c.check === CONFORMANCE_CHECKS.sourceKindCompleteness,
    );
    expect(check, "source-kind-completeness check must run").toBeDefined();
    expect(check!.passed, check!.detail).toBe(true);
    expect(report.passed).toBe(true);
    // 5 core + source-kind-completeness + graph_edges_resolve.
    expect(report.checks.length).toBe(7);
  });

  it("the HTTP allow-list EXCLUDES non-HTTP @*Mapping pollution (exactly ONE endpoint)", () => {
    // @SqlResultSetMapping / @Mapping / @ConstructorResult in the fixture must NOT
    // be counted as `endpoint` — only the single @GetMapping is an endpoint.
    const branches = springEnumerator.enumerate(sourceKindsSource()).branches;
    const endpoints = branches.filter((b) => b.kind === "endpoint");
    expect(endpoints.length).toBe(1);
    expect(endpoints[0].condition).toContain("/widgets");
  });

  it("is deterministic — two enumerations are byte-identical", async () => {
    const e = await factory.create({ stack: "spring" }, secrets, ctx);
    const source = springSource();
    expect(JSON.stringify(e.enumerate(source))).toBe(
      JSON.stringify(e.enumerate(source)),
    );
  });

  it("rejects a non-spring stack at create()", async () => {
    await expect(
      factory.create({ stack: "vue" }, secrets, ctx),
    ).rejects.toThrow();
  });
});
