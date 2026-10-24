// node --test client/test.mjs — the wrapper against a fake server; no network, no key needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { XyntheriumVerify, XyntheriumVerifyError } from './xyntherium-verify.mjs';

const RESULT = { verdict: 'revise', claims: [{ index: 0, statement: 'Refunds are available within 30 days.', status: 'unsupported', reason: 'drops “for unopened items”', source_id: 'document', source_passage: 'within 30 days for unopened items', material: true }] };

function server(handler) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const out = handler(body, init);
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: out.headers ?? {} });
  };
}

test('answer() calls verify_answer with a bearer key and returns the structured result', async () => {
  let seen;
  const verify = new XyntheriumVerify({ apiKey: 'xyn_live_test', fetch: server((body, init) => {
    seen = { body, auth: init.headers.authorization };
    return { body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'REVISE' }], structuredContent: RESULT, isError: false } } };
  }) });
  const r = await verify.answer({ answer: 'Refunds are available within 30 days.', sources: [{ id: 'policy', text: 'within 30 days for unopened items' }], question: 'refund?' });
  assert.equal(seen.auth, 'Bearer xyn_live_test');
  assert.equal(seen.body.method, 'tools/call');
  assert.equal(seen.body.params.name, 'verify_answer');
  assert.deepEqual(seen.body.params.arguments, { answer: 'Refunds are available within 30 days.', sources: [{ id: 'policy', text: 'within 30 days for unopened items' }], question: 'refund?' });
  assert.deepEqual(r, RESULT);
});

test('againstDocument() maps documentText to document_text', async () => {
  let seen;
  const verify = new XyntheriumVerify({ apiKey: 'k', fetch: server((body) => { seen = body; return { body: { jsonrpc: '2.0', id: body.id, result: { structuredContent: RESULT, isError: false } } }; }) });
  await verify.againstDocument({ answer: 'a', documentText: 'd', title: 'T' });
  assert.deepEqual(seen.params, { name: 'verify_against_document', arguments: { answer: 'a', document_text: 'd', title: 'T' } });
});

test('a tool error and a JSON-RPC error both throw with the server message and Retry-After', async () => {
  const refused = new XyntheriumVerify({ apiKey: 'k', fetch: server((body) => ({ body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'Xyntherium Verify could not check this answer: Free plan: 50 MCP checks a day' }], isError: true } } })) });
  await assert.rejects(() => refused.answer({ answer: 'a', sources: ['s'] }), (e) => e instanceof XyntheriumVerifyError && /50 MCP checks a day/.test(e.message));
  const unauth = new XyntheriumVerify({ apiKey: 'k', fetch: server((body) => ({ status: 401, headers: { 'retry-after': '30' }, body: { jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'API key not recognized.' } } })) });
  await assert.rejects(() => unauth.answer({ answer: 'a', sources: ['s'] }), (e) => e instanceof XyntheriumVerifyError && e.status === 401 && e.retryAfterSeconds === 30 && e.message === 'API key not recognized.');
});

test('a missing key fails before any request', () => {
  assert.throws(() => new XyntheriumVerify({}), XyntheriumVerifyError);
});
