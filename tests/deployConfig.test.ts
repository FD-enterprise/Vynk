import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("frontend production typecheck does not depend on files excluded from Vercel", () => {
  const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8")) as { exclude?: string[] };
  const vercelIgnore = readFileSync(".vercelignore", "utf8").split(/\r?\n/).map((line) => line.trim());

  assert.ok(vercelIgnore.includes("server"), "the signaling server should stay outside the Vercel upload");
  assert.ok(tsconfig.exclude?.includes("tests"), "frontend TypeScript must exclude tests that can import the ignored server");
});
