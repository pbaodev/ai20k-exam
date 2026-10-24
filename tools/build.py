#!/usr/bin/env python3
"""Build data/days.js and data/exams.js for the exam site.

Sources:
  - ../Phase */md/*.md          : the 10-question quiz at the end of each day summary
  - content/explanations.txt    : explanations for those md quizzes
  - content/days_*.txt          : full quizzes for days whose md has no usable quiz
  - content/exam*.txt           : the comprehensive exams

Content format (one item per line, blank lines and '#' comments ignored):
  @QUIZ DAY1 | @EXAM EXAM1 | @EXPL DAY2   start a block
  @LABEL / @TITLE / @SCOPE / @DESC        exam metadata
  Q: question       + correct option      - wrong option      E: explanation
  ESSAY: question   K: key point          M: model-answer line ("- " = bullet)
  N: text           (inside @EXPL: explanation for md question N)

Options are written with correct ones first; the build shuffles them
deterministically, balancing the correct position for single-answer questions.

Run:  python3 tools/build.py
"""
import json
import random
import re
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLIDES = ROOT.parent
CONTENT = ROOT / "content"
OUT = ROOT / "data"

DAYS = [
    ("DAY1", 1, "AI & LLM Foundation"),
    ("DAY2", 1, "Xác định bài toán kinh doanh cho AI"),
    ("DAY3", 1, "Từ Chatbot đến Agent"),
    ("DAY4", 1, "Prompt Engineering & Tool Calling"),
    ("DAY5", 1, "AI Product Thinking & Requirements"),
    ("DAY5v2", 1, "Quản trị sản phẩm AI"),
    ("DAY6", 1, "AI Product & Project Management"),
    ("DAY7", 1, "Data Foundations"),
    ("DAY8", 1, "RAG Pipeline"),
    ("DAY9", 1, "Multi-Agent, MCP & A2A"),
    ("DAY10", 1, "Data Pipeline & Data Observability"),
    ("DAY11", 1, "Guardrails, HITL & Responsible AI"),
    ("DAY12", 1, "Cloud Infrastructure & Deployment"),
    ("DAY13", 1, "Monitoring, Logging & Observability"),
    ("DAY14", 1, "AI Evaluation"),
    ("DAY17", 2, "Advanced Agent Architectures"),
    ("DAY18", 2, "Memory Systems for Agents"),
    ("DAY19", 2, "Production RAG"),
    ("DAY20", 2, "GraphRAG & Knowledge Graphs"),
    ("DAY21", 2, "Multi-Agent Systems"),
    ("DAY22", 2, "DPO, ORPO & Alignment"),
    ("DAY23", 2, "LangGraph, Deep Agents & Orchestration"),
    ("DAY24", 2, "RAGAS, LLM-as-Judge & Guardrails"),
    ("DAY25", 2, "Circuit Breakers, Caching & Reliability"),
    ("DAY26", 2, "Function Calling & MCP"),
    ("DAY27", 2, "Human-in-the-Loop"),
]


def fail(msg):
    sys.exit("build error: " + msg)


def label_of(day_id):
    m = re.match(r"DAY(\d+)(v\d+)?$", day_id)
    return "DAY " + m.group(1) + (" " + m.group(2) if m.group(2) else "")


# ---------- md quizzes ----------
def find_md_files():
    files = {}
    for folder in SLIDES.glob("Phase */md"):
        for f in folder.glob("*.md"):
            m = re.match(r"(DAY\d+(?:v\d+)?)\s*-", f.name)
            if m:
                files[m.group(1)] = f
    return files


def parse_md_quiz(path):
    text = path.read_text(encoding="utf-8")
    if "## Câu hỏi trắc nghiệm" not in text:
        return None
    body = text.split("## Câu hỏi trắc nghiệm", 1)[1]
    key = dict(re.findall(r"(\d+)-([A-H])", body.split("<details>", 1)[1]))
    qs = []
    for num, qtext, opts in re.findall(r"\*\*(\d+)\.\*\* ([^\n]+)\n(A\. [^\n]+)", body):
        parts = re.split(r"\s{2,}(?=[B-H]\. )", opts.strip())
        options = [re.sub(r"^[A-H]\. ", "", p).strip() for p in parts]
        ans = "ABCDEFGH".index(key[num])
        qs.append({"q": qtext.strip(), "o": options, "a": [ans]})
    return qs


# ---------- content files ----------
def parse_content(path):
    blocks = []
    cur = None
    item = None

    def close_item():
        nonlocal item
        if item is not None:
            cur["items"].append(item)
            item = None

    for ln, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        where = f"{path.name}:{ln}"
        if line.startswith("@"):
            tag, _, val = line.partition(" ")
            val = val.strip()
            if tag in ("@QUIZ", "@EXAM", "@EXPL"):
                close_item()
                cur = {"kind": tag[1:].lower(), "id": val, "items": [], "meta": {}, "expl": {}, "where": where}
                blocks.append(cur)
            elif tag in ("@LABEL", "@TITLE", "@SCOPE", "@DESC", "@KIND"):
                cur["meta"][tag[1:].lower()] = val
            else:
                fail(f"unknown directive {tag} at {where}")
            continue
        if cur is None:
            fail(f"content before any block at {where}")
        if cur["kind"] == "expl":
            m = re.match(r"(\d+):\s*(.+)", line)
            if not m:
                fail(f"bad explanation line at {where}")
            cur["expl"][int(m.group(1))] = m.group(2)
            continue
        if line.startswith("Q:"):
            close_item()
            item = {"type": "mcq", "q": line[2:].strip(), "right": [], "wrong": [], "e": "", "where": where}
        elif line.startswith("ESSAY:"):
            close_item()
            item = {"type": "essay", "q": line[6:].strip(), "k": [], "m": [], "where": where}
        elif item is None:
            fail(f"line outside a question at {where}")
        elif line.startswith("+ ") and item["type"] == "mcq":
            item["right"].append(line[2:].strip())
        elif line.startswith("- ") and item["type"] == "mcq":
            item["wrong"].append(line[2:].strip())
        elif line.startswith("E:") and item["type"] == "mcq":
            item["e"] = line[2:].strip()
        elif line.startswith("K:") and item["type"] == "essay":
            item["k"].append(line[2:].strip())
        elif line.startswith("M:") and item["type"] == "essay":
            item["m"].append(line[2:].strip())
        else:
            fail(f"unexpected line at {where}: {line[:60]}")
    close_item()
    return blocks


def finalize_mcqs(items, seed):
    """Shuffle options; balance the correct slot of single-answer questions."""
    rng = random.Random(seed)
    singles = [it for it in items if it["type"] == "mcq" and len(it["right"]) == 1]
    slots = []
    while len(slots) < len(singles):
        cycle = list(range(4))
        rng.shuffle(cycle)
        slots += cycle
    out = []
    si = 0
    for it in items:
        if it["type"] == "essay":
            if len(it["k"]) < 3 or not it["m"]:
                fail(f"essay needs ≥3 K and an M at {it['where']}")
            out.append({"q": it["q"], "k": it["k"], "m": it["m"]})
            continue
        n_opts = len(it["right"]) + len(it["wrong"])
        if not it["right"] or n_opts < 3 or not it["e"]:
            fail(f"question needs correct option(s), ≥3 options and E at {it['where']}")
        qrng = random.Random(zlib.crc32(it["q"].encode()))
        if len(it["right"]) == 1:
            target = min(slots[si], n_opts - 1)
            si += 1
            others = it["wrong"][:]
            qrng.shuffle(others)
            opts = others[:target] + it["right"] + others[target:]
            ans = [target]
        else:
            tagged = [(o, True) for o in it["right"]] + [(o, False) for o in it["wrong"]]
            qrng.shuffle(tagged)
            opts = [o for o, _ in tagged]
            ans = [i for i, (_, ok) in enumerate(tagged) if ok]
        out.append({"q": it["q"], "o": opts, "a": ans, "e": it["e"]})
    return out


def main():
    md_files = find_md_files()
    blocks = []
    for f in sorted(CONTENT.glob("*.txt")):
        blocks += parse_content(f)

    expl = {b["id"]: b["expl"] for b in blocks if b["kind"] == "expl"}
    quizzes = {b["id"]: b for b in blocks if b["kind"] == "quiz"}
    exams = [b for b in blocks if b["kind"] == "exam"]

    days_out = []
    for day_id, phase, title in DAYS:
        if day_id in quizzes:
            qs = finalize_mcqs(quizzes[day_id]["items"], day_id)
            src = "content"
        elif day_id in expl:
            if day_id not in md_files:
                fail(f"no md file for {day_id}")
            qs = parse_md_quiz(md_files[day_id])
            if not qs:
                fail(f"no quiz found in {md_files[day_id].name}")
            for n, item in enumerate(qs, 1):
                if n not in expl[day_id]:
                    fail(f"missing explanation {day_id} #{n}")
                item["e"] = expl[day_id][n]
            src = "md"
        else:
            fail(f"no questions for {day_id}")
        if len(qs) != 10:
            fail(f"{day_id} has {len(qs)} questions, expected 10")
        days_out.append({"id": day_id, "label": label_of(day_id), "phase": phase, "title": title, "qs": qs})
        print(f"  {day_id:7} {len(qs):3} câu  ({src})")

    exams_out = []
    for b in exams:
        items = finalize_mcqs(b["items"], b["id"])
        mcq = [x for x in items if "k" not in x]
        essays = [x for x in items if "k" in x]
        multi = sum(1 for x in mcq if len(x["a"]) > 1)
        meta = b["meta"]
        kind = meta.get("kind", "exam")
        if kind == "exam" and (len(mcq) != 50 or len(essays) != 10):
            fail(f"{b['id']} has {len(mcq)} MCQ / {len(essays)} essays, expected 50 / 10")
        if kind == "practice" and not (mcq or essays):
            fail(f"{b['id']} is empty")
        exams_out.append({
            "id": b["id"], "kind": kind, "label": meta.get("label", b["id"]), "title": meta.get("title", ""),
            "scope": meta.get("scope", ""), "desc": meta.get("desc", ""), "mcq": mcq, "essays": essays,
        })
        dist = [0] * 5
        for x in mcq:
            if len(x["a"]) == 1:
                dist[x["a"][0]] += 1
        print(f"  {b['id']:7} {len(mcq)} trắc nghiệm ({multi} nhiều đáp án) + {len(essays)} tự luận · vị trí đáp án đơn A-D: {dist[:4]}")

    OUT.mkdir(exist_ok=True)
    header = "/* Generated by tools/build.py — edit content/*.txt or the md files, then rebuild. */\n"
    (OUT / "days.js").write_text(header + "window.DAYS = " + json.dumps(days_out, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
    (OUT / "exams.js").write_text(header + "window.EXAMS = " + json.dumps(exams_out, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
    print(f"wrote {len(days_out)} days, {len(exams_out)} exams → {OUT}")


if __name__ == "__main__":
    main()
