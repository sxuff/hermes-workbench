"""Scripted, OpenAI-compatible model server for the Workbench demo visuals.

Hermes runs its real agent loop against this server: the scripted tool calls
(todo_list, terminal, search_files, read_file, patch) execute for real inside
demo/project, so transcripts, diffs and test output in the screenshots are
genuine. Only the model's words are scripted.

Usage: python demo/mock_model.py [port]   (default 18990). Standard library only.
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "local-model"
TOKEN_DELAY_S = 0.012

BUG_OLD_LINE = """export function lineTotal(item) {
  return item.price * item.quantity;
}"""
BUG_NEW_LINE = """// Work in integer cents: binary floats can't represent most prices exactly.
const toCents = (amount) => Math.round(amount * 100);

export function lineTotal(item) {
  return (toCents(item.price) * item.quantity) / 100;
}"""
BUG_OLD_TOTAL = """  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const tax = subtotal * taxRate;
  return Math.round((subtotal + tax) * 100) / 100;"""
BUG_NEW_TOTAL = """  const subtotalCents = items.reduce((sum, item) => sum + toCents(item.price) * item.quantity, 0);
  const taxCents = Math.round(subtotalCents * taxRate);
  return (subtotalCents + taxCents) / 100;"""


def todos(done: int) -> list[dict]:
    items = ["Reproduce the off-by-a-cent total", "Find where cart totals are computed",
             "Fix the rounding", "Run the test suite"]
    return [{"id": str(i + 1), "content": text,
             "status": "completed" if i < done else ("in_progress" if i == done else "pending")}
            for i, text in enumerate(items)]


# Each step: (reasoning, text before the tool call, tool name, tool arguments) or a final answer.
CART_STEPS = [
    ("The user reports checkout totals off by a cent on some carts. Classic floating point rounding. "
     "Reproduce with the test suite first, then trace the total calculation.",
     "I'll reproduce it first, then trace where the total is computed.",
     "todo_list", {"todos": todos(0)}),
    (None, None, "terminal", {"command": "npm test"}),
    ("The half-cent tax case fails: 17.54 instead of 17.55. Find the pricing code.",
     "Reproduced: the half-cent tax case comes out at $17.54 instead of $17.55.",
     "search_files", {"pattern": "cartTotal", "target": "content", "path": "src"}),
    (None, None, "read_file", {"path": "src/cart.js"}),
    ("1.15 * 3 is 3.4499999999999997 in binary floating point, so the rounded total loses the half cent. "
     "Do the arithmetic in integer cents instead.",
     "Found it: `1.15 * 3` is `3.4499999999999997` in floating point, so the half cent rounds down. "
     "Switching the math to integer cents.",
     "patch", {"path": "src/cart.js", "old_string": BUG_OLD_LINE, "new_string": BUG_NEW_LINE}),
    (None, None, "patch", {"path": "src/cart.js", "old_string": BUG_OLD_TOTAL, "new_string": BUG_NEW_TOTAL}),
    (None, "Running the suite again.", "terminal", {"command": "npm test"}),
    (None, None, "todo_list", {"todos": todos(4)}),
]
CART_FINAL = """Fixed. Cart totals are now computed in integer cents, so tax that lands on a half cent rounds correctly.

**Root cause:** `cartTotal` summed float prices. `1.15 × 3` is `3.4499999999999997` in binary floating point, so a total of $17.545 rounded down to $17.54.

| Cart | Before | After |
| --- | --- | --- |
| 3 × $1.15 + $12.50, 10% tax | $17.54 | **$17.55** |

All 3 tests pass. `lineTotal` uses the same `toCents` helper, so line items and the cart total can't drift apart."""

SIMPLE_REPLIES = {
    "release notes": ("Summarize the notable changes since 2.3.0 for users.",
                      """**acme-shop 2.3.1**

- **Checkout:** totals no longer lose a cent when tax lands on a half cent.
- **Cart:** quantity changes update the total instantly.
- **Accessibility:** the address form announces validation errors to screen readers.

No breaking changes. Upgrade with `npm install acme-shop@2.3.1`."""),
    "first page load": ("Dev server cold start: likely dependency pre-bundling.",
                        """The first load in dev is slow because Vite pre-bundles dependencies on the first request, then caches them in `node_modules/.vite`.

- Later loads reuse the cache and should be fast.
- If every load is slow, the cache is being invalidated. Check for a changing `optimizeDeps` config or a lockfile that keeps changing.
- To warm it up ahead of time, list heavy dependencies in `optimizeDeps.include`."""),
    "dark mode": ("Plan the settings toggle and theme tokens.",
                  """Here's the plan for a dark mode toggle:

1. Add a `theme` preference (`system`, `light`, `dark`) to the settings store, defaulting to `system`.
2. Drive colors from CSS variables and switch them with a `data-theme` attribute on `<html>`.
3. Add a three-way segmented control to **Settings → Appearance**.

Want me to start with the settings store?"""),
}

TITLES = [("cent", "Fix checkout rounding"), ("release notes", "Release notes for 2.3.1"),
          ("first page load", "Slow first load in dev"), ("dark mode", "Dark mode toggle")]


def first_user_text(messages: list[dict]) -> str:
    for m in messages:
        if m.get("role") == "user":
            c = m.get("content")
            return c if isinstance(c, str) else " ".join(p.get("text", "") for p in c if isinstance(p, dict))
    return ""


def all_text(messages: list[dict]) -> str:
    out = []
    for m in messages:
        c = m.get("content")
        out.append(c if isinstance(c, str) else json.dumps(c) if c else "")
    return "\n".join(out).lower()


def plan(body: dict) -> dict:
    """What the model 'says' for this request: {reasoning, content, tool}."""
    messages = body.get("messages") or []
    prompt = first_user_text(messages).lower()
    if not body.get("tools"):
        text = all_text(messages)
        if "title" in text:
            title = next((t for key, t in TITLES if key in text), "New session")
            return {"content": title}
        return {"content": "OK."}
    if "cent" in prompt:
        # Steps are driven by how many tool results the conversation already holds after the last user turn.
        last_user = max(i for i, m in enumerate(messages) if m.get("role") == "user")
        step = sum(1 for m in messages[last_user:] if m.get("role") == "tool")
        if step >= len(CART_STEPS):
            return {"content": CART_FINAL}
        reasoning, text, name, args = CART_STEPS[step]
        return {"reasoning": reasoning, "content": text, "tool": (name, args)}
    for key, (reasoning, reply) in SIMPLE_REPLIES.items():
        if key in prompt:
            return {"reasoning": reasoning, "content": reply}
    return {"content": "I'm a scripted demo model; try one of the demo prompts."}


def chunks(text: str, size: int = 6):
    for i in range(0, len(text), size):
        yield text[i:i + size]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            return self.send_json({"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "demo"}]})
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if not self.path.rstrip("/").endswith("/chat/completions"):
            return self.send_json({"error": "not found"}, 404)
        answer = plan(body)
        tool = answer.get("tool")
        call_id = "call_" + uuid.uuid4().hex[:12]
        created = int(time.time())
        finish = "tool_calls" if tool else "stop"
        if not body.get("stream"):
            message = {"role": "assistant", "content": answer.get("content") or ""}
            if tool:
                message["tool_calls"] = [{"id": call_id, "type": "function",
                                          "function": {"name": tool[0], "arguments": json.dumps(tool[1])}}]
            return self.send_json({"id": "cmpl-demo", "object": "chat.completion", "created": created, "model": MODEL,
                                   "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                                   "usage": {"prompt_tokens": 1200, "completion_tokens": 160, "total_tokens": 1360}})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def emit(delta: dict, finish_reason=None, usage=None):
            payload = {"id": "cmpl-demo", "object": "chat.completion.chunk", "created": created, "model": MODEL,
                       "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}]}
            if usage:
                payload["usage"] = usage
            self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
            self.wfile.flush()

        emit({"role": "assistant", "content": ""})
        for piece in chunks(answer.get("reasoning") or ""):
            emit({"reasoning_content": piece})
            time.sleep(TOKEN_DELAY_S)
        for piece in chunks(answer.get("content") or ""):
            emit({"content": piece})
            time.sleep(TOKEN_DELAY_S)
        if tool:
            emit({"tool_calls": [{"index": 0, "id": call_id, "type": "function",
                                  "function": {"name": tool[0], "arguments": json.dumps(tool[1])}}]})
        emit({}, finish, {"prompt_tokens": 1200, "completion_tokens": 160, "total_tokens": 1360})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18990
    print(f"demo model on http://127.0.0.1:{port}/v1", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
