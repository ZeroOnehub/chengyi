import time
import json

from fastapi.testclient import TestClient
import httpx

from app.share_gateway import COOKIE, create_gateway

INVITATION = "share-test-" * 6


class Pieces(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b"event: audio_chunk\ndata: {}\n\n"
        yield b"event: voice_done\ndata: {}\n\n"


def client_for(seen, **overrides):
    def handler(request):
        seen.append(request)
        if request.url.path.endswith("/speech"):
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=Pieces())
        return httpx.Response(200, headers={"Content-Type": "application/json"},
                              stream=httpx.ByteStream(b'{"ok":true}'))
    return TestClient(create_gateway(INVITATION, transport=httpx.MockTransport(handler), **overrides),
                      base_url="https://example.test")


def enter(client):
    response = client.get("/", params={"invite": INVITATION}, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/workbench/"
    assert "Secure" in response.headers["set-cookie"] and "HttpOnly" in response.headers["set-cookie"]
    assert response.headers["referrer-policy"] == "no-referrer"


def test_invitation_required_and_invalid_unicode_is_rejected():
    seen = []
    with client_for(seen) as client:
        assert client.get("/workbench/").status_code == 403
        assert client.get("/", params={"invite": "无效链接"}).status_code == 403
        enter(client)
        assert client.get("/workbench/").status_code == 200
        assert seen[-1].url.host == "127.0.0.1"
        assert "cookie" not in seen[-1].headers


def test_admin_and_unrelated_routes_never_reach_backend():
    seen = []
    with client_for(seen) as client:
        enter(client)
        for path in ("/api/v1/admin/login", "/api/v1/admin/model", "/docs", "/openapi.json",
                     "/.env", "/workbench/../admin.html", "/api/v1/items", "/demo", "/voice"):
            assert client.get(path).status_code == 404
        assert client.post("/api/v1/admin/login", json={}).status_code == 404
        assert seen == []


def test_commands_and_recording_forward_session_token_but_not_credentials():
    seen = []
    ident = "12345678-1234-1234-1234-123456789abc"
    with client_for(seen) as client:
        enter(client)
        headers = {"X-Session-Token": "visitor-token", "Authorization": "Bearer unforwarded",
                   "Origin": "https://example.test"}
        assert client.post("/api/v1/workbenches", json={"document": {}}, headers=headers).status_code == 200
        assert client.post("/api/v1/sessions/" + ident + "/transcribe", content=b"RIFF-test",
                           headers={**headers, "Content-Type": "audio/wav"}).status_code == 200
        assert seen[-1].headers["x-session-token"] == "visitor-token"
        assert "authorization" not in seen[-1].headers and "cookie" not in seen[-1].headers
        assert seen[-1].content == b"RIFF-test"


def test_cross_origin_write_and_large_body_rejected():
    seen = []
    with client_for(seen) as client:
        enter(client)
        assert client.post("/api/v1/workbenches", json={}, headers={"Origin": "https://other.test"}).status_code == 403
        assert client.post("/api/v1/workbenches", json={}, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
        assert client.post("/api/v1/workbenches", content=b"a" * (1024 * 1024 + 1)).status_code == 413
        assert seen == []


def test_voice_stream_keeps_events_and_disables_buffering():
    seen = []
    with client_for(seen) as client:
        enter(client)
        response = client.post("/api/v1/workbenches/12345678-1234-1234-1234-123456789abc/speech", json={})
        assert response.status_code == 200 and "text/event-stream" in response.headers["content-type"]
        assert "event: audio_chunk" in response.text and "event: voice_done" in response.text
        assert response.headers["x-accel-buffering"] == "no"


def test_expired_invitation_cannot_be_reused():
    with client_for([], expires_at=time.time() - 1) as client:
        assert client.get("/", params={"invite": INVITATION}).status_code == 410


def test_tunnel_address_comes_from_acceptance_event():
    from scripts.share_workbench import tunnel_domain
    banner = "Welcome! https://admin.localhost.run/ https://localhost.run/docs/\n"
    assert tunnel_domain(banner) is None
    accepted = json.dumps({"type": "v1.tcpip_forward.register.accepted", "data": "https://abc123.lhr.life"})
    assert tunnel_domain(banner + accepted) == "abc123.lhr.life"
    assert tunnel_domain(json.dumps({"type": "rejected", "data": "https://bad.lhr.life"})) is None
