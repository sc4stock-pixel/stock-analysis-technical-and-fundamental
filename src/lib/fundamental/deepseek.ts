// src/lib/fundamental/deepseek.ts
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!; // store in Vercel env vars
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

export async function deepseekChat(prompt: string, system?: string): Promise<string> {
  const messages: any[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.3,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${err}`);
  }

  const json = await res.json();
  return json.choices[0].message.content;
}
