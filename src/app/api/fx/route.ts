import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Free, no-API-key exchange rates (open.er-api.com, updated daily).
// Returns a map of currency -> value of 1 unit of that currency IN the base
// currency, which matches how the app stores/uses rates.
// GET /api/fx?base=INR
export async function GET(req: NextRequest) {
  const base = (new URL(req.url).searchParams.get('base') || 'INR').toUpperCase();
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
      next: { revalidate: 3600 }, // cache 1h
    });
    const j = await r.json();
    if (j?.result !== 'success' || !j?.rates) {
      return NextResponse.json({ ok: false, base, rates: {}, error: 'rate source unavailable' });
    }
    // j.rates[ccy] = how many `ccy` per 1 base → value of 1 ccy in base = 1 / that.
    const rates: Record<string, number> = {};
    for (const [ccy, perBase] of Object.entries(j.rates)) {
      const v = Number(perBase);
      if (v > 0) rates[ccy] = 1 / v;
    }
    rates[base] = 1;
    return NextResponse.json({ ok: true, base, rates, updated: j.time_last_update_utc ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, base, rates: {}, error: String(e) });
  }
}
