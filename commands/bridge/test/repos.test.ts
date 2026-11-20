import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeKnownRepoPaths, helmLink, originUrlFromGitConfig, resolveRepoPath, slugFromRemoteUrl } from "../src/repos.ts";

test("slug from ssh and https remotes", () => {
  assert.equal(slugFromRemoteUrl("git@github.com:Acme/Web.git"), "acme/web");
  assert.equal(slugFromRemoteUrl("https://github.com/acme/web"), "acme/web");
  assert.equal(slugFromRemoteUrl("https://gitlab.com/acme/web"), null);
});

test("origin url from a git config", () => {
  const text = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = x\n[remote "origin"]\n\turl = git@github.com:acme/web.git\n';
  assert.equal(originUrlFromGitConfig(text), "git@github.com:acme/web.git");
});

test("Claude's known folders map to repos; worktrees are skipped", () => {
  const cfg = { githubRepoPaths: { "acme/api": ["/src/api"] }, projects: { "/src/web": {}, "/src/web/.claude/worktrees/x": {}, "/tmp/notgit": {} } };
  const git = (dir: string) => (dir === "/src/web" ? '[remote "origin"]\n\turl = https://github.com/acme/web.git\n' : null);
  assert.deepEqual(claudeKnownRepoPaths(cfg, git), { "acme/api": ["/src/api"], "acme/web": ["/src/web"] });
});

test("own overrides first, then pr-watch's, then Claude's; paths must exist", () => {
  const known = { "Acme/Web": ["/gone", "/src/web"] };
  const exists = (p: string) => p !== "/gone";
  assert.equal(resolveRepoPath("acme/web", [{ "acme/web": "/mine" }, { "acme/web": "/prw" }], known, exists), "/mine");
  assert.equal(resolveRepoPath("acme/web", [{}, { "acme/web": "/prw" }], known, exists), "/prw");
  assert.equal(resolveRepoPath("acme/web", [{}, {}], known, exists), "/src/web");
  assert.equal(resolveRepoPath("acme/none", [{}], known, exists), null);
});

test("helm link: desktop in the clone when known, else the terminal by repo name", () => {
  assert.equal(helmLink("fix", "acme/web", 812, "Payouts v2", "/src/web"),
    "claude://code/new?folder=%2Fsrc%2Fweb&q=Let's%20fix%20the%20failing%20CI%20on%20PR%20%23812%20in%20acme%2Fweb%20(bridge%20topic%3A%20Payouts%20v2).");
  assert.match(helmLink("review", "acme/web", 830, "Photos", null), /^claude-cli:\/\/open\?repo=acme\/web&q=Let's%20review%20PR%20%23830/);
});
