// src/app/api/fundamental/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateFundamentalPrompts } from '@/lib/fundamental/generateReport';

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json();
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    }

    const prompts = await generateFundamentalPrompts(ticker.toUpperCase());
    return NextResponse.json({ prompts });
  } catch (e: any) {
    console.error('Fundamental API error:', e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
