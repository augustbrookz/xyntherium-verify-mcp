/**
 * A tiny client for the Xyntherium Verify MCP server: two calls, no dependencies.
 * Node 18+ (or any runtime with fetch). Streamable HTTP, protocol 2025-11-25, stateless.
 *
 *   import { XyntheriumVerify } from './xyntherium-verify.mjs';
 *   const verify = new XyntheriumVerify({ apiKey: process.env.XYN_API_KEY });
 *   const r = await verify.answer({ answer, sources: [{ id: 'policy', text }] });
 *   const d = await verify.againstDocument({ answer, documentText: text });
 *   // r.verdict: 'send' | 'cite_sources' | 'revise' | 'ask_a_person'
 *   // r.claims: [{ statement, status: 'supported' | 'unsupported' | 'contradicted', reason, source_id, source_passage, material }]
 *
 * A refused call (no key, over quota, over a daily cap, oversized input) throws a
 * XyntheriumVerifyError with the server's message and, when it sent one, retryAfterSeconds.
 */
export class XyntheriumVerifyError extends Error {
  constructor(message, { status = 0, code = 'error', retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'XyntheriumVerifyError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class XyntheriumVerify {
  #apiKey;
  #url;
  #fetch;
  #id = 0;

  constructor({ apiKey, url = 'https://www.xyntherium.com/mcp', fetch: fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) throw new XyntheriumVerifyError('apiKey is required (https://xyntherium.com/account/api-keys)', { code: 'no_key' });
    this.#apiKey = apiKey;
    this.#url = url;
    this.#fetch = fetchImpl;
  }

  /** Check an answer against several passages. sources: [{ text, id?, title? }] or strings. */
  answer({ answer, sources, question, mode } = {}) {
    return this.#call('verify_answer', { answer, sources, ...(question ? { question } : {}), ...(mode ? { mode } : {}) });
  }

  /** Check an answer against one document's text. */
  againstDocument({ answer, documentText, title, question, mode } = {}) {
    return this.#call('verify_against_document', { answer, document_text: documentText, ...(title ? { title } : {}), ...(question ? { question } : {}), ...(mode ? { mode } : {}) });
  }

  /** The tools the server lists (needs no key). */
  async tools() {
    const r = await this.#rpc('tools/list', {});
    return r.tools;
  }

  async #call(name, args) {
    const result = await this.#rpc('tools/call', { name, arguments: args });
    if (result.isError) throw new XyntheriumVerifyError(result.content?.[0]?.text ?? 'the check was refused', { status: 200, code: 'tool_error' });
    return result.structuredContent;
  }

  async #rpc(method, params) {
    const res = await this.#fetch(this.#url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json', accept: 'application/json', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.#id, method, params }),
    });
    const retry = Number(res.headers.get('retry-after'));
    const body = await res.json().catch(() => null);
    if (body?.error) throw new XyntheriumVerifyError(body.error.message ?? `HTTP ${res.status}`, { status: res.status, code: String(body.error.code ?? res.status), retryAfterSeconds: Number.isFinite(retry) ? retry : null });
    if (!res.ok || !body?.result) throw new XyntheriumVerifyError(`HTTP ${res.status}`, { status: res.status, code: 'http_error', retryAfterSeconds: Number.isFinite(retry) ? retry : null });
    return body.result;
  }
}

export default XyntheriumVerify;
