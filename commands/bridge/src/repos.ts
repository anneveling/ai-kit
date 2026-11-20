// Repo (owner/name) → local clone, for Take the helm. Ported from pr-watch
// (lib.mjs resolveRepoPath, claudeKnownRepoPaths). Order: bridge's repos.json,
// pr-watch's repos.json, then the folders Claude Code knows (~/.claude.json).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function slugFromRemoteUrl(url: string | null): string | null {
  const m = String(url ?? "").trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export function originUrlFromGitConfig(text: string | null): string | null {
  let inOrigin = false;
  for (const line of String(text ?? "").split("\n")) {
    const t = line.trim();
    if (t.startsWith("[")) { inOrigin = /^\[remote\s+"origin"\]$/.test(t); continue; }
    const m = inOrigin && t.match(/^url\s*=\s*(.+)$/);
    if (m) return m[1]!.trim();
  }
  return null;
}

interface ClaudeConfig { githubRepoPaths?: Record<string, string[]>; projects?: Record<string, unknown> }

/** Every clone Claude Code knows about, as { "owner/name": [paths] }. Worktrees are skipped. */
export function claudeKnownRepoPaths(cfg: ClaudeConfig | null, readGitConfig: (dir: string) => string | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (slug: string, p: string) => {
    const key = Object.keys(out).find((k) => k.toLowerCase() === slug.toLowerCase()) ?? slug;
    out[key] ??= [];
    if (!out[key].includes(p)) out[key].push(p);
  };
  for (const [slug, paths] of Object.entries(cfg?.githubRepoPaths ?? {})) for (const p of paths ?? []) add(slug, p);
  for (const p of Object.keys(cfg?.projects ?? {})) {
    if (p.includes("/.claude/worktrees/")) continue;
    const slug = slugFromRemoteUrl(originUrlFromGitConfig(readGitConfig(p)));
    if (slug) add(slug, p);
  }
  return out;
}

export function resolveRepoPath(
  repo: string, overrides: Record<string, string>[], known: Record<string, string[]>, exists: (p: string) => boolean = () => true,
): string | null {
  for (const o of overrides) {
    const own = o[repo];
    if (own && exists(own)) return own;
  }
  const key = Object.keys(known).find((k) => k.toLowerCase() === repo.toLowerCase());
  return (key ? known[key] ?? [] : []).find((p) => p && exists(p)) ?? null;
}

const readJson = <T>(path: string): T | null => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; } };
const readGitConfig = (dir: string) => { try { return readFileSync(join(dir, ".git", "config"), "utf8"); } catch { return null; } };

/** Local paths for these repos, read fresh (edits to repos.json apply without a restart). */
export function localRepoPaths(repos: string[], bridgeHome: string): Record<string, string | null> {
  const overrides = [
    readJson<Record<string, string>>(join(bridgeHome, "repos.json")) ?? {},
    readJson<Record<string, string>>(join(homedir(), ".claude", "pr-watch", "repos.json")) ?? {},
  ];
  const known = claudeKnownRepoPaths(readJson<ClaudeConfig>(join(homedir(), ".claude.json")), readGitConfig);
  return Object.fromEntries(repos.map((r) => [r, resolveRepoPath(r, overrides, known, existsSync)]));
}

const PROMPT: Record<string, string> = {
  fix: "Let's fix the failing CI on",
  address: "Let's address the review feedback on",
  merge: "Let's merge",
  review: "Let's review",
  nudge: "Let's nudge the reviewers on",
};

/**
 * A link that opens a new Claude Code session in the clone, with the prompt
 * filled in but not sent. The desktop app when the clone is known; else the
 * terminal, which can find the repo by name.
 */
export function helmLink(verb: string, repo: string, number: number, topic: string, localPath: string | null): string {
  const q = encodeURIComponent(`${PROMPT[verb] ?? "Let's look at"} PR #${number} in ${repo} (bridge topic: ${topic}).`);
  return localPath
    ? `claude://code/new?folder=${encodeURIComponent(localPath)}&q=${q}`
    : `claude-cli://open?repo=${encodeURIComponent(repo).replace("%2F", "/")}&q=${q}`;
}
