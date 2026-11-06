#!/usr/bin/env python3
"""Print what happened between you and Claude since a date, for a retro.

Usage:
  python3 -I sessions-since.py 2026-11-01                 # all projects
  python3 -I sessions-since.py 2026-11-01 --project api   # projects whose folder contains "api"
  python3 -I sessions-since.py 2026-11-01 --claude 0      # your messages only

Reads ~/.claude/projects/*/*.jsonl (read-only). Per session it prints what you typed, the start
of the Claude reply you were answering, and the markers Claude Code records itself:
  [INTERRUPT]  you stopped Claude mid-turn
  [REJECTED]   you declined a tool call (with your reason, if you gave one)
  [WALK-BACK]  Claude took something back ("I overstated", "you're right, I ...")

Injected text (system reminders, skill bodies, task notifications, other sessions' messages)
is left out, so it doesn't count as something you said.
"""
import argparse, glob, json, os, re

WALKBACK = re.compile(
    r"\bI overstated\b|\byou'?re right[,.]? (?:and )?I\b|\bI (?:was|got (?:that|it)) wrong\b"
    r"|\bmy mistake\b|\bI misread\b",
    re.I,
)
INJECTED = ("<", "Caveat:", "Base directory for this skill", "Another Claude session",
            "This session is being continued")
REJECTED = "The user doesn't want to proceed with this tool use"


def text_of(content):
    if isinstance(content, str):
        return content
    return "\n".join(x.get("text", "") for x in content or []
                     if isinstance(x, dict) and x.get("type") == "text")


def short(s, n):
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def slash_command(s):
    m = re.search(r"<command-name>(/[^<]+)</command-name>", s)
    if not m:
        return None
    args = re.search(r"<command-args>([^<]*)</command-args>", s)
    return (m.group(1) + " " + (args.group(1) if args else "")).strip()


def read_session(path, claude_chars):
    events, title, start, end = [], None, None, None
    last_reply = ""
    for line in open(path, errors="ignore"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "custom-title" and e.get("customTitle"):
            title = e["customTitle"]
        if e.get("isMeta") or e.get("isSidechain") or e.get("isCompactSummary"):
            continue
        msg = e.get("message") or {}
        content = msg.get("content")
        ts = e.get("timestamp", "")

        if e.get("type") == "assistant":
            t = text_of(content).strip()
            if t:
                last_reply = t
                # One per reply; skip quoted mentions ("I overstated" when talking about walk-backs).
                for m in WALKBACK.finditer(t):
                    if t[max(0, m.start() - 1):m.start()] in ('"', "“", "'", "`"):
                        continue
                    lo = max(0, m.start() - 60)
                    events.append((ts, "WALK-BACK", short(t[lo:m.end() + 140], 220)))
                    break
            continue
        if e.get("type") != "user":
            continue

        # Tool results: only rejections matter here.
        if isinstance(content, list):
            for x in content:
                if isinstance(x, dict) and x.get("type") == "tool_result" and x.get("is_error"):
                    r = text_of(x.get("content"))
                    if r.startswith(REJECTED):
                        reason = r.split("reason for the rejection:", 1)
                        events.append((ts, "REJECTED", short(reason[1], 300) if len(reason) > 1 else ""))
        t = text_of(content).strip()
        if not t:
            continue
        if t.startswith("[Request interrupted by user"):
            events.append((ts, "INTERRUPT", ""))
            continue
        cmd = slash_command(t)
        if cmd:
            t = cmd
        elif t.startswith(INJECTED):
            continue
        start = start or ts
        end = ts
        if claude_chars and last_reply:
            events.append((ts, "CLAUDE", short(last_reply, claude_chars)))
        events.append((ts, "YOU", short(t, 600)))
        last_reply = ""
    return title, start, end, events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("since", help="YYYY-MM-DD; sessions active on or after this date")
    ap.add_argument("--project", default="", help="only project folders containing this text")
    ap.add_argument("--claude", type=int, default=300,
                    help="characters of the Claude reply before each of your messages (0 hides)")
    a = ap.parse_args()

    sessions = []
    for path in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
        project = os.path.basename(os.path.dirname(path))
        if a.project and a.project.lower() not in project.lower():
            continue
        title, start, end, events = read_session(path, a.claude)
        if start and end >= a.since:
            sessions.append((start, project, title, events))

    totals = {"YOU": 0, "INTERRUPT": 0, "REJECTED": 0, "WALK-BACK": 0}
    for start, project, title, events in sorted(sessions):
        counts = {k: sum(1 for _, kind, _ in events if kind == k) for k in totals}
        for k in totals:
            totals[k] += counts[k]
        name = re.sub(r"^-Users-[^-]+-", "", project)
        print(f"\n=== {start[:16].replace('T', ' ')} · {name}" + (f" · {title}" if title else ""))
        print(f"    {counts['YOU']} messages · {counts['INTERRUPT']} interrupts · "
              f"{counts['REJECTED']} rejected · {counts['WALK-BACK']} walk-backs")
        for ts, kind, body in events:
            label = {"YOU": "you", "CLAUDE": "  claude"}.get(kind, f"[{kind}]")
            print(f"{ts[11:16]} {label}: {body}" if body else f"{ts[11:16]} {label}")

    print(f"\n{len(sessions)} sessions since {a.since}: {totals['YOU']} messages, "
          f"{totals['INTERRUPT']} interrupts, {totals['REJECTED']} rejected tool calls, "
          f"{totals['WALK-BACK']} walk-backs")


if __name__ == "__main__":
    main()
