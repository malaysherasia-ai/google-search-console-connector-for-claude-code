# Lessons

Rules earned from real bugs in this repo. Read before writing code.

Format: `- [scope] Rule — when: trigger (L###)`
Lines marked `[hook]` are also enforced by a script in `.claude/hooks/na/`.

Cap: 40 rules per file (configurable). At the cap, retire or promote one.
Ordered most-hit first by `na sort` — do not reorder by hand.
The reasoning behind any rule lives in `.claude/never-again/archive/L###.md`.

<!-- rules below — managed by the never-again skill, one line each -->
- [tooling] In scripted edits (python/sed), assert each old string matches exactly once and read/write with encoding='utf-8', newline='' — when: changing files without the Edit tool (L001)
- [web][hook] Use fill(el, ...) from common.js, never el.replaceChildren() — when: rendering optional children in web/assets (L002)
