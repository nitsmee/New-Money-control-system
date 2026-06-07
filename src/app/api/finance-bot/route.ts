import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ============================================================
// OPTIONAL LLM fallback for the Finance Bot.
//
// This route is DISABLED by default — the app stays 100% free.
// It only does anything if you set ONE of the supported provider
// keys in your environment (e.g. Vercel project env vars). With no
// key, it returns { configured: false } and the bot falls back to
// its powerful built-in local engine.
//
// Providers (checked in this order — FREE options first):
//   1. GROQ_API_KEY      → Groq (OpenAI-compatible). Free tier.
//                          Model via GROQ_MODEL (default llama-3.3-70b-versatile).
//   2. GEMINI_API_KEY    → Google Gemini. Free tier.
//                          Model via GEMINI_MODEL (default gemini-1.5-flash).
//   3. ANTHROPIC_API_KEY → Claude (paid). Model via ANTHROPIC_MODEL.
//
// Response shape is always { configured: boolean, answer?, error? }.
// On any provider error we return { configured: true, error } so the
// client transparently falls back to the local engine.
// Privacy: only the aggregate financial summary the client sends
// is forwarded. No passwords/credentials exist in that payload.
// ============================================================

const SYSTEM_PROMPT = `You are "Finance Bot", the assistant inside a personal finance web app called Money Control System (MCS).

Your job: help the user understand their money and use the app, using ONLY the financial context provided in the user message.

Rules:
- Answer from the provided context. If a fact isn't in the context, say you don't have that information rather than guessing.
- NEVER reveal, request, or speculate about passwords, PINs, OTPs, card numbers, or any security credentials. If asked, refuse in one short line.
- Affordability questions: reason from the numbers (savings pool, monthly surplus = true income − expenses). Give a clear Yes/No, the gap or leftover, a rough timeline if saving toward it, and 2-3 practical tips. Add a one-line "not financial advice" disclaimer.
- "How do I…" app questions: give short numbered steps. The app has these pages: Dashboard, Transactions, Income, Recurring Income, Budget, Goals, Reports, Alerts, Settings. Transactions has an "Add Transaction" button, an "Import CSV" button, and a quick-add ➕ button.
- Be concise and friendly. Use the ₹ symbol (or the user's currency) for amounts. Prefer short paragraphs and bullet points.
- You are not a licensed financial advisor.`;

// ---- Provider response typings (only the fields we read) ----
interface GroqResponse { choices?: Array<{ message?: { content?: string } }> }
interface GeminiResponse { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
interface AnthropicResponse { content?: Array<{ text?: string }> }

// Each provider returns the assistant's answer text, or throws on any
// transport/API error so the caller can report { configured: true, error }.
async function callGroq(key: string, ctx: string, question: string): Promise<string> {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${ctx}\n\nQuestion: ${question}` },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`Groq API error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data: GroqResponse = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(key: string, ctx: string, question: string): Promise<string> {
  // Google retires model names over time (e.g. gemini-1.5-flash → 2.0/2.5).
  // Try the configured model first, then current free-tier flash models, so
  // the bot self-heals across renames. We only advance to the next candidate
  // on a 404 (model-not-found); other errors stop and surface.
  const candidates = Array.from(new Set([
    process.env.GEMINI_MODEL,
    'gemini-2.0-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
  ].filter(Boolean))) as string[];

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: `${ctx}\n\nQuestion: ${question}` }] }],
  });

  let lastErr = 'no model available';
  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    if (resp.ok) {
      const data: GeminiResponse = await resp.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
    lastErr = `${resp.status}: ${(await resp.text()).slice(0, 200)}`;
    if (resp.status !== 404) break; // real error (bad key, quota…) — stop trying
  }
  throw new Error(`Gemini API error ${lastErr}`);
}

async function callAnthropic(key: string, ctx: string, question: string): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: 1024,
      // Prompt caching on the system block keeps repeat calls cheap/fast.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: `${ctx}\n\nQuestion: ${question}` },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`Claude API error ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data: AnthropicResponse = await resp.json();
  return data.content?.[0]?.text ?? '';
}

export async function POST(req: NextRequest) {
  // Pick the first configured provider, preferring FREE options.
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!groqKey && !geminiKey && !anthropicKey) {
    return NextResponse.json({ configured: false });
  }

  let body: { question?: string; context?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ configured: true, error: 'invalid request body' }, { status: 400 });
  }

  const { question, context } = body;
  if (!question || typeof question !== 'string') {
    return NextResponse.json({ configured: true, error: 'missing question' }, { status: 400 });
  }
  const ctx = context || '(no context provided)';

  try {
    let answer: string;
    if (groqKey) {
      answer = await callGroq(groqKey, ctx, question);
    } else if (geminiKey) {
      answer = await callGemini(geminiKey, ctx, question);
    } else {
      answer = await callAnthropic(anthropicKey as string, ctx, question);
    }
    return NextResponse.json({ configured: true, answer });
  } catch (e) {
    // Surface the error so the client transparently falls back to local.
    return NextResponse.json({ configured: true, error: String(e) }, { status: 200 });
  }
}
