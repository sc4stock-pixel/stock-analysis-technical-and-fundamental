from forecast_metrics import dir_hits, mae

def test_dir_hits_all_correct_up():
    assert dir_hits(100, [101, 102, 103], [104, 105, 106]) == 3

def test_dir_hits_wrong_direction():
    assert dir_hits(100, [101, 102, 103], [99, 98, 97]) == 0

def test_dir_hits_mixed():
    assert dir_hits(100, [101, 101, 99], [102, 99, 98]) == 2

def test_mae_basic():
    assert mae([100, 100], [110, 90]) == 10.0

def test_mae_rounds_2dp():
    assert mae([100.0], [112.345]) == 12.35
