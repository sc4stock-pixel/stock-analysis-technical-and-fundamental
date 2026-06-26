import json, subprocess


def test_emit_skill_json(tmp_path):
    out = tmp_path / "forecast_skill.json"
    subprocess.run(
        ["python3", "scripts/forecast_probation_audit.py",
         "--emit-skill-json", str(out)], check=True)
    d = json.loads(out.read_text())
    assert d["_metadata"]["conviction_pct"] == 5.0
    assert d["_metadata"]["drift_window"] == 60
    for model in ("KRONOS", "NAIVE", "TIMESFM"):
        assert model in d and "verdict" in d[model]
    assert d["NAIVE"]["verdict"] == "BASELINE"
    allowed = {"EDGE_HIGH_CONVICTION", "EDGE_BROAD", "NO_EDGE", "INSUFFICIENT", "BASELINE"}
    assert d["KRONOS"]["verdict"] in allowed
    assert "conviction_5d" in d["KRONOS"]
