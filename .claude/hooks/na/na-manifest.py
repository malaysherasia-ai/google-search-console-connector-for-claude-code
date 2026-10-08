#!/usr/bin/env python3
"""Verification manifest for verify-shaped hooks. Installed as
.claude/hooks/na/na-manifest.py and driven by na-verify.sh.

A hook of the shape "X must pass before commit" needs to know whether anything
X depends on has changed since X last passed. This records one sha256 per
watched file, written only when X passes, and reports what differs.

    na-manifest.py check  <root> <state.json> <id>
    na-manifest.py commit <root> <state.json> <id>
    na-manifest.py remove <root> <id>

check   reads the lesson's "verify" block from state.json and prints
        RUN=<command> and MODE=<mode> first, then one `reason<TAB>path` line
        per difference.
        exit 0 fresh · 1 stale · 2 no verify block · 3 malformed · 5 internal error
commit  writes the manifest for the current tree (the check just passed).
remove  deletes the manifest (retire).

What counts as watched: files git knows about (tracked, or untracked and not
ignored) with a watched extension, not under .claude/ or a skipped root
prefix, plus any file the command itself names. What counts as changed: a
different sha256. A file whose size and mtime are unchanged AND whose mtime
is comfortably older than the manifest is not re-read; anything modified
near or after the manifest was written is re-hashed, the way git handles a
racily-clean index, so a same-length edit cannot slip through. The manifest
also carries a digest of the command: change the rule and the rule re-runs.
"""
import hashlib
import json
import os
import shlex
import subprocess
import sys

FORMAT = 2
RACY_NS = 2 * 10 ** 9          # re-hash anything modified within 2 s of the manifest
ALWAYS_SKIP = ('.claude',)


class Bad(Exception):
    pass


def load_config(state_path, lid):
    """Return (config, mode). Raises Bad on a malformed block; config is None
    when the lesson has no verify block. Lists may be given as a string."""
    try:
        with open(state_path, encoding='utf-8') as fh:
            state = json.load(fh)
    except Exception as exc:
        raise Bad('cannot read %s (%s)' % (state_path, exc))
    lesson = (state.get('lessons') or {}).get(lid)
    if not isinstance(lesson, dict):
        raise Bad('no lesson %s in state.json' % lid)
    mode = lesson.get('mode', 'warn')
    v = lesson.get('verify')
    if v is None:
        return None, mode
    if not isinstance(v, dict):
        raise Bad('"verify" must be an object')
    run = v.get('run')
    if not isinstance(run, str) or not run.strip():
        raise Bad('"verify.run" must be a non-empty command string')

    def as_list(name):
        x = v.get(name, [])
        if isinstance(x, str):
            x = [p for p in x.replace(',', ' ').split() if p]
        if not isinstance(x, list) or not all(isinstance(p, str) for p in x):
            raise Bad('"verify.%s" must be a list of strings' % name)
        return x
    watch = as_list('watch')
    if not watch:
        raise Bad('"verify.watch" must name at least one extension')
    exts = tuple(e if e.startswith('.') else '.' + e for e in watch)
    skip = tuple(s.strip('/') for s in as_list('skip') if s.strip('/'))
    return {'run': run, 'exts': exts, 'skip': skip}, mode


def run_digest(run):
    return hashlib.sha256(run.encode('utf-8')).hexdigest()[:16]


def candidates(root, cfg):
    """Watched paths from git's point of view: tracked plus untracked-not-
    ignored, filtered by extension and exclusions in git itself."""
    spec = ['--'] + ['*' + e for e in cfg['exts']]
    spec += [':(exclude)%s/' % s for s in ALWAYS_SKIP + cfg['skip']]
    p = subprocess.run(['git', '-C', root, 'ls-files', '-z', '--cached', '--others',
                        '--exclude-standard'] + spec, capture_output=True)
    if p.returncode != 0:
        raise Bad('git ls-files failed: %s' % p.stderr.decode('utf-8', 'replace').strip())
    out = {s.decode('utf-8', 'replace') for s in p.stdout.split(b'\0') if s}
    # The command's own inputs are watched whatever the extension or skip
    # list says: editing the checker must re-run the check.
    try:
        for tok in shlex.split(cfg['run']):
            tok = tok.strip('./')
            if tok and os.path.isfile(os.path.join(root, tok)) and not tok.startswith('.claude/'):
                out.add(tok.replace(os.sep, '/'))
    except ValueError:
        pass
    return sorted(out)


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def manifest_path(root, lid):
    return os.path.join(root, '.claude', 'never-again', 'verified', lid)


def read_manifest(path):
    """(header, rows) or (None, None). rows: {rel: (sha, size, mtime_ns)}."""
    if not os.path.exists(path):
        return None, None
    header, rows = {}, {}
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.rstrip('\n')
            if not line:
                continue
            if line.startswith('#'):
                if '=' in line:
                    k, v = line[1:].strip().split('=', 1)
                    header[k.strip()] = v.strip()
                continue
            parts = line.split('\t')
            if len(parts) != 4:
                raise Bad('manifest line malformed: %r' % line[:60])
            try:
                rows[parts[3]] = (parts[0], int(parts[1]), int(parts[2]))
            except ValueError:
                raise Bad('manifest line malformed: %r' % line[:60])
    return header, rows


def write_manifest(path, cfg, rows, written_ns):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('# never-again manifest: sha256, size, mtime_ns of every watched file when the check last passed.\n')
        fh.write('# Written only on a passing run. Local to this machine. Do not edit by hand.\n')
        fh.write('# format=%d\n# written_ns=%d\n# run=%s\n' % (FORMAT, written_ns, run_digest(cfg['run'])))
        for rel in sorted(rows):
            sha, size, mt = rows[rel]
            fh.write('%s\t%d\t%d\t%s\n' % (sha, size, mt, rel))


def snapshot(root, cfg, prior, prior_written_ns):
    """Current (sha, size, mtime_ns) per watched file on disk. A file absent
    from disk is simply not in the result. Only files whose stat matches the
    prior AND whose mtime is safely older than the prior manifest are trusted
    without re-reading."""
    now, unreadable = {}, []
    for rel in candidates(root, cfg):
        full = os.path.join(root, rel)
        try:
            st = os.stat(full)
        except OSError:
            continue          # deleted from disk (maybe still in the index)
        size, mt = st.st_size, st.st_mtime_ns
        old = prior.get(rel) if prior else None
        if (old and old[1] == size and old[2] == mt
                and prior_written_ns and mt < prior_written_ns - RACY_NS):
            now[rel] = (old[0], size, mt)
            continue
        try:
            now[rel] = (digest(full), size, mt)
        except OSError:
            unreadable.append(rel)
    return now, unreadable


def check(root, state_path, lid):
    cfg, mode = load_config(state_path, lid)
    if cfg is None:
        print('ERROR=no verify block')
        return 2
    print('RUN=%s' % cfg['run'])
    print('MODE=%s' % mode)
    path = manifest_path(root, lid)
    header, before = read_manifest(path)
    written = int(header.get('written_ns', 0)) if header else 0
    now, unreadable = snapshot(root, cfg, before, written)
    if before is None:
        print('never-verified\t(the check has not passed yet)')
        return 1
    if header.get('run') != run_digest(cfg['run']) or header.get('format') != str(FORMAT):
        print('rule-changed\t(the command or manifest format changed since the last pass)')
        return 1
    diffs = [('unreadable', r) for r in unreadable]
    for rel, (sha, _s, _m) in now.items():
        if rel not in before:
            diffs.append(('added', rel))
        elif before[rel][0] != sha:
            diffs.append(('changed', rel))
    for rel in before:
        if rel not in now and rel not in unreadable:
            diffs.append(('deleted', rel))
    for reason, rel in sorted(diffs):
        print('%s\t%s' % (reason, rel))
    return 1 if diffs else 0


def commit(root, state_path, lid):
    cfg, _mode = load_config(state_path, lid)
    if cfg is None:
        print('ERROR=no verify block')
        return 2
    path = manifest_path(root, lid)
    header, prior = read_manifest(path)
    written = int(header.get('written_ns', 0)) if header else 0
    # The command may itself rewrite a watched file (a formatter, a generated
    # asset); the snapshot re-reads anything recent, so that is captured.
    now, unreadable = snapshot(root, cfg, prior, written)
    if unreadable:
        raise Bad('unreadable: %s' % ', '.join(unreadable[:3]))
    import time
    write_manifest(path, cfg, now, time.time_ns())
    print('recorded %d file(s)' % len(now))
    return 0


def remove(root, lid):
    try:
        os.remove(manifest_path(root, lid))
    except OSError:
        pass
    return 0


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(newline='\n', errors='replace')
    argv = sys.argv[1:]
    try:
        if len(argv) == 4 and argv[0] == 'check':
            return check(*argv[1:])
        if len(argv) == 4 and argv[0] == 'commit':
            return commit(*argv[1:])
        if len(argv) == 3 and argv[0] == 'remove':
            return remove(*argv[1:])
    except Bad as exc:
        print('ERROR=%s' % exc)
        return 3
    except Exception as exc:          # never let a traceback masquerade as "stale"
        print('ERROR=internal: %s: %s' % (type(exc).__name__, exc))
        return 5
    sys.stderr.write(__doc__)
    return 4


if __name__ == '__main__':
    sys.exit(main())
