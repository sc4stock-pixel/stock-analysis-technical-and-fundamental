#!/usr/bin/env python3
"""Find all akshare functions containing 'hk' and 'financial' or 'report'."""
import warnings; warnings.filterwarnings("ignore")
import akshare as ak

# Find all relevant functions
fns = [f for f in dir(ak) if 'hk' in f.lower() and ('financial' in f.lower() or 'report' in f.lower() or 'cash' in f.lower())]
print("Relevant akshare functions:")
for f in sorted(fns):
    print(f"  {f}")

print()
# Also try the one we already use but print ALL row names for Tencent CF
print("Testing stock_financial_hk_report_em cash flow for 00700:")
try:
    df = ak.stock_financial_hk_report_em(stock="00700", symbol="现金流量表", indicator="报告期")
    print(f"Shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    names = df["STD_ITEM_NAME"].unique().tolist()
    print(f"ALL STD_ITEM_NAME values ({len(names)}):")
    for n in names:
        print(f"  '{n}'")
except Exception as e:
    print(f"ERROR: {e}")
