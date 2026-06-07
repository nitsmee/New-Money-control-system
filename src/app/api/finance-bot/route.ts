import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ============================================================
// OPTIONAL Claude API fallback for the Finance Bot.
//
// This route is DISABLED by default — the app stays 100% free.
// It only does anything if you set ANTHROPIC_API_KEY in your
// environment (e.g. Vercel project env vars). With no key, it
// returns { configured: false } and the bot falls back to its
// powerful built-in local engine.
//
// Model is overridable via ANTHROPIC_MODEL.
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

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
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

  try {
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
          {
            role: 'user',
            content: `Financial context:\n${context || '(no context provided)'}\n\nUser question: ${question}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return NextResponse.json(
        { configured: true, error: `Claude API error ${resp.status}`, detail: detail.slice(0, 300) },
        { status: 200 }
      );
    }

    const data = await resp.json();
    const answer = data?.content?.[0]?.text ?? null;
    return NextResponse.json({ configured: true, answer });
  } catch (e) {
    return NextResponse.json({ configured: true, error: String(e) }, { status: 200 });
  }
}
