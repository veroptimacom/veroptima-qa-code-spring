// veroptima-qa-code-spring — the Spring (backend) branch enumerator.
//
// A PURE, parser-driven walk over a `CodeSource` of `.java` files that emits the
// FIXED set of path-changing RAW branches (NO id) with AST provenance. The parse is
// `java-parser` (a Chevrotain CST); the walk is DETERMINISTIC (document order,
// child-index-addressed `node_path`), never an LLM re-read. Same `CodeSource` →
// byte-identical `branches[]` SET, every run. The plugin emits RAW against the
// PUBLIC `@qa-expert/code-enumerator-spi` ONLY; the HOST computes branch identity,
// lifts each `RawBranch` → the private id-bearing `Branch`, and sorts after lifting.
//
// ── How the CST is walked (the uniqueness scheme)
// `java-parser`'s `parse()` returns a CST whose CST nodes carry `.name` (the rule
// name, e.g. `ifStatement`), `.children` (a record of named arrays of child CST
// nodes / tokens), and `.location` (`startLine`/`startOffset`/`endOffset`).
// We recurse the `.children` arrays in a STABLE key order (Object.keys is
// insertion order for the CST; we sort keys to be defensive against any reorder)
// and append a `name[index]` segment per step. So every node owns a UNIQUE path
// like `compilationUnit/.../methodDeclaration[2]/.../ifStatement[0]` — two `if`s
// on the SAME line get distinct paths (distinct child indices), which is what
// keeps their host-assigned ids from fusing (the completeness property the
// host's node-path guard protects after the lift).
//
// ── Reading `condition` text (the declared seam)
// CST token order is post-order-ish (operators trail operands), so joining token
// images would yield non-infix garbage. Instead we slice the ORIGINAL source by
// the node's `location.startOffset..endOffset` — deterministic, and human-legible
// infix text. (The spec permits reading token images for `condition`; slicing the
// source by the CST-provided offsets is the same information, cleaner.)

import { parse } from "java-parser";

import {
  type BranchEnumerator,
  type BranchKind,
  type CodeSource,
  type RawBranch,
  type RawEnumeratorResult,
} from "@qa-expert/code-enumerator-spi";

// ---------------------------------------------------------------------------
// Minimal structural view of the java-parser CST (we do not depend on its types)
// ---------------------------------------------------------------------------

interface CstNode {
  name: string;
  children: Record<string, Array<CstNode | CstToken>>;
  location?: {
    startLine?: number | null;
    startOffset?: number | null;
    endOffset?: number | null;
  };
}

interface CstToken {
  image: string;
  startOffset?: number;
  endOffset?: number;
  startLine?: number;
}

function isCstNode(x: CstNode | CstToken | undefined | null): x is CstNode {
  return !!x && typeof (x as CstNode).name === "string" && !!(x as CstNode).children;
}

// ---------------------------------------------------------------------------
// Spatial-gate signature — the documented business gate
// ---------------------------------------------------------------------------

// The worked-example spatial/containment gate, in either snake or camel form.
// Matched against the raw condition text so an `if` over a spatial containment
// check is classified `spatial-gate` (not a generic `method-guard`).
const SPATIAL_GATE_RE = /imovel[_]?contido[_]?municipio/i;

// Security annotations that gate a path → `auth-guard`.
const AUTH_ANNOTATIONS = new Set([
  "PreAuthorize",
  "PostAuthorize",
  "Secured",
  "RolesAllowed",
  "PreFilter",
  "PostFilter",
]);

// HTTP `@*Mapping` request entry points → `endpoint`. An EXPLICIT allow-list, NOT
// `/Mapping$/`: real code carries NON-HTTP `@*Mapping` annotations
// (`@SqlResultSetMapping`, MapStruct `@Mapping`, `@ConstructorResult`,
// `@ColumnResult`) that must NOT be counted as request endpoints. (Correctness fix
// found on real-world code — `@SqlResultSetMapping` was being counted as an endpoint.)
const HTTP_MAPPING_ANNOTATIONS = new Set([
  "GetMapping",
  "PostMapping",
  "PutMapping",
  "DeleteMapping",
  "PatchMapping",
  "RequestMapping",
]);

// `@Scheduled` → `scheduled` (a flow starts on a timer).
const SCHEDULED_ANNOTATIONS = new Set(["Scheduled"]);

// Message-queue consumer entry points → `queue-listener`.
const QUEUE_ANNOTATIONS = new Set([
  "KafkaListener",
  "RabbitListener",
  "JmsListener",
]);

// STOMP / WebSocket destination mappings → `websocket-mapping`. Tested BEFORE the
// generic HTTP allow-list so `@MessageMapping`/`@SubscribeMapping` are NOT swallowed
// (they end in `Mapping` but are NOT HTTP request endpoints).
const WEBSOCKET_ANNOTATIONS = new Set(["MessageMapping", "SubscribeMapping"]);

// Application-event consumer entry points → `event-listener`.
const EVENT_ANNOTATIONS = new Set(["EventListener"]);

// CommandLineRunner / ApplicationRunner — a process-startup entry point (app-entry).
const APP_ENTRY_INTERFACES = new Set(["CommandLineRunner", "ApplicationRunner"]);

// ---------------------------------------------------------------------------
// Source-text helpers (the condition-reading seam)
// ---------------------------------------------------------------------------

/** Slice the original source by a node's location offsets → clean infix text.
 *  Collapses internal whitespace runs to single spaces (deterministic, stable
 *  across formatting of the slice). Falls back to "" if offsets are absent. */
function sliceCondition(content: string, node: CstNode): string {
  const loc = node.location;
  if (!loc || loc.startOffset == null || loc.endOffset == null) return "";
  return content.slice(loc.startOffset, loc.endOffset + 1).replace(/\s+/g, " ").trim();
}

/** The start line of a node (1-based), 0 when the CST omits it (non-negative per schema). */
function startLine(node: CstNode | CstToken): number {
  const line =
    (node as CstNode).location?.startLine ?? (node as CstToken).startLine ?? undefined;
  return typeof line === "number" && line >= 0 ? line : 0;
}

/** First descendant CST node (or token) by rule name, document order; else undefined. */
function firstChild(node: CstNode, name: string): CstNode | undefined {
  const arr = node.children[name];
  if (arr) {
    for (const c of arr) if (isCstNode(c) && c.name === name) return c;
  }
  return undefined;
}

/** First token image found anywhere under a node (document order). */
function firstTokenImage(node: CstNode): string | undefined {
  for (const key of [...Object.keys(node.children)].sort()) {
    for (const c of node.children[key]) {
      if (isCstNode(c)) {
        const r = firstTokenImage(c);
        if (r !== undefined) return r;
      } else if (typeof c.image === "string") {
        return c.image;
      }
    }
  }
  return undefined;
}

/** Concatenate ALL token images under a node, document order (for typeName etc.). */
function tokenText(node: CstNode): string {
  const out: string[] = [];
  const visit = (n: CstNode): void => {
    for (const key of [...Object.keys(n.children)].sort()) {
      for (const c of n.children[key]) {
        if (isCstNode(c)) visit(c);
        else if (typeof c.image === "string") out.push(c.image);
      }
    }
  };
  visit(node);
  return out.join("");
}

// ---------------------------------------------------------------------------
// The deterministic CST walk — collect a raw record per path-changing node
// ---------------------------------------------------------------------------

/** A path-changing site as the CST walk collects it — structural fields only,
 *  pre-lift (no id). Mapped to the SPI `RawBranch` in `enumerate()`. */
interface WalkRecord {
  kind: BranchKind;
  condition: string;
  arms: string[];
  line: number;
  nodeKind: string;
  nodePath: string;
}

/** Classify an annotation node → a branch kind (or undefined if not path-changing).
 *  Reads the annotation's `typeName` token image (e.g. `GetMapping`, `PreAuthorize`).
 *
 *  ORDER MATTERS: the SOURCE-kind annotations (scheduled / queue / websocket / event)
 *  are tested BEFORE the HTTP allow-list. `@MessageMapping`/`@SubscribeMapping` end in
 *  `Mapping` but are websocket destinations, NOT HTTP request endpoints — they must be
 *  caught first. The HTTP `endpoint` test is an explicit allow-list (NOT `/Mapping$/`)
 *  so non-HTTP `@*Mapping` (`@SqlResultSetMapping`, MapStruct `@Mapping`,
 *  `@ConstructorResult`, `@ColumnResult`) is EXCLUDED. */
function classifyAnnotation(ann: CstNode): BranchKind | undefined {
  const typeName = firstChild(ann, "typeName");
  const name = typeName ? tokenText(typeName) : (firstTokenImage(ann) ?? "");
  // strip any package qualifier (e.g. `org.x.GetMapping` → `GetMapping`)
  const simple = name.split(".").pop() ?? name;
  if (AUTH_ANNOTATIONS.has(simple)) return "auth-guard";
  if (SCHEDULED_ANNOTATIONS.has(simple)) return "scheduled";
  if (QUEUE_ANNOTATIONS.has(simple)) return "queue-listener";
  if (WEBSOCKET_ANNOTATIONS.has(simple)) return "websocket-mapping";
  if (EVENT_ANNOTATIONS.has(simple)) return "event-listener";
  // HTTP request endpoints — the explicit allow-list (NOT a `/Mapping$/` regex).
  if (HTTP_MAPPING_ANNOTATIONS.has(simple)) return "endpoint";
  return undefined;
}

/** Does the source-text slice of a throw look like a *validation* throw? */
function isValidationThrow(condition: string): boolean {
  return /throw\s+new\s+\w+/.test(condition);
}

/** Extract the case-label arms of a switch (case constants + default), in order. */
function switchArms(switchNode: CstNode): string[] {
  const arms: string[] = [];
  const visit = (n: CstNode): void => {
    if (n.name === "switchLabel") {
      // `case X` → "case <X>"; `default` → "default"
      if (n.children.Default) {
        arms.push("default");
      } else {
        const caseConstant = firstChild(n, "caseConstant");
        const label = caseConstant ? tokenText(caseConstant) : "case";
        arms.push(`case ${label}`);
      }
      return;
    }
    for (const key of [...Object.keys(n.children)].sort()) {
      for (const c of n.children[key]) if (isCstNode(c)) visit(c);
    }
  };
  visit(switchNode);
  return arms;
}

/** Is this switch over a status-enum (→ status-transition) rather than a plain method guard?
 *  Heuristic: a case-label references a status-shaped constant, OR the discriminant
 *  text mentions status/tipo. We classify RURAL/URBANO type switches as
 *  status-transition since they drive a status assignment. */
function looksLikeStatusSwitch(discriminant: string, arms: string[]): boolean {
  if (/status|tipo|estado|situacao/i.test(discriminant)) return true;
  return arms.some((a) => /status|rural|urbano|pendente|emitid|aprovad/i.test(a));
}

/** Is this assignment a status-enum transition (RHS references a *Status enum)? */
function isStatusAssignment(condition: string): boolean {
  // e.g. `imovel.setStatus(CertidaoStatus.EMITIDA)` or `status = CertidaoStatus.X`
  return /Status\.\w+/.test(condition) || /\bset[A-Z]\w*Status\b/.test(condition);
}

/** The simple Identifier of a `methodDeclaration` (e.g. `main`), or undefined. */
function methodName(methodDecl: CstNode): string | undefined {
  const header = firstChild(methodDecl, "methodHeader");
  const declarator = header ? firstChild(header, "methodDeclarator") : undefined;
  const idArr = declarator?.children["Identifier"];
  if (idArr) {
    for (const c of idArr) {
      if (!isCstNode(c) && typeof c.image === "string") return c.image;
    }
  }
  return undefined;
}

/** Does a `methodDeclaration` carry a `static` modifier? */
function hasStaticModifier(methodDecl: CstNode): boolean {
  const mods = methodDecl.children["methodModifier"];
  if (!mods) return false;
  for (const m of mods) {
    if (isCstNode(m) && /\bstatic\b/.test(tokenText(m))) return true;
  }
  return false;
}

/** The simple Identifier of a `normalClassDeclaration` (its `typeIdentifier`). */
function className(classDecl: CstNode): string | undefined {
  const typeId = firstChild(classDecl, "typeIdentifier");
  if (typeId) {
    const t = tokenText(typeId).trim();
    if (t) return t;
  }
  return undefined;
}

/** Does a `normalClassDeclaration` implement an app-entry interface
 *  (`CommandLineRunner` / `ApplicationRunner`)? Reads the `classImplements` text. */
function implementsAppEntry(classDecl: CstNode): boolean {
  const impls = classDecl.children["classImplements"];
  if (!impls) return false;
  for (const node of impls) {
    if (!isCstNode(node)) continue;
    const text = tokenText(node);
    for (const iface of APP_ENTRY_INTERFACES) {
      if (text.includes(iface)) return true;
    }
  }
  return false;
}

/**
 * Walk the CST in document order, appending `name[index]` path segments, and
 * collect a `RawBranch` per path-changing site. Pure: depends only on the CST +
 * the original source content.
 */
function walk(root: CstNode, content: string): WalkRecord[] {
  const out: WalkRecord[] = [];

  const recurse = (node: CstNode, path: string): void => {
    switch (node.name) {
      case "annotation": {
        const kind = classifyAnnotation(node);
        if (kind) {
          out.push({
            kind,
            condition: sliceCondition(content, node),
            arms: [],
            line: startLine(node),
            nodeKind: node.name,
            nodePath: path,
          });
        }
        break;
      }
      case "ifStatement": {
        const exprNode = firstChild(node, "expression");
        const condition = exprNode ? sliceCondition(content, exprNode) : "";
        const arms = node.children.Else ? ["then", "else"] : ["then"];
        const kind: BranchKind = SPATIAL_GATE_RE.test(condition)
          ? "spatial-gate"
          : "method-guard";
        out.push({
          kind,
          condition,
          arms,
          line: startLine(node),
          nodeKind: node.name,
          nodePath: path,
        });
        break;
      }
      case "switchStatement": {
        const exprNode = firstChild(node, "expression");
        const discriminant = exprNode ? sliceCondition(content, exprNode) : "";
        const arms = switchArms(node);
        const kind: BranchKind = looksLikeStatusSwitch(discriminant, arms)
          ? "status-transition"
          : "method-guard";
        out.push({
          kind,
          condition: discriminant,
          arms,
          line: startLine(node),
          nodeKind: node.name,
          nodePath: path,
        });
        break;
      }
      case "throwStatement": {
        const condition = sliceCondition(content, node);
        if (isValidationThrow(condition)) {
          out.push({
            kind: "validation-throw",
            condition,
            arms: [],
            line: startLine(node),
            nodeKind: node.name,
            nodePath: path,
          });
        }
        break;
      }
      case "localVariableDeclarationStatement":
      case "statementExpression": {
        // status-enum transition via assignment / setStatus(...) call
        const condition = sliceCondition(content, node);
        if (isStatusAssignment(condition)) {
          out.push({
            kind: "status-transition",
            condition,
            arms: [],
            line: startLine(node),
            nodeKind: node.name,
            nodePath: path,
          });
        }
        break;
      }
      case "methodDeclaration": {
        // APP-ENTRY (best-effort): a `public static void main(...)` is a process
        // entry point — a flow STARTS here. Detected by the method Identifier
        // `main` + a `static` modifier (no annotation, so classifyAnnotation can't
        // catch it). `condition` is the structural `app-entry:main` identifier.
        if (methodName(node) === "main" && hasStaticModifier(node)) {
          out.push({
            kind: "app-entry",
            condition: "app-entry:main",
            arms: [],
            line: startLine(node),
            nodeKind: node.name,
            nodePath: path,
          });
        }
        break;
      }
      case "normalClassDeclaration": {
        // APP-ENTRY (best-effort): a class implementing `CommandLineRunner` /
        // `ApplicationRunner` runs on startup — a flow STARTS in its `run`.
        if (implementsAppEntry(node)) {
          const cn = className(node) ?? "";
          out.push({
            kind: "app-entry",
            condition: `app-entry:${cn}`,
            arms: [],
            line: startLine(node),
            nodeKind: node.name,
            nodePath: path,
          });
        }
        break;
      }
      default:
        break;
    }

    // Recurse children in a STABLE key order; append `name[index]` per step so
    // every node owns a unique, document-ordered path.
    for (const key of [...Object.keys(node.children)].sort()) {
      const arr = node.children[key];
      for (let i = 0; i < arr.length; i++) {
        const child = arr[i];
        if (isCstNode(child)) {
          recurse(child, `${path}/${child.name}[${i}]`);
        }
      }
    }
  };

  recurse(root, root.name);
  return out;
}

// ---------------------------------------------------------------------------
// springEnumerator — the BranchEnumerator implementation
// ---------------------------------------------------------------------------

/** Build the Spring branch enumerator. A factory so the harness can wire it the
 *  same way it wires the Vue adapter (no shared mutable state at module scope). */
export function createSpringEnumerator(): BranchEnumerator {
  return {
    stack: "spring",
    enumerate(source: CodeSource): RawEnumeratorResult {
      // RAW emission: the plugin computes NO id. The HOST lifts each RawBranch to
      // the private id-bearing Branch (computing branch identity) and sorts after lifting.
      // We emit in the DETERMINISTIC structural order the walk produces (file order,
      // then document order within each file) — determinism of the SET is the contract.
      const branches: RawBranch[] = [];

      const javaFiles = source.files.filter((f) => f.path.endsWith(".java"));

      for (const file of javaFiles) {
        let root: CstNode;
        try {
          root = parse(file.content) as unknown as CstNode;
        } catch {
          // A file that does not parse contributes no branches; it is still a
          // scanned file (counted below). Determinism preserved (no throw).
          continue;
        }

        const raws = walk(root, file.content);
        for (const raw of raws) {
          branches.push({
            stack: "spring",
            kind: raw.kind,
            condition: raw.condition,
            arms: raw.arms,
            provenance: {
              file: file.path,
              line: raw.line,
              node_kind: raw.nodeKind,
              node_path: raw.nodePath,
            },
          });
        }
      }

      return {
        stack: "spring",
        branches,
        scannedFiles: javaFiles.length,
      };
    },
  };
}

/** The Spring branch enumerator (singleton convenience; pure, so sharing is safe). */
export const springEnumerator: BranchEnumerator = createSpringEnumerator();
