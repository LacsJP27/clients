// Fails if platform-neutral shared code references a platform API (ADR-0001).
//
// Two checks per target:
//   1. A text scan for forbidden identifiers (catches references in any position, including
//      comments and strings that would hint at platform coupling).
//   2. `tsc` with a tsconfig that loads no platform types (`lib: ["ES2022"]`, `types: []`), so any
//      use of a browser, extension, desktop, or Node global fails to compile.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  {
    name: "VaultStorage contract (C3), suite (C6), and InMemoryVaultStorage (C5)",
    directories: [
      "libs/storage-core/src/vault-storage",
      "libs/storage-test-utils/src/vault-storage-contract",
    ],
    tsconfig: "libs/storage-test-utils/tsconfig.platform-neutral.json",
  },
];

const forbidden = [
  { label: "chrome", pattern: /\bchrome\b/i },
  { label: "electron", pattern: /\belectron\b/i },
  { label: "node:", pattern: /\bnode:/ },
  { label: "fs", pattern: /\bfs\b/ },
  { label: "Buffer", pattern: /\bBuffer\b/ },
];

function listTsFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return listTsFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

let failed = false;

for (const target of targets) {
  const violations = [];
  const files = target.directories.flatMap((directory) => listTsFiles(join(root, directory)));
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const { label, pattern } of forbidden) {
          if (pattern.test(line)) {
            violations.push(`  ${relative(root, file)}:${index + 1}  references "${label}"`);
          }
        }
      });
  }

  if (files.length === 0) {
    console.error(`✗ ${target.name}: no files found; check the target directories`);
    failed = true;
  } else if (violations.length > 0) {
    console.error(`✗ ${target.name}: forbidden platform references\n${violations.join("\n")}`);
    failed = true;
  }

  try {
    execFileSync(
      process.execPath,
      [join(root, "node_modules/typescript/bin/tsc"), "--project", join(root, target.tsconfig)],
      { cwd: root, stdio: "inherit" },
    );
  } catch {
    console.error(
      `✗ ${target.name}: does not type-check without platform types (${target.tsconfig})`,
    );
    failed = true;
  }

  if (!failed) {
    console.log(`✓ ${target.name}: ${files.length} files are platform-neutral`);
  }
}

process.exitCode = failed ? 1 : 0;
