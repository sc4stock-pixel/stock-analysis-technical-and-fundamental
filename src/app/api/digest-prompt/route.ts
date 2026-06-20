import { NextResponse } from "next/server";
import { generateDigestPrompt } from "@/lib/digest/generateDigestPrompt";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await generateDigestPrompt();
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[/api/digest-prompt]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
