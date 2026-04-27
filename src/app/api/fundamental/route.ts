// src/app/api/fundamental/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateFundamentalReport } from '@/lib/fundamental/generateReport';

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json();
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    const report = await generateFundamentalReport(ticker.toUpperCase());
    return NextResponse.json({ report });
  } catch (e: any) {
    // Log full error to Vercel logs for debugging
    console.error('Fundamental API error:', e);
    // Return the actual error message to the client
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
