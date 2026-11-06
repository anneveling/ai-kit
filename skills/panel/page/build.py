"""Assemble a /panel run into one HTML page.

usage: python3 -I build.py <run-folder> <out.html> <template.html>

Reads from the run folder: page.json ({"title","question","eyebrow"}), hero.html, gut.html,
optional extra.html, synthesis.md, optional storyteller file (any *.md with "## Scenario N:"
headings), voices.json ([{"name","lens","claim","files":[["label","file.md"],...]}]).
"""
import json, re, sys, pathlib

run, out, tpl_path = map(pathlib.Path, sys.argv[1:4])
read = lambda n: (run / n).read_text() if (run / n).exists() else ""

meta = json.loads(read("page.json") or "{}")

# scenarios: "## Scenario N: name" sections, masthead "### PUBLICATION, date"
scen = []
for f in sorted(run.glob("*.md")):
    for m in re.finditer(r"## Scenario \d+: (.+?)\n(.*?)(?=\n## |\Z)", f.read_text(), re.S):
        name, body = m.group(1).strip(), m.group(2)
        mast = re.search(r"### (.+?), (.+)", body)
        body = re.sub(r"### .+?, .+\n", "", body, count=1).replace("\n---", "")
        body = re.sub(r"(?m)^### ", "#### ", body)
        scen.append({"name": name, "paper": mast.group(1) if mast else "", "date": mast.group(2) if mast else "", "body": body.strip()})

# synthesis: point-first and gut go in hero/gut; the debate gets its own layer
keep, debate = [], ""
for p in re.split(r"(?m)^(?=## )", read("synthesis.md")):
    head = p.split("\n", 1)[0].lower()
    if not head.startswith("## ") or "point first" in head or "gut" in head:
        continue
    if "debate" in head:
        debate = p
    else:
        keep.append(p)

voices = json.loads(read("voices.json") or "[]")
for v in voices:
    v["rounds"] = [{"label": lbl, "text": read(f)} for lbl, f in v.pop("files") if read(f)]

data = {"scenarios": scen, "synthesis": "\n".join(keep), "debate": debate, "voices": voices}
blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
html = tpl_path.read_text()
for k, v in {"DATA": blob, "HERO": read("hero.html"), "GUT": read("gut.html"), "EXTRA": read("extra.html"),
             "TITLE": meta.get("title", "Panel"), "QUESTION": meta.get("question", ""), "EYEBROW": meta.get("eyebrow", "")}.items():
    html = html.replace("{{" + k + "}}", v)
out.write_text(html)
print(out, len(html) // 1024, "KB;", len(scen), "scenarios;", len(voices), "voices; debate", "yes" if debate else "missing")
