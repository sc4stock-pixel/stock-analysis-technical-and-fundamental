// src/app/api/fundamental/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateFundamentalReport } from '@/lib/fundamental/generateReport';

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json();
    if (!ticker) return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });

    const report = await generateFundamentalReport(ticker.toUpperCase());
    return NextResponse.json({ report });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
