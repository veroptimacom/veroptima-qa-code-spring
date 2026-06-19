/**
 * veroptima-qa-code-spring — a STANDALONE public-MIT Spring (`java-parser`)
 * `code-enumerator` backend against the PUBLIC `@qa-expert/code-enumerator-spi`.
 *
 * The deterministic, parser-driven Spring branch enumerator (depends ONLY on the
 * public SPI — ZERO core model IP) wrapped as the SPI's default-export
 * `CodeEnumeratorFactory`. `create()` validates `config.stack === "spring"` and
 * returns the pure `springEnumerator` that emits RAW branches (NO id); the HOST
 * computes branch identity and lifts. Any other stack is rejected.
 *
 * DETERMINISM (the load-bearing property): no clock, no Math.random, no LLM. The
 * raw branch SET is a pure function of `source` alone, so two enumerations are
 * byte-identical.
 *
 * Author: Ricardo Gusmao / Veroptima
 * License: MIT
 */
import {
  CODE_ENUMERATOR_FAMILY,
  type BranchEnumerator,
  type CodeEnumeratorCapabilities,
  type CodeEnumeratorFactory,
  type EnumeratorConfig,
} from "@qa-expert/code-enumerator-spi";
import {
  type PluginContext,
  type SecretResolver,
} from "@qa-expert/plugin-contract";

import { springEnumerator } from "./enumerator.js";

// Typed via `satisfies` (not an annotation): `CodeEnumeratorCapabilities` is a
// closed interface and so is NOT assignable to the meta-contract's
// `capabilities?: Record<string, unknown>` slot, but an inferred object literal
// IS. `satisfies` gives us the contract's shape-check without losing the
// Record-compatible literal type.
const capabilities = {
  stack: "spring",
  interProcedural: false,
} satisfies CodeEnumeratorCapabilities;

/**
 * `java-parser` — the standalone Spring (backend) enumerator factory. `create()`
 * validates `config.stack === "spring"` and returns the deterministic
 * `springEnumerator`.
 */
const factory: CodeEnumeratorFactory = {
  family: CODE_ENUMERATOR_FAMILY,
  subkind: "java-parser",
  contractVersion: "0.1.0",
  capabilities,
  async create(
    config: EnumeratorConfig,
    _secrets: SecretResolver,
    _ctx: PluginContext,
  ): Promise<BranchEnumerator> {
    if (config.stack !== "spring") {
      return Promise.reject(
        new Error(
          `veroptima-qa-code-spring serves stack "spring", not "${config.stack}"`,
        ),
      );
    }
    return springEnumerator;
  },
};

export default factory;
