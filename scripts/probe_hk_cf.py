#!/usr/bin/env python3
"""Probe ak.stock_hk_financial_report for Tencent cash flow."""
import warnings; warnings.filterwarnings("ignore")

try:
    import akshare as ak
    print("akshare version:", ak.__version__)
    
    for stock in ["00700", "01810", "09988"]:  # Tencent, Xiaomi, Alibaba
        print(f"\n{'='*50}")
        print(f"stock_hk_financial_report(stock='{stock}', indicator='现金流量表')")
        try:
            df = ak.stock_hk_financial_report(stock=stock, indicator="现金流量表")
            print(f"Shape: {df.shape}")
            print(f"Columns: {list(df.columns)}")
            print("First 20 rows:")
            print(df.head(20).to_string())
        except Exception as e:
            print(f"ERROR: {e}")
        
        print(f"\nstock_hk_financial_report(stock='{stock}', indicator='利润表')")
        try:
            df2 = ak.stock_hk_financial_report(stock=stock, indicator="利润表")
            print(f"Shape: {df2.shape}")
            print(f"Columns: {list(df2.columns)}")
            print("First 10 rows:")
            print(df2.head(10).to_string())
        except Exception as e:
            print(f"ERROR: {e}")

except ImportError as e:
    print(f"Import error: {e}")

