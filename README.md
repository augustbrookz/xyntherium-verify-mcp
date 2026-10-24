# Xyntherium Verify MCP

Let any AI agent verify an answer against its sources **before** it states a fact or takes an action.

Two tools, hosted at `https://xyntherium.com/mcp` (Streamable HTTP, bearer auth):

| Tool | Input | What comes back |
|---|---|---|
| `verify_answer` | `answer`, `sources[]` (`{ text, id?, title? }`), `question?`, `mode?` | Every claim in the answer marked **supported**, **unsupported** or **contradicted**, with the source passage that decides it, and one verdict: `send`, `cite_sources`, `revise` or `ask_a_person` |
| `verify_against_document` | `answer`, `document_text`, `title?`, `question?`, `mode?` | The same, against one document |

It catches a dropped condition ("within 30 days *for unopened items*"), a changed number or date, a flipped negation, a wrong entity, and any statement the sources never make. It checks only against the text you pass: it never fetches URLs and does not check facts about the world.

This repository is the integration layer: install snippets, example configs, a system-prompt snippet and a tiny client wrapper. The hosted service is closed source; the deterministic engine behind it is open at [augustbrookz/verify-gate](https://github.com/augustbrookz/verify-gate).

## Install

Get an API key at **https://xyntherium.com/account/api-keys** (free: 1,000 checks a month, 50 a day over MCP, no card).

### Claude Code

```bash
claude mcp add --transport http xyntherium-verify https://xyntherium.com/mcp \
  --header "Authorization: Bearer $XYN_API_KEY"
```

Add `--scope user` to make it available in every project. `claude mcp list` shows it connected.

### Claude Desktop

Settings → Developer → Edit config (`claude_desktop_config.json`), through the `mcp-remote` bridge ([examples/claude_desktop_config.json](examples/claude_desktop_config.json)):

```json
{
  "mcpServers": {
    "xyntherium-verify": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://xyntherium.com/mcp", "--header", "Authorization: Bearer ${XYN_API_KEY}"],
      "env": { "XYN_API_KEY": "xyn_live_…" }
    }
  }
}
```

Or Settings → Connectors → Add custom connector with `https://xyntherium.com/mcp` and no key: Claude sends you to Xyntherium to sign in and approve access (OAuth, 90 days).

### Cursor

`~/.cursor/mcp.json` or `.cursor/mcp.json` ([examples/cursor-mcp.json](examples/cursor-mcp.json)):

```json
{
  "mcpServers": {
    "xyntherium-verify": {
      "url": "https://xyntherium.com/mcp",
      "headers": { "Authorization": "Bearer xyn_live_…" }
    }
  }
}
```

### VS Code

`.vscode/mcp.json` ([examples/vscode-mcp.json](examples/vscode-mcp.json)); VS Code asks for the key once and stores it securely.

### Any other MCP client

URL `https://xyntherium.com/mcp`, header `Authorization: Bearer <key>`, Streamable HTTP, stateless, protocol `2026-07-28` and `2025-11-25` (and `2025-06-18` / `2025-03-26` through `initialize`). Discovery and `tools/list` need no key; every tool call does.

## 30-second demo

1. Install with the Claude Code command above.
2. Ask Claude:

   ```text
   Our return policy says: "Refunds are available within 30 days for unopened items with proof of purchase."
   A customer asks if they can get a refund. Draft a one-sentence reply, then verify it with
   xyntherium-verify before you show it to me, and fix anything the check flags.
   ```

3. Claude drafts "Yes, refunds are available within 30 days", calls `verify_against_document`, and gets:

   ```text
   REVISE: dropped “for unopened items with proof of purchase”.
   - Dropped: “Refunds are available within 30 days.” leaves out “for unopened items with proof of purchase”; the source says “within 30 days for unopened items with proof of purchase” (source document).
   Claims:
   1. [unsupported] “Refunds are available within 30 days.”; drops “for unopened items with proof of purchase”; source document: “Refunds are available within 30 days for unopened items with proof of purchase.”.
   0 of 1 statements supported · mode fast · rules 2.1.0 · request …
   ```

4. Claude rewrites the reply with the conditions, checks again, and gets `SEND`.

From a shell, without any client:

```bash
curl -s -X POST https://xyntherium.com/mcp \
  -H "Authorization: Bearer $XYN_API_KEY" \
  -H 'content-type: application/json' -H 'accept: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify_against_document","arguments":{
    "answer":"Refunds are available within 30 days.",
    "document_text":"Refunds are available within 30 days for unopened items with proof of purchase."}}}'
```

## Telling your agent when to call it

The server sends every client these instructions; [examples/agent-system-prompt.md](examples/agent-system-prompt.md) has a longer version for your own system prompt:

> Before you state facts drawn from documents in the conversation, or act on them (send a reply, file a change, book, refund, approve), verify the drafted answer: call `verify_answer` with the answer and the passages it relies on, or `verify_against_document` with the answer and the one document it rests on. On REVISE, fix what it names and check again before proceeding. On ASK A PERSON, tell the user what the sources do not settle instead of guessing. Do not call it for chit-chat, for answers with no source text, or to fact-check the world.

## The result

Text (the verdict first, then each problem, then every claim) and the same as `structuredContent`:

```json
{
  "verdict": "revise",
  "release_recommendation": "revise",
  "summary": "REVISE: dropped “for unopened items with proof of purchase”.",
  "claims": [
    {
      "index": 0,
      "statement": "Refunds are available within 30 days.",
      "status": "unsupported",
      "reason": "drops “for unopened items with proof of purchase”",
      "source_id": "document",
      "source_passage": "Refunds are available within 30 days for unopened items with proof of purchase.",
      "material": true
    }
  ],
  "dropped": [ … ], "contradicted": [], "unsupported": [], "unresolved": [],
  "statements": 1, "supported": 0, "mode": "fast",
  "request_id": "…", "evidence_ledger_id": "…", "rules_version": "2.1.0"
}
```

`status` is `supported` (the sources say this), `contradicted` (the sources say otherwise) or `unsupported` (the sources do not say this, or do not settle it: the `reason` says which). Both tools are read-only and idempotent. Everything you pass is treated as untrusted data: it is checked, never followed.

## Client wrapper

Two single-file wrappers call the server directly over JSON-RPC, with no dependencies:

- [client/xyntherium-verify.mjs](client/xyntherium-verify.mjs) (Node 18+ or any runtime with `fetch`):

  ```js
  import { XyntheriumVerify } from './client/xyntherium-verify.mjs';
  const verify = new XyntheriumVerify({ apiKey: process.env.XYN_API_KEY });
  const r = await verify.answer({ answer, sources: [{ id: 'policy', text: policy }] });
  if (r.verdict !== 'send') console.log(r.claims.filter((c) => c.status !== 'supported'));
  ```

- [client/xyntherium_verify.py](client/xyntherium_verify.py) (Python 3.9+, standard library only):

  ```python
  from xyntherium_verify import XyntheriumVerify
  r = XyntheriumVerify(api_key=os.environ["XYN_API_KEY"]).against_document(answer=answer, document_text=policy)
  if r["verdict"] != "send": print([c for c in r["claims"] if c["status"] != "supported"])
  ```

Both raise on a refused call (no key, over quota, over a cap, oversized input) with the server's message.

## Limits, metering and cost

| | |
|---|---|
| Plan quota | Every call is one check against your plan's monthly allowance, shared with the API and Verify Gate: Free 1,000, Builder 8,000, Team 40,000. An answer over 25 statements counts as one check per 25. Failed or partial checks are not counted. |
| Free daily limit | 50 MCP checks a day (UTC) on the Free plan |
| Per-key spend cap | $2.00 of model spend per API key per day, across every surface the key uses |
| Global spend cap | $5.00 of model spend per day across every MCP check; past it the server refuses calls until 00:00 UTC |
| Rate limits | 30 calls a minute per Free account (Builder 120, Team 600); 60 a minute per key |
| Input limits | `answer` 20,000 characters; 25 sources of 100,000 characters (400,000 in total); `document_text` 100,000 characters; request body 1.2 MB. Oversized input gets a tool error naming the limit, and nothing is charged. |
| Cost to run | About 0.1¢ of model spend per check in fast mode (measured mean 0.098¢, p95 0.15¢). Plan prices: https://xyntherium.com/pricing |

A refused call comes back as a tool error that says which limit was hit and when it resets, with a `Retry-After` header.

## Data handling

- **Sent to Xyntherium:** the answer, the source or document text, and the question if you pass one. Nothing else from your conversation, repository or machine. URLs are never fetched.
- **Seen by the model:** the model provider (Anthropic) receives the text needed to split the answer into claims and check each one, under its commercial API terms, which exclude training on API traffic. Xyntherium never trains on your text.
- **Stored:** the text and the result, encrypted (AES-256-GCM), for your plan's retention window: 7 days on Free, 30 on Builder, 90 on Team; then deleted. The evidence ledger (hashes of the text, verdicts and offsets, not the text) is kept 30, 90 or 365 days by plan. Telemetry is structural only: counts, latency, cost, client name and version, never content.
- **Deletion:** email support@xyntherium.com from the address on the account to delete everything tied to it. [Privacy](https://xyntherium.com/privacy) · [Security](https://xyntherium.com/security) · [Terms](https://xyntherium.com/terms)

> Verdicts describe whether the supplied passages support each claim, not whether a claim is true in the world. Evidence support for supplied sources only; not a compliance certification or legal assessment.

## Links

- Docs and install: https://xyntherium.com/mcp
- API docs: https://xyntherium.com/docs/api
- The open engine, Gate, CLI and SDK: https://github.com/augustbrookz/verify-gate
- Support: support@xyntherium.com

MIT.
