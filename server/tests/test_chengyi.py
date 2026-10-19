from app.workbench import apply_explicit_material
from app.workbench_schemas import WorkbenchIntent
from test_backend import backend


def test_glaze_aliases_respect_explicit_user_choice():
    original = WorkbenchIntent(decision="actions", actions=[{"tool": "set_material", "arguments": {"material": "blue", "gloss": 55}}])
    corrected = apply_explicit_material(original, "只把左边的碗口收窄一点，换成月白釉")
    assert corrected.actions[0].arguments["material"] == "cream"
    assert corrected.actions[0].arguments["gloss"] == 55
    unchanged = apply_explicit_material(original, "不要换成月白釉")
    assert unchanged.actions[0].arguments["material"] == "blue"
    preserved = WorkbenchIntent(decision="actions", actions=[{"tool": "reshape_region", "arguments": {"part": "mouth", "radius_scale_percent": -8}}])
    combined = apply_explicit_material(preserved, "把瓶口收一点，换成青绿釉")
    assert combined.actions[0].tool == "reshape_region" and combined.actions[1].arguments["material"] == "celadon"


def test_unified_frontend_does_not_serve_server_secrets(backend):
    _, client = backend
    assert client.get("/chengyi/").status_code == 200
    assert client.get("/chengyi/js/core/pottery.js").status_code == 200
    assert client.get("/workbench/").status_code == 200
    assert client.get("/admin").status_code == 200
    for path in ("/chengyi/server/.env", "/chengyi/.git/config", "/chengyi/server/data/heritage.db", "/chengyi/../server/.env"):
        assert client.get(path).status_code == 404
