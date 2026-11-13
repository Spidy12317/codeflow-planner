#!/usr/bin/env python3
"""Generate codeflow plan JSON from Python source.

Static only: files are parsed with `ast`; the target code is never imported or run.

  extract_py.py scan     --root R --folders a,b,c --folder F
  extract_py.py generate --root R --folders a,b,c --folder F --entry QUALNAME [--entry ...]
  extract_py.py classes  --root R --folders a,b,c

scan     → entry points in F: route handlers, public methods/functions nobody in F calls.
generate → one flow per entry, in the canvas plan format:
  spine   = entry card, then one card per meaningful call (awaited, or into this repo),
            gather/race cards for asyncio.gather / asyncio.wait, try / loop frames,
            and "logic" cards for runs of plain statements
  details = pseudo-code: internals of same-folder helpers, and the logic runs
  links   = calls into other folders point at that folder's tab
  refs    = repo classes used as the entry's parameter / return types
classes  → modules with their imports, and every class in the folders with kind, members and
           UML relations (inherits / realizes / composes / aggregates / depends), for SOLID checks.
"""
import argparse
import ast
import builtins
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date

SKIP_DIRS = {".git", ".venv", "venv", "env", "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache", "dist", "build"}
BUILTINS = set(dir(builtins))
EXT_BASES = {"llm", "client", "session", "http", "httpx", "requests", "aiohttp", "openai", "blob", "container",
             "cosmos", "redis", "queue", "graph", "s3", "bucket", "conn", "cursor", "engine", "db"}
QUIET_LOG = {"debug", "info", "warning", "warn"}
NOT_ENTRY_DECORATORS = {"validator", "field_validator", "model_validator", "root_validator", "property", "setter", "cached_property"}
MAX_TEXT = 110


def text(node, limit=MAX_TEXT):
    s = re.sub(r"\s+", " ", ast.unparse(node)).strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"


def dotted(expr):
    parts = []
    while isinstance(expr, ast.Attribute):
        parts.append(expr.attr)
        expr = expr.value
    if isinstance(expr, ast.Name):
        parts.append(expr.id)
        return list(reversed(parts))
    return None


def docline(fn):
    doc = ast.get_docstring(fn)
    return doc.strip().splitlines()[0] if doc else None


def body_wo_doc(stmts):
    if stmts and isinstance(stmts[0], ast.Expr) and isinstance(getattr(stmts[0], "value", None), ast.Constant) and isinstance(stmts[0].value.value, str):
        return stmts[1:]
    return stmts


def slug(s):
    return re.sub(r"[^A-Za-z0-9_-]+", "-", s).strip("-")


MATCH_RE = re.compile(r"^(\s*)match\s+(.+?):\s*(#.*)?$")
CASE_RE = re.compile(r"^(\s*)case\s+(.+?):\s*(#.*)?$")


def rewrite_match(source):
    """Rewrite match/case into nested ifs (same indentation) for interpreters before 3.10.

    `match s:` → `if True:` and `case p:` → `if __case__("s", "p"):`; pseudo() renders these
    back as "case p?" conditions.
    """
    out, subjects = [], []
    for line in source.split("\n"):
        m = MATCH_RE.match(line)
        if m:
            indent = len(m.group(1))
            subjects = [s for s in subjects if s[0] < indent] + [(indent, m.group(2))]
            out.append(f"{m.group(1)}if True:")
            continue
        c = CASE_RE.match(line)
        if c and subjects and len(c.group(1)) > subjects[-1][0]:
            out.append(f"{c.group(1)}if __case__({json.dumps(subjects[-1][1])}, {json.dumps(c.group(2))}):")
            continue
        out.append(line)
    return "\n".join(out)


def case_text(test):
    """'case p' label for a rewritten match arm, else None."""
    if isinstance(test, ast.Call) and isinstance(test.func, ast.Name) and test.func.id == "__case__" and len(test.args) == 2:
        subj, pat = (a.value for a in test.args)
        return f"match {subj}: case {pat}"
    return None


# ── repo index ──────────────────────────────────────────────────────────────

def package_of(modname, rel):
    return modname if rel.endswith("__init__.py") else modname.rsplit(".", 1)[0] if "." in modname else ""


def import_base(node, pkg):
    """Absolute module of a `from X import ...`, with relative imports resolved against pkg."""
    base = node.module or ""
    if node.level:
        parts = pkg.split(".") if pkg else []
        parts = parts[: len(parts) - (node.level - 1)] if node.level > 1 else parts
        base = ".".join(p for p in parts + ([node.module] if node.module else []) if p)
    return base


class Func:
    def __init__(self, node, module, rel, cls=None):
        self.node, self.module, self.rel, self.cls = node, module, rel, cls
        self.name = node.name
        self.qual = f"{cls}.{node.name}" if cls else node.name


class ClassRef:
    def __init__(self, node, module, rel):
        self.node, self.module, self.rel, self.name = node, module, rel, node.name


class Repo:
    def __init__(self, root, folders):
        self.root = root
        self.folders = sorted(folders, key=len, reverse=True)
        self.modules = {}
        self.warnings = []
        self.by_name = defaultdict(list)
        self.classes = defaultdict(list)
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for f in filenames:
                if f.endswith(".py"):
                    self._load(os.path.join(dirpath, f))

    def _load(self, path):
        rel = os.path.relpath(path, self.root)
        try:
            with open(path, encoding="utf-8") as fh:
                source = fh.read()
        except UnicodeDecodeError:
            self.warnings.append(f"{rel}: not UTF-8, skipped")
            return
        try:
            tree = ast.parse(source, filename=rel)
        except SyntaxError:
            # Older interpreters can't parse `match`; retry with match/case rewritten as ifs.
            try:
                tree = ast.parse(rewrite_match(source), filename=rel)
            except SyntaxError as e:
                self.warnings.append(f"{rel}:{e.lineno}: syntax this Python ({sys.version.split()[0]}) can't parse, skipped")
                return
        modname = rel[:-3].replace(os.sep, ".")
        if modname.endswith(".__init__"):
            modname = modname[: -len(".__init__")]
        mod = {"rel": rel, "tree": tree, "funcs": {}, "classes": {}, "imports": {}}
        pkg = package_of(modname, rel)
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn = Func(node, modname, rel)
                mod["funcs"][node.name] = fn
                self.by_name[node.name].append(fn)
            elif isinstance(node, ast.ClassDef):
                methods = {}
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        methods[item.name] = Func(item, modname, rel, node.name)
                        self.by_name[item.name].append(methods[item.name])
                mod["classes"][node.name] = (node, methods)
                self.classes[node.name].append((modname, node, methods, rel))
            elif isinstance(node, ast.Import):
                for a in node.names:
                    mod["imports"][a.asname or a.name.split(".")[0]] = ("module", a.name if a.asname else a.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                base = import_base(node, pkg)
                for a in node.names:
                    mod["imports"][a.asname or a.name] = ("from", base, a.name)
        self.modules[modname] = mod

    def folder_of(self, rel):
        d = os.path.dirname(rel).replace(os.sep, "/")
        for f in self.folders:
            if d == f or d.startswith(f + "/"):
                return f
        return d or "."

    def _class(self, name, prefer_module=None):
        hits = self.classes.get(name) or []
        for h in hits:
            if prefer_module and h[0].startswith(prefer_module):
                return h
        return hits[0] if hits else None

    def _unique(self, name):
        hits = self.by_name.get(name) or []
        return hits[0] if len(hits) == 1 else None

    def _from_module(self, modpath, name):
        mod = self.modules.get(modpath)
        if mod:
            if name in mod["funcs"]:
                return mod["funcs"][name]
            if name in mod["classes"]:
                node, _ = mod["classes"][name]
                return ClassRef(node, modpath, mod["rel"])
            imp = mod["imports"].get(name)  # re-export from a package __init__
            if imp and imp[0] == "from":
                return self._from_module(imp[1], imp[2])
        sub = self.modules.get(f"{modpath}.{name}")
        return ("module", f"{modpath}.{name}") if sub else None

    def resolve(self, expr, module, cls):
        """Call target → Func, ClassRef or None."""
        parts = dotted(expr)
        if not parts:
            return None
        mod = self.modules[module]
        if parts[0] in ("self", "cls") and cls and len(parts) == 2:
            entry = mod["classes"].get(cls)
            return entry[1].get(parts[1]) if entry else None
        if len(parts) == 1:
            n = parts[0]
            if n in mod["funcs"]:
                return mod["funcs"][n]
            if n in mod["classes"]:
                return ClassRef(mod["classes"][n][0], module, mod["rel"])
            imp = mod["imports"].get(n)
            if imp and imp[0] == "from":
                r = self._from_module(imp[1], imp[2])
                return r if not isinstance(r, tuple) else None
            return None if n in BUILTINS else self._unique(n)
        last, prev = parts[-1], parts[-2]
        # Class.method (class referenced directly, or through a package: services.QueryDocumentsService.x)
        c = self._class(prev)
        if c and last in c[2]:
            return c[2][last]
        # alias.func / alias.sub.func where alias is an imported module
        imp = mod["imports"].get(parts[0])
        if imp:
            base = imp[1] if imp[0] == "module" else f"{imp[1]}.{imp[2]}"
            path = ".".join([base] + parts[1:-1])
            r = self._from_module(path, last)
            if r and not isinstance(r, tuple):
                return r
        # Constructor through a package: services.LLMService()
        c = self._class(last)
        if c:
            return ClassRef(c[1], c[0], c[3])
        return None


# ── analysis helpers ────────────────────────────────────────────────────────

def call_of(value):
    aw = False
    if isinstance(value, ast.Await):
        aw, value = True, value.value
    return (value, aw) if isinstance(value, ast.Call) else (None, aw)


def stmt_call(stmt):
    """The call a simple statement is built around: x = await f(), f(), return f()."""
    if isinstance(stmt, (ast.Expr, ast.Return)) or isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        if getattr(stmt, "value", None) is not None:
            return call_of(stmt.value)
    return None, False


def targets_of(stmt):
    if isinstance(stmt, ast.Assign):
        return ", ".join(text(t, 60) for t in stmt.targets)
    if isinstance(stmt, (ast.AnnAssign, ast.AugAssign)):
        return text(stmt.target, 60)
    return ""


def is_async_api(call, name):
    parts = dotted(call.func) or []
    return parts[-1:] == [name] and (len(parts) == 1 or parts[-2] == "asyncio")


def is_log(call):
    parts = dotted(call.func) or []
    return len(parts) >= 2 and parts[-2] in ("logger", "logging", "log")


def assigned_names(stmts):
    """Names bound by top-level assignments (not comprehension or loop variables)."""
    names = []
    for s in stmts:
        targets = s.targets if isinstance(s, ast.Assign) else [s.target] if isinstance(s, (ast.AnnAssign, ast.AugAssign)) else []
        for t in targets:
            for n in ast.walk(t):
                if isinstance(n, ast.Name) and n.id not in names:
                    names.append(n.id)
    return names


def uses_names(node, names):
    return any(isinstance(n, ast.Name) and n.id in names for n in ast.walk(node))


class Ctx:
    def __init__(self, repo, func):
        self.repo, self.module, self.cls = repo, func.module, func.cls
        self.folder = repo.folder_of(func.rel)
        self.entry_name = func.qual

    def resolve(self, expr):
        return self.repo.resolve(expr, self.module, self.cls)

    def link_for(self, target):
        if isinstance(target, (Func, ClassRef)):
            f = self.repo.folder_of(target.rel)
            if f != self.folder:
                link = {"tab": f}
                if isinstance(target, Func):
                    link["flow"] = slug(target.qual)
                return link
        return None

    def significant(self, call, aw):
        if aw or is_async_api(call, "gather") or is_async_api(call, "wait"):
            return True
        return isinstance(self.resolve(call.func), (Func, ClassRef))

    def has_significant(self, stmts):
        for s in stmts:
            for n in ast.walk(s):
                if isinstance(n, ast.Await):
                    return True
                if isinstance(n, ast.Call) and self.significant(n, False):
                    return True
        return False


# ── pseudo-code lines (detail panels) ───────────────────────────────────────

def line_for_call(call, aw, stmt_text, ctx):
    target = ctx.resolve(call.func)
    item = {"t": stmt_text}
    parts = dotted(call.func) or []
    if isinstance(target, (Func, ClassRef)):
        item["k"] = "call"
        link = ctx.link_for(target)
        if link:
            item["link"] = link
    elif aw and parts and parts[0].lower() in EXT_BASES:
        item["k"] = "ext"
    elif aw:
        item["k"] = "call"
    else:
        item["k"] = "act"
    if aw:
        item["aw"] = True
    return item


def pseudo(stmts, ctx):
    out = []
    for s in body_wo_doc(stmts):
        if isinstance(s, ast.Pass):
            continue
        if isinstance(s, ast.If) and isinstance(s.test, ast.Constant) and s.test.value is True:
            out.extend(pseudo(s.body, ctx))  # rewritten `match` header
        elif isinstance(s, ast.If):
            label = case_text(s.test) or text(s.test)
            out.append({"k": "cond", "t": label + "?", "yes": pseudo(s.body, ctx), "no": pseudo(s.orelse, ctx)})
        elif isinstance(s, (ast.For, ast.AsyncFor)):
            kw = "async for" if isinstance(s, ast.AsyncFor) else "for"
            out.append({"k": "loop", "t": f"{kw} {text(s.target, 50)} in {text(s.iter, 60)}", "body": pseudo(s.body, ctx)})
        elif isinstance(s, ast.While):
            out.append({"k": "loop", "t": f"while {text(s.test, 80)}", "body": pseudo(s.body, ctx)})
        elif isinstance(s, ast.Try):
            handler, labels = [], []
            for h in s.handlers:
                label = (text(h.type, 60) if h.type else "Exception") + (f" as {h.name}" if h.name else "")
                labels.append(label)
                if len(s.handlers) > 1:
                    handler.append({"k": "act", "t": f"except {label}:"})
                handler.extend(pseudo(h.body, ctx))
            out.append({"k": "try", "body": pseudo(s.body + s.orelse, ctx), "except": " / ".join(labels) or "Exception", "handler": handler})
            if s.finalbody:
                out.append({"k": "act", "t": "finally:"})
                out.extend(pseudo(s.finalbody, ctx))
        elif isinstance(s, (ast.With, ast.AsyncWith)):
            out.append({"k": "act", "t": "with " + ", ".join(text(i, 60) for i in s.items)})
            out.extend(pseudo(s.body, ctx))
        elif isinstance(s, ast.Return):
            out.append({"k": "ret", "t": "return " + text(s.value) if s.value else "return"})
        elif isinstance(s, ast.Raise):
            out.append({"k": "raise", "t": "raise " + text(s.exc) if s.exc else "raise (re-raise)"})
        elif isinstance(s, ast.Continue):
            out.append({"k": "jump", "t": "continue"})
        elif isinstance(s, ast.Break):
            out.append({"k": "jump", "t": "break"})
        elif isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.append({"k": "act", "t": f"def {s.name}(…)" if not isinstance(s, ast.ClassDef) else f"class {s.name}"})
        else:
            call, aw = stmt_call(s)
            if call is not None and is_log(call) and (dotted(call.func) or [""])[-1] in QUIET_LOG:
                continue
            out.append(line_for_call(call, aw, text(s), ctx) if call is not None else {"k": "act", "t": text(s)})
    return out


# ── spine (step cards) ──────────────────────────────────────────────────────

def params_rows(fn, args_call=None):
    a = fn.node.args
    params = [p for p in a.posonlyargs + a.args + a.kwonlyargs if p.arg not in ("self", "cls")]
    if args_call is None:
        return [[p.arg, text(p.annotation, 40) if p.annotation else "", ""] for p in params]
    rows, given = [], {}
    for i, v in enumerate(args_call.args):
        if i < len(params):
            given[params[i].arg] = v
    for kw in args_call.keywords:
        if kw.arg:
            given[kw.arg] = kw.value
    for p in params:
        if p.arg in given:
            rows.append([p.arg, text(p.annotation, 40) if p.annotation else "", text(given[p.arg], 60)])
    return rows


def call_rows(call):
    rows = [[f"#{i + 1}", "", text(v, 70)] for i, v in enumerate(call.args)]
    rows += [[kw.arg or "**", "", text(kw.value, 70)] for kw in call.keywords]
    return rows


class SpineBuilder:
    def __init__(self, ctx, flow_slug):
        self.ctx, self.flow_slug = ctx, flow_slug
        self.k = 0
        self.num = 0

    def nid(self, p="s"):
        self.k += 1
        return f"{self.flow_slug}-{p}{self.k}"

    def card(self, **kw):
        self.num += 1
        c = {"id": self.nid(), "kind": "step", "num": self.num}
        c.update({k: v for k, v in kw.items() if v not in (None, "", [])})
        return c

    def task(self, expr, name=None):
        call, aw = call_of(expr)
        label = f"{name} = {text(expr, 90)}" if name else text(expr, 100)
        if call is None:
            return {"k": "call", "t": label}
        inner = call.args[0] if is_async_api(call, "create_task") and call.args else None
        probe, _ = call_of(inner) if inner is not None else (call, aw)
        if probe is not None and is_async_api(probe, "sleep"):
            return {"k": "timer", "t": label}
        target = self.ctx.resolve((probe or call).func)
        t = {"k": "call", "t": label}
        parts = dotted((probe or call).func) or []
        if not isinstance(target, (Func, ClassRef)) and parts and parts[0].lower() in EXT_BASES:
            t["k"] = "ext"
        link = self.ctx.link_for(target)
        if link:
            t["link"] = link
        return t

    def gather_card(self, call, returns, pending, name, module):
        if is_async_api(call, "wait"):
            first = call.args[0] if call.args else None
            names = [e.id for e in getattr(first, "elts", []) if isinstance(e, ast.Name)]
            tasks = [self.task(pending.pop(n), n) if n in pending else {"k": "call", "t": n} for n in names]
            when = next((kw.value for kw in call.keywords if kw.arg == "return_when"), None)
            when_s = (dotted(when) or ["ALL_COMPLETED"])[-1] if when is not None else "ALL_COMPLETED"
            mode = {"FIRST_COMPLETED": "race", "FIRST_EXCEPTION": "any"}.get(when_s, "gather")
            return self.card(kind="gather", module=module, name=name or "wait for tasks", mode=mode,
                             modeNote=f"asyncio.wait · {when_s}", tasks=tasks, returns=returns)
        tasks, fanout = [], None
        for a in call.args:
            if isinstance(a, ast.Starred) and isinstance(a.value, (ast.ListComp, ast.GeneratorExp)):
                comp = a.value
                tasks.append(self.task(comp.elt))
                fanout = "× N tasks · " + " ".join(f"for {text(g.target, 40)} in {text(g.iter, 50)}" for g in comp.generators)
            else:
                tasks.append(self.task(a))
        return self.card(kind="gather", module=module, name=name or "run concurrently", mode="gather",
                         modeNote="asyncio.gather", fanout=fanout, tasks=tasks, returns=returns)

    def call_card(self, stmt, call, aw, pending):
        ctx = self.ctx
        returns = targets_of(stmt) or ("return value" if isinstance(stmt, ast.Return) else "")
        if is_async_api(call, "gather") or is_async_api(call, "wait"):
            return self.gather_card(call, returns, pending, None, ctx.entry_name)
        target = ctx.resolve(call.func)
        parts = dotted(call.func) or [text(call.func, 40)]
        badges = ["await"] if aw else []
        if isinstance(target, Func):
            module = target.cls or target.module
            name = f"{target.name}()"
            ret_ann = text(target.node.returns, 50) if target.node.returns else ""
            returns = " : ".join(x for x in (returns, ret_ann) if x)
            link = ctx.link_for(target)
            inputs = params_rows(target, call)
            if link:
                return self.card(module=module, name=name, desc=docline(target.node), badges=badges, link=link, inputs=inputs, returns=returns)
            # Same-folder helper: show its internals. A helper built around gather/wait becomes a gather card.
            body = body_wo_doc(target.node.body)
            for i, s in enumerate(body):
                c2, _ = stmt_call(s)
                if c2 is not None and (is_async_api(c2, "gather") or is_async_api(c2, "wait")):
                    g = self.gather_card(c2, returns, {}, name, module)
                    g["inputs"] = inputs
                    rest = body[:i] + body[i + 1:]
                    if rest:
                        g["details"] = [{"side": "right", "title": target.qual, "items": pseudo(rest, ctx)}]
                    return g
            return self.card(module=module, name=name, desc=docline(target.node), badges=badges, inputs=inputs, returns=returns,
                             details=[{"side": "right", "title": target.qual, "items": pseudo(body, ctx)}] if body else None)
        if isinstance(target, ClassRef):
            return self.card(module=target.module, name=f"{target.name}()", desc="create instance", badges=badges,
                             link=ctx.link_for(target), inputs=call_rows(call), returns=returns)
        kind_ext = aw and parts and parts[0].lower() in EXT_BASES
        return self.card(module=".".join(parts[:-1]) or ctx.entry_name, name=f"{parts[-1]}()",
                         desc="external call" if kind_ext else None, badges=badges, inputs=call_rows(call), returns=returns)

    def logic_card(self, buf, first, last):
        has = lambda t: any(isinstance(n, t) for s in buf for n in ast.walk(s))
        names = [n for n in assigned_names(buf) if not n.startswith("_")]
        if has(ast.Raise) and first:
            name = "validate input"
        elif has(ast.Return) and last:
            name = "respond"
        elif has(ast.Raise):
            name = "checks"
        elif has(ast.Return):
            name = "early return"
        else:
            name = "compute " + ", ".join(names[:3]) if names else "logic"
        return self.card(module=self.ctx.entry_name, name=name, returns=", ".join(names[:4]) if names and not last else "",
                         details=[{"side": "right", "title": name, "items": pseudo(buf, self.ctx)}])

    def build(self, stmts, top=False):
        ctx, out, buf, pending = self.ctx, [], [], {}

        def flush(last=False):
            # Skip runs that render to nothing (e.g. only info/debug logging).
            if buf and pseudo(buf, ctx):
                out.append(self.logic_card(list(buf), first=not out, last=last))
            buf.clear()

        for s in body_wo_doc(stmts):
            if isinstance(s, ast.If) and isinstance(s.test, ast.Constant) and s.test.value is True:
                buf.append(s)  # rewritten `match`: pseudo() flattens it into its case conditions
                continue
            call, aw = stmt_call(s)
            # x = asyncio.create_task(...): held until an asyncio.wait/gather consumes it
            if call is not None and (is_async_api(call, "create_task") or is_async_api(call, "ensure_future")) and not aw:
                if isinstance(s, ast.Assign) and len(s.targets) == 1 and isinstance(s.targets[0], ast.Name):
                    pending[s.targets[0].id] = s.value
                    continue
                flush()
                out.append(self.card(module=ctx.entry_name, name=text(call, 60), badges=["background"], desc="fire and forget"))
                continue
            if isinstance(s, ast.Try) and ctx.has_significant(s.body):
                flush()
                labels, items = [], []
                for h in s.handlers:
                    label = (text(h.type, 60) if h.type else "Exception") + (f" as {h.name}" if h.name else "")
                    labels.append(label)
                    if len(s.handlers) > 1:
                        items.append({"k": "act", "t": f"except {label}:"})
                    items.extend(pseudo(h.body, ctx))
                label = " / ".join(labels) or "Exception"
                out.append({"id": self.nid("w"), "kind": "try", "header": "", "body": self.build(s.body + s.orelse),
                            "except": {"label": label, "title": f"except {label}", "items": items + (pseudo(s.finalbody, ctx) if s.finalbody else [])}})
                continue
            if isinstance(s, (ast.For, ast.AsyncFor, ast.While)) and ctx.has_significant(s.body):
                flush()
                header = f"while {text(s.test, 70)}" if isinstance(s, ast.While) else f"for {text(s.target, 40)} in {text(s.iter, 60)}"
                out.append({"id": self.nid("w"), "kind": "loop", "header": header, "body": self.build(s.body)})
                continue
            if isinstance(s, (ast.With, ast.AsyncWith)) and ctx.has_significant(s.body):
                flush()
                out.extend(self.build(s.body))
                continue
            if isinstance(s, ast.If) and not buf and out and out[-1].get("kind") in ("step", "gather"):
                prev = out[-1]
                produced = [x.strip() for x in prev.get("returns", "").split(":")[0].split(",") if x.strip()]
                sides = {d["side"] for d in prev.get("details", [])}
                if produced and uses_names(s.test, produced) and "left" not in sides:
                    prev.setdefault("details", []).append({"side": "left", "title": f"if {text(s.test, 60)}", "items": pseudo([s], ctx)})
                    continue
            if call is not None and ctx.significant(call, aw) and not is_log(call):
                flush()
                out.append(self.call_card(s, call, aw, pending))
                continue
            buf.append(s)
        flush(last=top)
        for name, expr in pending.items():  # created but never awaited
            out.append(self.card(module=ctx.entry_name, name=f"{name} = {text(expr, 60)}", badges=["background"], desc="fire and forget"))
        return out


# ── entries ─────────────────────────────────────────────────────────────────

def route_info(fn):
    for d in fn.node.decorator_list:
        if isinstance(d, ast.Call) and (dotted(d.func) or [""])[-1] == "route":
            kw = {k.arg: k.value for k in d.keywords if k.arg}
            route = kw.get("route") or (d.args[0] if d.args else None)
            methods = kw.get("methods")
            r = route.value if isinstance(route, ast.Constant) else (text(route) if route is not None else "")
            m = [e.value for e in getattr(methods, "elts", []) if isinstance(e, ast.Constant)] if methods is not None else []
            return f"{'/'.join(m) or 'ANY'} /{r}"
    return None


def folder_funcs(repo, folder):
    for mod in repo.modules.values():
        if repo.folder_of(mod["rel"]) != folder or mod["rel"].endswith("__init__.py"):
            continue
        for fn in mod["funcs"].values():
            yield fn
        for _, methods in mod["classes"].values():
            for fn in methods.values():
                yield fn


def keyed_funcs(repo, folder):
    """key → Func. Key is the qualname, or "file::qualname" when a name repeats in the folder."""
    funcs = list(folder_funcs(repo, folder))
    counts = defaultdict(int)
    for fn in funcs:
        counts[fn.qual] += 1
    return {(fn.qual if counts[fn.qual] == 1 else f"{fn.rel}::{fn.qual}"): fn for fn in funcs}


def scan(repo, folder):
    keyed = keyed_funcs(repo, folder)
    funcs = list(keyed.values())
    called = set()
    for fn in funcs:
        for n in ast.walk(fn.node):
            if isinstance(n, ast.Call):
                t = repo.resolve(n.func, fn.module, fn.cls)
                if isinstance(t, Func):
                    called.add((t.rel, t.qual))
    entries = []
    for key, fn in keyed.items():
        route = route_info(fn)
        decos = {(dotted(d.func if isinstance(d, ast.Call) else d) or [""])[-1] for d in fn.node.decorator_list}
        public = not fn.name.startswith("_") and not (decos & NOT_ENTRY_DECORATORS)
        if route or (public and (fn.rel, fn.qual) not in called):
            entries.append({
                "qualname": key,
                "id": slug(key),
                "title": f"{route} · {fn.name}" if route else fn.qual,
                "kind": "route" if route else "method" if fn.cls else "function",
                "file": fn.rel,
                "line": fn.node.lineno,
                "doc": docline(fn.node),
            })
    entries.sort(key=lambda e: (e["kind"] != "route", e["file"], e["line"]))
    return entries


def ref_tables(repo, fn):
    tables, seen = [], set()
    anns = [p.annotation for p in fn.node.args.args if p.annotation is not None] + ([fn.node.returns] if fn.node.returns else [])
    for ann in anns:
        for n in ast.walk(ann):
            name = n.attr if isinstance(n, ast.Attribute) else n.id if isinstance(n, ast.Name) else None
            c = repo._class(name) if name else None
            if not c or name in seen:
                continue
            seen.add(name)
            rows = []
            for item in c[1].body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    rows.append([item.target.id, text(item.annotation, 40), f"default {text(item.value, 40)}" if item.value is not None else ""])
            if rows:
                tables.append({"id": slug(f"{fn.qual}-{name}"), "title": name, "subtitle": os.path.dirname(c[3]), "rows": rows})
    return tables


def generate(repo, folder, qualnames):
    flows = []
    funcs = keyed_funcs(repo, folder)
    for q in qualnames:
        fn = funcs.get(q)
        if not fn:
            raise SystemExit(f"No function {q} in {folder}")
        ctx = Ctx(repo, fn)
        fslug = slug(q)
        b = SpineBuilder(ctx, fslug)
        route = route_info(fn)
        decorators = [{"k": "act", "t": "@" + text(d)} for d in fn.node.decorator_list]
        entry = {
            "id": f"{fslug}-entry",
            "kind": "step",
            "module": fn.module + (f".{fn.cls}" if fn.cls else ""),
            "name": f"{fn.name}()",
            "desc": docline(fn.node) or ("HTTP entry" if route else None),
            "inputs": params_rows(fn),
            "returns": text(fn.node.returns, 60) if fn.node.returns else None,
            "details": [{"side": "left", "title": "decorators (outermost first)", "items": decorators}] if decorators else None,
        }
        entry = {k: v for k, v in entry.items() if v not in (None, "", [])}
        flows.append({
            "id": fslug,
            "title": f"{route} · {fn.name}" if route else fn.qual,
            "entry": f"{fn.rel}:{fn.node.lineno}",
            "generated": {"source": f"{fn.rel}:{fn.node.lineno}", "on": date.today().isoformat()},
            "spine": [entry] + b.build(fn.node.body, top=True),
            "refs": ref_tables(repo, fn),
            "notes": [],
        })
    return flows


# ── classes (UML + SOLID facts) ─────────────────────────────────────────────

TYPING_NAMES = {"Optional", "Union", "List", "Dict", "Set", "FrozenSet", "Tuple", "Type", "Any", "Callable", "Sequence",
                "MutableSequence", "Iterable", "Iterator", "Mapping", "MutableMapping", "Collection", "Awaitable", "Coroutine",
                "AsyncIterator", "AsyncIterable", "AsyncGenerator", "Generator", "Literal", "Annotated", "ClassVar", "Final",
                "Generic", "TypeVar", "Protocol", "Self", "NoReturn", "Never", "Deque", "DefaultDict", "OrderedDict", "Counter",
                "AbstractSet", "Hashable", "Sized", "TypeAlias", "TypeGuard", "ParamSpec", "Concatenate", "NamedTuple", "TypedDict"}
VALUE_TYPES = {"datetime", "date", "time", "timedelta", "timezone", "Decimal", "UUID", "Path", "PurePath", "Pattern", "Match"}
ABC_BASES = {"ABC", "Protocol"}
ENUM_BASES = {"Enum", "IntEnum", "StrEnum", "Flag", "IntFlag"}
MODEL_BASES = {"BaseModel", "SQLModel", "DeclarativeBase", "DeclarativeBaseNoMeta", "Base"}
MARKER_BASES = {"Generic", "NamedTuple", "TypedDict"} | ABC_BASES | ENUM_BASES | MODEL_BASES
FIELD_CALLS = {"Column", "mapped_column", "relationship", "Field", "field"}
STRONG = ("inherits", "realizes", "composes", "aggregates")


def visibility(name):
    if name.startswith("__") and name.endswith("__"):
        return "public"
    return "private" if name.startswith("__") else "protected" if name.startswith("_") else "public"


def last(expr):
    return (dotted(expr) or [""])[-1]


def deco_names(node):
    return [".".join(dotted(d.func if isinstance(d, ast.Call) else d) or [text(d, 60)]) for d in node.decorator_list]


def is_abstract(fn):
    return any(d.split(".")[-1].startswith("abstract") for d in deco_names(fn))


def is_ni(exc):
    return exc is not None and last(exc.func if isinstance(exc, ast.Call) else exc) == "NotImplementedError"


def is_stub(fn):
    for s in body_wo_doc(fn.body):
        if isinstance(s, ast.Pass) or (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) and s.value.value is Ellipsis):
            continue
        if isinstance(s, ast.Raise) and is_ni(s.exc):
            continue
        return False
    return True


def parse_ann(node):
    """String annotation → expression, else the node itself."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        try:
            return ast.parse(node.value, mode="eval").body
        except SyntaxError:
            return None
    return node


def ann_types(ann, skip=()):
    """Class-like names in an annotation (Name/Attribute nodes): Optional[X], list[X], X | None → X."""
    out = []

    def visit(n):
        n = parse_ann(n)
        if isinstance(n, ast.BinOp) and isinstance(n.op, ast.BitOr):
            visit(n.left)
            visit(n.right)
        elif isinstance(n, ast.Subscript):
            base = last(n.value)
            sl = n.slice.value if isinstance(n.slice, getattr(ast, "Index", ())) else n.slice
            if base == "Literal":
                return
            args = sl.elts if isinstance(sl, ast.Tuple) else [sl]
            visit(n.value)
            for a in args[:1] if base == "Annotated" else args:
                visit(a)
        elif isinstance(n, (ast.Tuple, ast.List)):  # Callable[[A, B], R]
            for e in n.elts:
                visit(e)
        elif isinstance(n, (ast.Name, ast.Attribute)):
            parts = dotted(n)
            if parts and not ({parts[-1]} & (TYPING_NAMES | VALUE_TYPES | BUILTINS | set(skip))) and parts[0] != "typing":
                out.append(n)

    visit(ann)
    return out


def isinstance_checks(fn):
    out = []
    for n in ast.walk(fn):
        types = None
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "isinstance" and len(n.args) == 2:
            types = n.args[1]
        elif (isinstance(n, ast.Compare) and isinstance(n.left, ast.Call) and isinstance(n.left.func, ast.Name)
              and n.left.func.id == "type" and isinstance(n.ops[0], (ast.Is, ast.Eq, ast.In))):
            types = n.comparators[0]
        if types is not None:
            elts = types.elts if isinstance(types, (ast.Tuple, ast.List, ast.Set)) else [types]
            out.append({"line": n.lineno, "types": [text(e, 60) for e in elts]})
    return out


def self_targets(stmt, me):
    """Names x of every `me.x` an assignment binds (unpacking tuples; not `me.x[k] = ...`)."""
    todo = list(stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target])
    while todo:
        t = todo.pop(0)
        if isinstance(t, (ast.Tuple, ast.List)):
            todo += t.elts
        elif isinstance(t, ast.Starred):
            todo.append(t.value)
        elif isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == me:
            yield t.attr


def all_params(fn):
    a = fn.args
    ps = [(p.arg, p.annotation) for p in a.posonlyargs + a.args]
    ps += [("*" + a.vararg.arg, a.vararg.annotation)] if a.vararg else []
    ps += [(p.arg, p.annotation) for p in a.kwonlyargs]
    ps += [("**" + a.kwarg.arg, a.kwarg.annotation)] if a.kwarg else []
    return ps


class ClassInfo:
    def __init__(self, node, module, rel, qual):
        self.node, self.module, self.rel, self.qual = node, module, rel, qual
        self.id = f"{module}.{qual}"
        self.methods = [m for m in node.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]


class ClassIndex:
    def __init__(self, repo, infos):
        self.repo = repo
        self.by_id = {ci.id: ci for ci in infos}
        self.by_name = defaultdict(list)
        for ci in infos:
            self.by_name[ci.node.name].append(ci.id)
        self.kinds = {}
        self.typevars = {}

    def in_repo(self, modpath):
        return modpath in self.repo.modules or os.path.isdir(os.path.join(self.repo.root, *modpath.split(".")))

    def module_folder(self, modpath):
        mod = self.repo.modules.get(modpath)
        if mod:
            rel = mod["rel"]
        elif self.in_repo(modpath):
            rel = os.path.join(*modpath.split("."), "__init__.py")
        else:
            return None
        f = self.repo.folder_of(rel)
        return f if not self.repo.folders or f in self.repo.folders else None

    def skip_names(self, module):
        """TypeVar names declared at module level: not classes."""
        if module not in self.typevars:
            tv = set()
            for s in self.repo.modules[module]["tree"].body:
                if isinstance(s, ast.Assign) and isinstance(s.value, ast.Call) and last(s.value.func) in ("TypeVar", "ParamSpec", "NewType"):
                    tv |= {t.id for t in s.targets if isinstance(t, ast.Name)}
            self.typevars[module] = tv
        return self.typevars[module]

    def exported(self, modpath, name, depth=0):
        """Class id `name` refers to in modpath, following re-exports and `import *`."""
        cid = f"{modpath}.{name}"
        mod = self.repo.modules.get(modpath)
        if cid in self.by_id or not mod or depth > 6:
            return cid if cid in self.by_id else None
        imp = mod["imports"].get(name)
        if imp and imp[0] == "from":
            return self.exported(imp[1], imp[2], depth + 1)
        pkg = package_of(modpath, mod["rel"])
        for s in mod["tree"].body:
            if isinstance(s, ast.ImportFrom) and any(a.name == "*" for a in s.names):
                hit = self.exported(import_base(s, pkg), name, depth + 1)
                if hit:
                    return hit
        return None

    def class_id(self, expr, module):
        """Expression naming a class → class id in this index, or None."""
        expr = parse_ann(expr)
        if isinstance(expr, ast.Subscript):
            expr = expr.value
        parts = dotted(expr) if expr is not None else None
        if not parts:
            return None
        local = f"{module}.{'.'.join(parts)}"
        if local in self.by_id:
            return local
        imp = self.repo.modules[module]["imports"].get(parts[0])
        if imp and not self.in_repo(imp[1]):
            return None  # imported from outside the repo
        if imp and imp[0] == "from":
            cid = self.exported(imp[1], imp[2])
            cid = ".".join([cid] + parts[1:]) if cid else None
            if cid in self.by_id:
                return cid
        t = self.repo.resolve(expr, module, None)
        if isinstance(t, ClassRef):
            cid = f"{t.module}.{t.name}"
            return cid if cid in self.by_id else None
        if imp:
            return None
        same = [i for i in self.by_name.get(parts[-1], []) if self.by_id[i].module == module]
        if len(same) == 1:
            return same[0]
        hits = self.by_name.get(parts[-1], [])
        return hits[0] if len(parts) == 1 and len(hits) == 1 else None

    def class_expr(self, call, module):
        """Class a call constructs or calls a static method on: (expr, how) or (None, None)."""
        parts = dotted(call.func)
        if not parts or parts[0] in ("self", "cls", "super"):
            return None, None
        t = self.repo.resolve(call.func, module, None)
        if isinstance(t, ClassRef):
            return call.func, "new"
        if isinstance(t, Func) and t.cls and len(parts) >= 2 and parts[-2] == t.cls:
            return call.func.value, "static"
        imported = parts[0] in self.repo.modules[module]["imports"] or parts[-1] in self.by_name or (len(parts) > 1 and parts[-2] in self.by_name)
        looks = lambda n: n[:1].isupper() and not n.isupper() and n not in BUILTINS and n not in VALUE_TYPES and n not in TYPING_NAMES
        if imported and looks(parts[-1]):
            return call.func, "new"
        if imported and len(parts) >= 2 and looks(parts[-2]):
            return call.func.value, "static"
        return None, None

    def kind(self, ci):
        if ci.id in self.kinds:
            return self.kinds[ci.id]
        self.kinds[ci.id] = "class"  # cycle guard
        names = {last(b.value if isinstance(b, ast.Subscript) else b) for b in ci.node.bases}
        base_kinds = set()
        resolved = set()
        for b in ci.node.bases:
            bid = self.class_id(b, ci.module)
            if bid and bid != ci.id:
                base_kinds.add(self.kind(self.by_id[bid]))
                resolved.add(last(b.value if isinstance(b, ast.Subscript) else b))
        meta = any(k.arg == "metaclass" and last(k.value) == "ABCMeta" for k in ci.node.keywords)
        abc = names & ABC_BASES or meta or (any(is_abstract(m) for m in ci.methods) and base_kinds & {"interface", "abstract"})
        decos = {d.split(".")[-1] for d in deco_names(ci.node)}
        model = (names - resolved) & MODEL_BASES or any(len(dotted(b) or []) > 1 and last(b) == "Model" for b in ci.node.bases)
        if abc:
            k = "interface" if all(is_abstract(m) or is_stub(m) for m in ci.methods) else "abstract"
        elif "dataclass" in decos:
            k = "dataclass"
        elif names & ENUM_BASES or "enum" in base_kinds:
            k = "enum"
        elif model or "model" in base_kinds:
            k = "model"
        else:
            k = "class"
        self.kinds[ci.id] = k
        return k

    def describe(self, ci):
        repo, module, node = self.repo, ci.module, ci.node
        kind = self.kind(ci)
        skip = self.skip_names(module)
        rels, attrs = [], {}

        def rel(kind, expr, via):
            tid = self.class_id(expr, module)
            if tid != ci.id:
                rels.append({"kind": kind, "target": tid, "targetName": last(parse_ann(expr)), "via": via})

        def attr(name, ann, static):
            a = attrs.setdefault(name, {"name": name, "type": None, "visibility": visibility(name), "static": static})
            if a["type"] is None and ann is not None:
                a["type"] = text(ann, 60)

        bases = []
        for b in node.bases:
            bexpr = b.value if isinstance(b, ast.Subscript) else b
            bid = self.class_id(bexpr, module)
            bases.append({"name": text(b, 80), "id": bid})
            if bid == ci.id or (bid is None and (last(bexpr) in MARKER_BASES or last(bexpr) in BUILTINS)):
                continue
            k = "realizes" if bid and self.kind(self.by_id[bid]) in ("interface", "abstract") else "inherits"
            rel(k, bexpr, "base class")

        for s in node.body:  # class-level attributes
            if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name):
                ann = parse_ann(s.annotation)
                attr(s.target.id, s.annotation, last(ann.value if isinstance(ann, ast.Subscript) else ann) == "ClassVar" if ann is not None else False)
                if kind != "enum":
                    for t in ann_types(s.annotation, skip):
                        rel("aggregates", t, f"{s.target.id}: {text(s.annotation, 60)}")
            elif isinstance(s, ast.Assign):
                field = isinstance(s.value, ast.Call) and last(s.value.func) in FIELD_CALLS
                for t in s.targets:
                    if isinstance(t, ast.Name) and not (t.id.startswith("__") and t.id.endswith("__")):
                        attr(t.id, None, not field)

        methods, checks = [], []
        for fn in ci.methods:
            decos = deco_names(fn)
            short = {d.split(".")[-1] for d in decos}
            static, classm = "staticmethod" in short, "classmethod" in short
            params = all_params(fn)
            me = params[0][0] if params and not static else None
            if me:
                params = params[1:]
            ptypes = {p: a for p, a in params if a is not None}
            consumed = set()
            for s in ast.walk(fn):
                if not isinstance(s, (ast.Assign, ast.AnnAssign, ast.AugAssign)) or not me:
                    continue
                for x in self_targets(s, me):
                    value = s.value if not isinstance(s, ast.AugAssign) else None
                    ann = s.annotation if isinstance(s, ast.AnnAssign) else None
                    if ann is None and isinstance(value, ast.Name) and value.id in ptypes:
                        ann = ptypes[value.id]
                    attr(x, ann, False)
                    if isinstance(s, ast.AugAssign) or value is None:
                        continue
                    parts = [value]
                    while parts and isinstance(parts[0], (ast.BoolOp, ast.IfExp, ast.Await)):
                        v = parts.pop(0)
                        parts += v.values if isinstance(v, ast.BoolOp) else [v.body, v.orelse] if isinstance(v, ast.IfExp) else [v.value]
                    composed = False
                    for v in parts:
                        if isinstance(v, ast.Call):
                            cexpr, how = self.class_expr(v, module)
                            if how == "new":
                                consumed.add(id(v))
                                composed = True
                                rel("composes", cexpr, f"self.{x} = {last(cexpr)}() in {fn.name}")
                        elif isinstance(v, ast.Name) and v.id in ptypes:
                            for t in ann_types(ptypes[v.id], skip):
                                rel("aggregates", t, f"self.{x} (param of {fn.name})")
                    if isinstance(s, ast.AnnAssign) and not composed:
                        for t in ann_types(s.annotation, skip):
                            rel("aggregates", t, f"self.{x}: {text(s.annotation, 60)}")
            for p, a in params:
                for t in ann_types(a, skip) if a is not None else []:
                    rel("depends", t, f"param {p.lstrip('*')} of {fn.name}")
            for t in ann_types(fn.returns, skip) if fn.returns is not None else []:
                rel("depends", t, f"return of {fn.name}")
            for n in ast.walk(fn):
                if isinstance(n, ast.Call) and id(n) not in consumed:
                    cexpr, how = self.class_expr(n, module)
                    if cexpr is not None:
                        rel("depends", cexpr, f"{text(n.func, 60)}() in {fn.name}")
            uses = []
            for n in ast.walk(fn):
                if me and isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == me and n.attr not in uses:
                    uses.append(n.attr)
            checks += isinstance_checks(fn)
            methods.append({
                "name": fn.name, "line": fn.lineno,
                "params": [{"name": p, "type": text(a, 60) if a is not None else None} for p, a in params],
                "returns": text(fn.returns, 60) if fn.returns is not None else None,
                "visibility": visibility(fn.name), "abstract": is_abstract(fn), "static": static, "classmethod": classm,
                "property": bool(short & {"property", "cached_property", "setter", "getter", "deleter"}),
                "stub": is_stub(fn), "raisesNotImplemented": any(isinstance(r, ast.Raise) and is_ni(r.exc) for r in ast.walk(fn)),
                "uses": uses,
            })

        return {
            "id": ci.id, "name": node.name, "module": module, "file": ci.rel, "line": node.lineno,
            "folder": repo.folder_of(ci.rel), "kind": kind, "bases": bases, "decorators": deco_names(node),
            "attributes": list(attrs.values()), "methods": methods, "isinstanceChecks": checks,
            "relations": dedupe_relations(rels),
        }


def dedupe_relations(rels):
    """One per (kind, target), first `via` wins; `depends` dropped when a stronger relation covers the target."""
    key = lambda r: r["target"] or r["targetName"]
    strong = {key(r) for r in rels if r["kind"] in STRONG}
    out, seen = [], set()
    for r in rels:
        k = (r["kind"], key(r))
        if k in seen or (r["kind"] == "depends" and key(r) in strong):
            continue
        seen.add(k)
        out.append(r)
    return out


def nested_classes(body, prefix=""):
    for node in body:
        if isinstance(node, ast.ClassDef):
            yield node, prefix + node.name
            yield from nested_classes(node.body, f"{prefix}{node.name}.")


def module_imports(ix, modname, mod):
    pkg, out = package_of(modname, mod["rel"]), []
    for n in ast.walk(mod["tree"]):
        if isinstance(n, ast.Import):
            out += [{"module": a.name, "folder": ix.module_folder(a.name), "line": n.lineno, "names": []} for a in n.names]
        elif isinstance(n, ast.ImportFrom):
            base = import_base(n, pkg)
            out.append({"module": base, "folder": ix.module_folder(base) if base else None, "line": n.lineno,
                        "names": [a.name for a in n.names]})
    return sorted(out, key=lambda i: i["line"])


def classes(repo):
    """Classes, members and relations of every module in the plan folders (all modules when none are given)."""
    plan = set(repo.folders)
    mods = [(name, m) for name, m in sorted(repo.modules.items()) if not plan or repo.folder_of(m["rel"]) in plan]
    infos = [ClassInfo(node, name, m["rel"], qual) for name, m in mods for node, qual in nested_classes(m["tree"].body)]
    ix = ClassIndex(repo, infos)
    out_mods = [{"module": name, "file": m["rel"], "folder": repo.folder_of(m["rel"]), "imports": module_imports(ix, name, m)}
                for name, m in mods]
    out_classes = []
    for ci in infos:
        try:
            out_classes.append(ix.describe(ci))
        except Exception as e:  # never let one odd class sink the run
            repo.warnings.append(f"{ci.rel}:{ci.node.lineno}: class {ci.qual} skipped ({type(e).__name__}: {e})")
    return {"modules": out_mods, "classes": out_classes, "warnings": repo.warnings}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["scan", "generate", "classes"])
    ap.add_argument("--root", required=True)
    ap.add_argument("--folders", default="")
    ap.add_argument("--folder")
    ap.add_argument("--entry", action="append", default=[])
    a = ap.parse_args()
    if a.cmd != "classes" and not a.folder:
        ap.error("--folder is required for scan and generate")
    repo = Repo(os.path.abspath(a.root), [f for f in a.folders.split(",") if f])
    if a.cmd == "classes":
        result = classes(repo)
    elif a.cmd == "scan":
        result = {"entries": scan(repo, a.folder), "warnings": repo.warnings}
    else:
        result = {"flows": generate(repo, a.folder, a.entry), "warnings": repo.warnings}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
