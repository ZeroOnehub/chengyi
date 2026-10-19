import copy
import json
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db import Base
from app.main import create_app
from app.models import PotteryCommand, PotteryProject, utcnow
from app.pottery import apply_batch, profile
from app.workbench import same_document, simple_intent
from app.workbench_schemas import Document, ToolCall
from test_backend import backend, configuration


def document():
    return Document(name="测试陶器", profile=profile("vase"), height=28, material="terracotta", gloss=25, preset="vase").model_dump()


def create(client):
    response = client.post("/api/v1/workbenches", json={"document": document()})
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    return data["project"], {"X-Session-Token": data["session_token"]}


def tool(client, project, headers, name, arguments=None, request_id=None):
    return client.post("/api/v1/workbenches/" + project["id"] + "/tools/" + name, headers=headers,
        json={"expected_revision": project["revision"], "client_request_id": request_id or str(uuid4()), "arguments": arguments or {}})


def ack(client, project, headers, command, **overrides):
    payload = {"expected_revision": command["revision"], "status": "applied", "document": command["document"], **overrides}
    return client.post("/api/v1/workbenches/" + project["id"] + "/commands/" + command["id"] + "/receipt", headers=headers, json=payload)


def test_confirmed_state_history_save_and_foreign_auth(backend):
    _, client = backend
    project, headers = create(client)
    _, other = create(client)
    base = "/api/v1/workbenches/" + project["id"]
    assert client.get(base, headers=other).status_code == 404
    assert client.get(base).status_code == 404
    queued = tool(client, project, headers, "set_dimensions", {"height_cm": 25}).json()["data"]
    assert queued["project"]["document"]["height"] == 28
    command = queued["command"]
    assert command["document"]["height"] == 25
    assert client.post(base + "/speech", headers=headers, json={"command_id": command["id"]}).status_code == 409
    rejected = ack(client, project, headers, command, document={**command["document"], "height": 24})
    assert rejected.status_code == 422
    result = ack(client, project, headers, command).json()["data"]
    project = result["project"]
    assert project["document"]["height"] == 25 and project["undo_count"] == 1
    assert ack(client, project, headers, command).status_code == 200
    assert ack(client, project, headers, command, status="failed").status_code == 409
    queued = tool(client, project, headers, "undo").json()["data"]
    project = ack(client, project, headers, queued["command"]).json()["data"]["project"]
    assert project["document"]["height"] == 28 and project["redo_count"] == 1
    queued = tool(client, project, headers, "redo").json()["data"]
    project = ack(client, project, headers, queued["command"]).json()["data"]["project"]
    queued = tool(client, project, headers, "save_project", {"name": "青瓷试作"}).json()["data"]
    project = ack(client, project, headers, queued["command"]).json()["data"]["project"]
    assert project["saved_at"] and project["document"]["name"] == "青瓷试作"
    assert client.get(base, headers=headers).json()["data"]["project"]["document"]["height"] == 25


def test_dedup_cancel_expiry_and_export_receipt(backend):
    app, client = backend
    project, headers = create(client)
    request_id = str(uuid4())
    result = tool(client, project, headers, "export_artifact", {"format": "obj"}, request_id).json()["data"]
    command = result["command"]
    assert tool(client, project, headers, "export_artifact", {"format": "obj"}, request_id).json()["data"]["command"]["id"] == command["id"]
    assert tool(client, project, headers, "export_artifact", {"format": "png"}, request_id).status_code == 409
    assert ack(client, project, headers, command).status_code == 422
    project = client.post("/api/v1/workbenches/" + project["id"] + "/cancel", headers=headers, json={}).json()["data"]["project"]
    assert ack(client, project, headers, command).status_code == 409
    queued = tool(client, project, headers, "set_material", {"material": "celadon"}).json()["data"]
    with app.state.db_factory() as db:
        db.get(PotteryCommand, queued["command"]["id"]).expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert ack(client, project, headers, queued["command"]).status_code == 409
    state = client.get("/api/v1/workbenches/" + project["id"], headers=headers).json()["data"]
    assert state["pending"] == [] and state["project"]["document"]["material"] == "terracotta"
    project = state["project"]
    queued = tool(client, project, headers, "export_artifact", {"format": "json"}).json()["data"]
    assert ack(client, project, headers, queued["command"], artifacts=[{"format": "json", "filename": "测试.json", "bytes": 5000}]).status_code == 200


def test_manual_edit_revision_validation_and_region_engine(backend):
    _, client = backend
    project, headers = create(client)
    original = document()
    result = apply_batch(original, [], [], [ToolCall(tool="reshape_region", arguments={"start_height_ratio": .8, "end_height_ratio": 1, "radius_delta_cm": -.5})])
    assert original["profile"] == document()["profile"]
    assert result["document"]["profile"][:70] == original["profile"][:70]
    assert result["document"]["profile"][-1] == pytest.approx(original["profile"][-1] - .5 / 6)
    body = {"expected_revision": project["revision"], "client_request_id": str(uuid4()), "document": {**original, "height": 24}}
    route = "/api/v1/workbenches/" + project["id"] + "/sync"
    assert client.post(route, headers=headers, json=body).status_code == 200
    assert client.post(route, headers=headers, json=body).status_code == 200
    assert tool(client, project, headers, "set_dimensions", {"height_cm": 25}).status_code == 409
    state = client.get("/api/v1/workbenches/" + project["id"], headers=headers).json()["data"]["project"]
    for name, arguments in [("set_dimensions", {"height_cm": 999}), ("set_wheel", {"rotating": "false"}),
                            ("set_shape_profile", {"points": [{"height_ratio": .5, "radius_cm": 3}, {"height_ratio": 1, "radius_cm": 4}]}),
                            ("set_material", {"material": "evil", "script": "alert(1)"})]:
        assert tool(client, state, headers, name, arguments).status_code == 422
    assert simple_intent("不要把高度改成25厘米") is None
    assert simple_intent("把高度改成25厘米？") is None


def test_dify_planner_atomic_actions_and_rejected_output(tmp_path):
    answer = {"decision": "actions", "actions": [{"tool": "set_material", "arguments": {"material": "celadon", "gloss": 20}},
        {"tool": "set_shape_profile", "arguments": {"shape": "jar", "height_cm": 25, "points": [{"height_ratio": 0, "radius_cm": 5}, {"height_ratio": .4, "radius_cm": 9}, {"height_ratio": .8, "radius_cm": 3}, {"height_ratio": 1, "radius_cm": 3.5}]}}], "message": ""}
    requests = []
    def provider(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, text="data: " + json.dumps({"event": "agent_message", "answer": json.dumps(answer)}) + '\n\ndata: {"event":"message_end"}\n\n')
    app = create_app(configuration(tmp_path, llm_mode="live", llm_provider="dify", llm_api_base_url="https://api.dify.ai/v1", llm_api_key="test-app-key", llm_model="heritage"), model_transport=httpx.MockTransport(provider))
    Base.metadata.create_all(app.state.engine)
    with TestClient(app) as client:
        project, headers = create(client)
        route = "/api/v1/workbenches/" + project["id"] + "/commands"
        body = {"expected_revision": project["revision"], "client_request_id": str(uuid4()), "text": "请做成细颈圆肚，使用青瓷釉"}
        response = client.post(route, headers=headers, json=body)
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert result["command"]["source"] == "dify" and result["command"]["document"]["material"] == "celadon"
        assert result["command"]["document"]["preset"] == "jar"
        assert result["project"]["document"]["material"] == "terracotta"
        assert requests[0]["query"].startswith("【陶艺工作台指令模式】")
        assert "test-app-key" not in requests[0]["query"]
        project = ack(client, project, headers, result["command"]).json()["data"]["project"]
        answer["actions"][1]["arguments"]["points"][0]["radius_cm"] = 999
        body.update(expected_revision=project["revision"], client_request_id=str(uuid4()))
        assert client.post(route, headers=headers, json=body).status_code == 503
        assert client.get("/api/v1/workbenches/" + project["id"], headers=headers).json()["data"]["project"]["document"] == project["document"]


def test_cancel_during_model_wait_and_invalid_atomic_batch(tmp_path):
    from app.workbench import cancel
    target = {}
    answer = {"decision": "actions", "actions": [{"tool": "set_material", "arguments": {"material": "celadon"}},
        {"tool": "set_dimensions", "arguments": {"height_cm": 24}}], "message": ""}
    def provider(request):
        if target.get("cancel"):
            with app.state.db_factory() as db:
                cancel(db, db.get(PotteryProject, target["id"]))
        return httpx.Response(200, text="data: " + json.dumps({"event": "agent_message", "answer": json.dumps(answer)}) + '\n\ndata: {"event":"message_end"}\n\n')
    app = create_app(configuration(tmp_path, llm_mode="live", llm_provider="dify", llm_api_base_url="https://api.dify.ai/v1", llm_api_key="test-key", llm_model="heritage"), model_transport=httpx.MockTransport(provider))
    Base.metadata.create_all(app.state.engine)
    with TestClient(app) as client:
        project, headers = create(client)
        target.update(id=project["id"], cancel=True)
        route = "/api/v1/workbenches/" + project["id"]
        body = {"expected_revision": project["revision"], "client_request_id": str(uuid4()), "text": "把它改小一点并换成青瓷"}
        assert client.post(route + "/commands", headers=headers, json=body).status_code == 409
        state = client.get(route, headers=headers).json()["data"]
        assert not state["pending"] and state["project"]["document"] == document()
        target["cancel"] = False
        # A permitted maximum-diameter value can still make the narrowest ring too thin.
        answer["actions"][1] = {"tool": "set_dimensions", "arguments": {"diameter_cm": 3.84}}
        body.update(expected_revision=state["project"]["revision"], client_request_id=str(uuid4()))
        assert client.post(route + "/commands", headers=headers, json=body).status_code == 422
        state = client.get(route, headers=headers).json()["data"]
        assert not state["pending"] and state["project"]["document"]["material"] == "terracotta"


def test_tools_schema_contains_all_tools_with_resolvable_control_points(backend):
    _, client = backend
    response = client.get("/api/v1/workbenches/tools/openapi.json")
    assert response.status_code == 200
    spec = response.json()
    operations = [operation for path in spec["paths"].values() for operation in path.values()]
    assert {op["operationId"] for op in operations} == set(__import__('app.workbench_schemas', fromlist=['ARGUMENTS']).ARGUMENTS)
    assert '#/$defs/' not in json.dumps(spec)
    assert spec["components"]["schemas"]["ControlPoint"]["properties"]["radius_cm"]["minimum"] == 1.92
