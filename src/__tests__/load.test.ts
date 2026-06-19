/**
 * Host-load proof for veroptima-qa-code-spring.
 *
 * Proves this STANDALONE plugin loads as an EXTERNAL `{ref, integrity}` plugin
 * through the SAME host path as every other family — `loadPluginsFromConfig` —
 * REGISTERS into `globalCodeEnumeratorRegistry` as `spring:java-parser`, and the
 * loaded backend PASSES `runConformanceSuite`. A TAMPERED integrity FAILS the load
 * (the security lock holds; the failure lands in `summary.errors` with an
 * "integrity" message). Mirrors the in-monorepo closed-world proof.
 */
import { describe, expect, test } from "bun:test";

import { runConformanceSuite } from "@qa-expert/code-enumerator-contract";
import type {
  PluginContext,
  SecretResolver,
} from "@qa-expert/plugin-contract";
import {
  loadPluginsFromConfig,
  globalCodeEnumeratorRegistry,
  resolveEnumerator,
  computeDirectoryIntegrity,
  PluginsConfig,
  type LoadPluginsContext,
} from "@qa-expert/shared";

// src/__tests__ → src → <this plugin repo root>.
const THIS_DIR = new URL("../..", import.meta.url).pathname;

// Minimal meta-contract create() args — a parser backend ignores them.
const noSecrets = { resolve: async () => "" } as unknown as SecretResolver;
const ctx = {
  cwd: "/tmp",
  source: "external",
  resolvedCommit: "0".repeat(40),
  logger: { info() {}, warn() {}, error() {} },
} as unknown as PluginContext;

const loadCtx: LoadPluginsContext = { engineerId: "proof", runTag: "proof-run" };

// A tiny Spring source the loaded backend parses into endpoint + guard branches.
const SPRING_SOURCE = {
  files: [
    {
      path: "OrdersController.java",
      content: [
        "package com.example;",
        "import org.springframework.web.bind.annotation.*;",
        "",
        "@RestController",
        'class OrdersController {',
        '  @GetMapping("/orders")',
        "  public Object list(Long page) {",
        "    if (page == null) {",
        '      throw new ValidationException("page required");',
        "    }",
        "    return page;",
        "  }",
        "}",
        "",
      ].join("\n"),
    },
    { path: "README.md", content: "# not a .java file — must be ignored\n" },
  ],
};

describe("veroptima-qa-code-spring — host load via {ref, integrity}", () => {
  test("loads through loadPluginsFromConfig, registers spring:java-parser, and passes runConformanceSuite", async () => {
    const integrity = await computeDirectoryIntegrity(THIS_DIR);
    expect(integrity.length).toBeGreaterThan(0);

    const plugins = PluginsConfig.parse({
      "code-enumerators": [
        {
          id: "spring",
          ref: `file:${THIS_DIR}`,
          integrity,
          config: { stack: "spring" },
        },
      ],
    });

    const summary = await loadPluginsFromConfig(plugins, loadCtx);

    // Registered with NO errors, under the code-enumerator family.
    expect(summary.errors).toEqual([]);
    const reg = summary.registered.find((r) => r.family === "code-enumerator");
    expect(reg, "the spring plugin must register as a code-enumerator").toBeDefined();
    expect(reg!.id).toBe("spring");
    expect(reg!.subkind).toBe("java-parser");

    // It landed in the SHARED global registry, selectable per-stack with no core change.
    const entry = globalCodeEnumeratorRegistry.select({ stack: "spring" });
    expect(entry.id).toBe("spring:java-parser");

    // The loaded backend clears the SAME behavioral bar as the bundled spring/vue.
    const enumerator = await resolveEnumerator(
      globalCodeEnumeratorRegistry,
      { stack: "spring" },
      noSecrets,
      ctx,
    );
    const report = runConformanceSuite({
      enumerator,
      source: SPRING_SOURCE,
      requiredBranches: [],
    });
    if (!report.passed) {
      console.error(report.checks.filter((c) => !c.passed));
    }
    expect(report.passed).toBe(true);
    // Non-vacuous: the backend actually emitted branches over the .java parse.
    expect(enumerator.enumerate(SPRING_SOURCE).branches.length).toBeGreaterThan(0);
  });

  test("a TAMPERED integrity fails the load (the lock holds; no registration happens)", async () => {
    const plugins = PluginsConfig.parse({
      "code-enumerators": [
        {
          id: "spring-tampered",
          ref: `file:${THIS_DIR}`,
          integrity:
            "sha256-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          config: { stack: "spring" },
        },
      ],
    });

    const summary = await loadPluginsFromConfig(plugins, loadCtx);

    expect(
      summary.registered.find((r) => r.family === "code-enumerator"),
    ).toBeUndefined();
    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0]!.family).toBe("code-enumerator");
    expect(summary.errors[0]!.message.toLowerCase()).toContain("integrity");
  });
});
