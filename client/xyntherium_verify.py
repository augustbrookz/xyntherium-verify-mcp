"""A tiny client for the Xyntherium Verify MCP server: two calls, standard library only.

    from xyntherium_verify import XyntheriumVerify, XyntheriumVerifyError
    verify = XyntheriumVerify(api_key=os.environ["XYN_API_KEY"])
    r = verify.answer(answer=answer, sources=[{"id": "policy", "text": policy}])
    d = verify.against_document(answer=answer, document_text=policy)
    # r["verdict"]: "send" | "cite_sources" | "revise" | "ask_a_person"
    # r["claims"]: [{statement, status: supported|unsupported|contradicted, reason, source_id, source_passage, material}]

A refused call (no key, over quota, over a daily cap, oversized input) raises
XyntheriumVerifyError with the server's message and, when it sent one, retry_after_seconds.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional

DEFAULT_URL = "https://www.xyntherium.com/mcp"


class XyntheriumVerifyError(Exception):
    def __init__(self, message: str, status: int = 0, code: str = "error", retry_after_seconds: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.retry_after_seconds = retry_after_seconds


class XyntheriumVerify:
    def __init__(self, api_key: str, url: str = DEFAULT_URL, timeout: float = 120.0):
        if not api_key:
            raise XyntheriumVerifyError("api_key is required (https://xyntherium.com/account/api-keys)", code="no_key")
        self._api_key = api_key
        self._url = url
        self._timeout = timeout
        self._id = 0

    def answer(self, answer: str, sources: list, question: Optional[str] = None, mode: Optional[str] = None) -> dict:
        """Check an answer against several passages. sources: [{"text": ..., "id": ..., "title": ...}] or strings."""
        args: dict[str, Any] = {"answer": answer, "sources": sources}
        if question:
            args["question"] = question
        if mode:
            args["mode"] = mode
        return self._call("verify_answer", args)

    def against_document(self, answer: str, document_text: str, title: Optional[str] = None, question: Optional[str] = None, mode: Optional[str] = None) -> dict:
        """Check an answer against one document's text."""
        args: dict[str, Any] = {"answer": answer, "document_text": document_text}
        if title:
            args["title"] = title
        if question:
            args["question"] = question
        if mode:
            args["mode"] = mode
        return self._call("verify_against_document", args)

    def tools(self) -> list:
        """The tools the server lists (needs no key)."""
        return self._rpc("tools/list", {})["tools"]

    def _call(self, name: str, args: dict) -> dict:
        result = self._rpc("tools/call", {"name": name, "arguments": args})
        if result.get("isError"):
            text = (result.get("content") or [{}])[0].get("text", "the check was refused")
            raise XyntheriumVerifyError(text, status=200, code="tool_error")
        return result["structuredContent"]

    def _rpc(self, method: str, params: dict) -> dict:
        self._id += 1
        payload = json.dumps({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params}).encode("utf-8")
        req = urllib.request.Request(
            self._url,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "MCP-Protocol-Version": "2025-11-25",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as res:
                status = res.status
                retry = res.headers.get("Retry-After")
                body = json.loads(res.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            status = e.code
            retry = e.headers.get("Retry-After")
            try:
                body = json.loads(e.read().decode("utf-8") or "null")
            except Exception:
                body = None
        retry_after = int(retry) if retry and retry.isdigit() else None
        if isinstance(body, dict) and body.get("error"):
            err = body["error"]
            raise XyntheriumVerifyError(err.get("message", f"HTTP {status}"), status=status, code=str(err.get("code", status)), retry_after_seconds=retry_after)
        if status >= 400 or not isinstance(body, dict) or "result" not in body:
            raise XyntheriumVerifyError(f"HTTP {status}", status=status, code="http_error", retry_after_seconds=retry_after)
        return body["result"]
