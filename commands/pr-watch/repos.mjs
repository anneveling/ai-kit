#!/usr/bin/env node
// repos.mjs — map GitHub repos to local clones for pr-watch's "open in Claude" links.
// source: https://github.com/anneveling/ai-kit/tree/main/commands/pr-watch
//
// Usage:
//   node repos.mjs                       check, then ask for any repo without a known clone
//   node repos.mjs --all                 ask for every repo (Enter keeps the current path)
//   node repos.mjs --check               print the status only, never ask (exit 1 if any unmapped)
//   node repos.mjs --set owner/name=/abs/path [--set ...]   non-interactive (used by /pr-watch)
//
// Paths are saved to $STATE_DIR/repos.json. Repos that Claude Code has already seen
// (folders in ~/.claude.json) resolve without asking.

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline/promises";
import { claudeKnownRepoPaths, resolveRepoPath } from "./lib.mjs";

const STATE_DIR = process.env.STATE_DIR ?? join(homedir(), ".claude", "pr-watch");
const REPOS_FILE = join(STATE_DIR, "repos.json");
const CURRENT_FILE = join(STATE_DIR, "current.json");
const CLAUDE_CONFIG_FILE = join(homedir(), ".claude.json");

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
}

function expand(p) {
  const t = p.trim();
  return resolve(t.startsWith("~") ? join(homedir(), t.slice(1)) : t);
}

// Returns an error string, a warning string prefixed with "warn:", or null when fine.
function checkClone(repo, path) {
  if (!existsSync(path)) return "path does not exist";
  let remotes;
  try {
    remotes = execFileSync("git", ["-C", path, "remote", "-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "not a git repository";
  }
  const slug = repo.toLowerCase();
  const matches = remotes.toLowerCase().split("\n").some((l) => l.includes(slug + ".git") || l.includes(slug + " ") || l.includes(slug + "\t"));
  return matches ? null : `warn: no git remote points at ${repo}`;
}

const args = process.argv.slice(2);
const overrides = readJson(REPOS_FILE);
function readGitConfig(dir) {
  try { return readFileSync(join(dir, ".git", "config"), "utf8"); } catch { return null; }
}
const claudePaths = claudeKnownRepoPaths(readJson(CLAUDE_CONFIG_FILE), readGitConfig);

function save() {
  mkdirSync(STATE_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(REPOS_FILE, JSON.stringify(sorted, null, 2) + "\n");
}

// ── --set: non-interactive ────────────────────────────────────────────────────

const sets = args.flatMap((a, i) => (a === "--set" && args[i + 1] ? [args[i + 1]] : []));
if (sets.length) {
  let failed = false;
  for (const s of sets) {
    const eq = s.indexOf("=");
    const repo = s.slice(0, eq);
    if (eq < 1 || !repo.includes("/")) { console.error(`✗ ${s}: expected owner/name=/abs/path`); failed = true; continue; }
    const path = expand(s.slice(eq + 1));
    const problem = checkClone(repo, path);
    if (problem && !problem.startsWith("warn:")) { console.error(`✗ ${repo}: ${problem} (${path})`); failed = true; continue; }
    overrides[repo] = path;
    console.log(`✓ ${repo} → ${path}${problem ? `  (${problem.slice(6)})` : ""}`);
  }
  save();
  process.exit(failed ? 1 : 0);
}

// ── Status ────────────────────────────────────────────────────────────────────

const repos = [...new Set([
  ...(readJson(CURRENT_FILE).prs ?? []).map((p) => p.repo),
  ...Object.keys(overrides),
])].filter(Boolean).sort();

if (repos.length === 0) {
  console.log("No repos yet — start pr-watch once so it knows which repos have your PRs, then run this again.");
  process.exit(0);
}

const SOURCE_LABEL = { config: "repos.json", claude: "Claude Code" };
const status = repos.map((repo) => ({ repo, ...resolveRepoPath(repo, overrides, claudePaths, existsSync) }));
console.log(`pr-watch repo paths (${REPOS_FILE})\n`);
for (const { repo, path, source } of status) {
  console.log(path ? `  ✓ ${repo}  →  ${path}  [${SOURCE_LABEL[source]}]` : `  ✗ ${repo}  →  (unknown)`);
}
const unmapped = status.filter((s) => !s.path);

if (args.includes("--check") || !process.stdin.isTTY) {
  if (unmapped.length) console.log(`\n${unmapped.length} unmapped. Run \`node ${join(dirname(fileURLToPath(import.meta.url)), "repos.mjs")}\` in a terminal to set them.`);
  process.exit(unmapped.length ? 1 : 0);
}

// ── Interactive ───────────────────────────────────────────────────────────────

const toAsk = args.includes("--all") ? status : unmapped;
if (toAsk.length === 0) {
  console.log("\nAll repos mapped. Use --all to change one.");
  process.exit(0);
}

console.log("\nEnter the absolute path of each local clone (~ is fine). Leave empty to skip.");
const rl = createInterface({ input: process.stdin, output: process.stdout });
for (const { repo, path: current } of toAsk) {
  while (true) {
    const answer = (await rl.question(`\n${repo}${current ? ` [${current}]` : ""}: `)).trim();
    if (!answer) break;
    const path = expand(answer);
    const problem = checkClone(repo, path);
    if (problem && !problem.startsWith("warn:")) { console.log(`  ✗ ${problem} — try again, or Enter to skip`); continue; }
    if (problem) console.log(`  ⚠ ${problem.slice(6)} — saved anyway`);
    overrides[repo] = path;
    console.log(`  ✓ ${repo} → ${path}`);
    break;
  }
}
rl.close();
save();
console.log(`\nSaved ${REPOS_FILE}. The dashboard picks it up on the next poll.`);
