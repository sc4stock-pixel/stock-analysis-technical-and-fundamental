"""Unit tests for the yfinance 'database is locked' retry in optimize_supertrend.py."""
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

sys.path.insert(0, str(Path(__file__).parent))
import optimize_supertrend as opt


def test_fetch_history_retries_on_locked_db(monkeypatch):
    monkeypatch.setattr(opt.time, "sleep", lambda s: None)
    good_df = pd.DataFrame({"Close": [1.0]})
    calls = {"n": 0}

    class FakeTicker:
        def __init__(self, symbol):
            pass

        def history(self, **kwargs):
            calls["n"] += 1
            if calls["n"] < 3:
                raise Exception("sqlite3.OperationalError: database is locked")
            return good_df

    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    df = opt._fetch_history("TEST")
    assert calls["n"] == 3
    assert df is good_df


def test_fetch_history_gives_up_after_retries(monkeypatch):
    monkeypatch.setattr(opt.time, "sleep", lambda s: None)
    calls = {"n": 0}

    class FakeTicker:
        def __init__(self, symbol):
            pass

        def history(self, **kwargs):
            calls["n"] += 1
            raise Exception("sqlite3.OperationalError: database is locked")

    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    try:
        opt._fetch_history("TEST")
        assert False, "expected exception"
    except Exception as e:
        assert "database is locked" in str(e)
    assert calls["n"] == opt.FETCH_RETRIES


def test_fetch_history_does_not_retry_other_errors(monkeypatch):
    monkeypatch.setattr(opt.time, "sleep", lambda s: None)
    calls = {"n": 0}

    class FakeTicker:
        def __init__(self, symbol):
            pass

        def history(self, **kwargs):
            calls["n"] += 1
            raise ValueError("some other error")

    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    try:
        opt._fetch_history("TEST")
        assert False, "expected exception"
    except ValueError:
        pass
    assert calls["n"] == 1
