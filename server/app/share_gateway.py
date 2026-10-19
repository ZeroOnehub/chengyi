"""Temporary, invitation-only access to the workbench through the local backend."""
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import re
import secrets
from time import time
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from starlette.background import BackgroundTask

COOKIE = "__Host-pottery-share"
MAX_BODY = 1024 * 1024
IDENT = r"[0-9a-fA-F-]{36}"
API_ROUTES = [
    ("POST", re.compile(r"/api/v1/workbenches")),
    ("GET", re.compile(rf"/api/v1/workbenches/{IDENT}")),
    ("POST", re.compile(rf"/api/v1/workbenches/{IDENT}/(?:sync|cancel|commands|speech)")),
    ("POST", re.compile(rf"/api/v1/workbenches/{IDENT}/tools/[a-z_]+")),
    ("POST", re.compile(rf"/api/v1/workbenches/{IDENT}/commands/{IDENT}/receipt")),
    ("POST", re.compile(rf"/api/v1/sessions/{IDENT}/transcribe")),
]
STATIC = {"/workbench/", "/workbench/styles.css", "/workbench/assistant.css",
          "/workbench/app.js", "/workbench/geometry.js", "/workbench/assistant.js",
          "/workbench/vendor/three.min.js", "/workbench/vendor/OrbitControls.js",
          "/pcm-player.js", "/recording-worklet.js"}


def create_gateway(invitation=None, expires_at=None, transport=None):
    if invitation is None:
        path = Path(os.environ.get("POTTERY_SHARE_CONFIG", "data/temp-share-config.json"))
        config = json.loads(path.read_text(encoding="utf-8"))
        invitation, expires_at = config["invitation"], config["expires_at"]
    if not invitation or len(invitation) < 32:
        raise ValueError("分享入口尚未初始化")
    expires_at = expires_at or time() + 24 * 3600

    def valid(value):
        return secrets.compare_digest(value.encode("utf-8"), invitation.encode("utf-8"))

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", transport=transport,
                                     trust_env=False, timeout=httpx.Timeout(180, connect=5)) as client:
            app.state.upstream = client
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def guard(request, call_next):
        if time() >= expires_at:
            response = HTMLResponse("临时分享已结束，请联系发送者重新开启。", status_code=410)
        elif request.url.path == "/share-health" and request.method == "GET":
            response = JSONResponse({"status": "ok"})
        elif request.url.path == "/" and request.method == "GET" and request.query_params.get("invite"):
            if valid(request.query_params["invite"]):
                response = RedirectResponse("/workbench/", status_code=303)
                response.set_cookie(COOKIE, invitation, max_age=max(1, int(expires_at - time())),
                                    secure=True, httponly=True, samesite="lax", path="/")
            else:
                response = HTMLResponse("分享链接无效，请使用发送者提供的完整网址。", status_code=403)
        elif not valid(request.cookies.get(COOKIE, "")):
            response = HTMLResponse("请使用发送者提供的完整分享链接打开工作台。", status_code=403)
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "microphone=(self), camera=(self)"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
    async def forward(path: str, request: Request):
        path = "/" + path
        if request.method == "GET" and path in ("/", "/workbench"):
            return RedirectResponse("/workbench/", status_code=303)
        allowed = (request.method in ("GET", "HEAD") and path in STATIC) or any(
            request.method == method and pattern.fullmatch(path) for method, pattern in API_ROUTES)
        if not allowed:
            return JSONResponse({"error": {"message": "这个分享网址仅提供陶艺工作台。"}}, status_code=404)
        if request.method == "POST":
            origin = request.headers.get("origin")
            if ((origin and (urlsplit(origin).netloc != request.url.netloc or urlsplit(origin).scheme != "https"))
                    or request.headers.get("sec-fetch-site") == "cross-site"):
                return JSONResponse({"error": {"message": "请在工作台页面内执行操作。"}}, status_code=403)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY:
                return JSONResponse({"error": {"message": "请求内容过大。"}}, status_code=413)
        headers = {key: request.headers[key] for key in ("content-type", "x-session-token", "accept")
                   if key in request.headers}
        target = path + ("?" + request.url.query if request.url.query else "")
        try:
            outgoing = app.state.upstream.build_request(request.method, target, content=bytes(body), headers=headers)
            upstream = await app.state.upstream.send(outgoing, stream=True)
        except httpx.HTTPError:
            return JSONResponse({"error": {"message": "本机后台连接中断，请联系发送者。"}}, status_code=503)
        response_headers = {key: value for key, value in upstream.headers.items()
                            if key in ("content-type", "content-length", "content-encoding", "etag",
                                       "last-modified", "content-disposition", "retry-after", "x-request-id")}
        response_headers["X-Accel-Buffering"] = "no"

        async def stream():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()

        return StreamingResponse(stream(), status_code=upstream.status_code, headers=response_headers,
                                 background=BackgroundTask(upstream.aclose))

    return app
