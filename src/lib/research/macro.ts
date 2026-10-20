/**
 * Research data (macro + news).
 *
 * Hard rule: this module never invents a number or a headline. A provider is
 * either configured and answers with a source + timestamp, or the response says
 * `available: false` with a reason the UI can display verbatim.
 *
 * FRED is the only macro provider wired in. It is env-gated because a key is
 * required; news is intentionally not wired to any scraper — there is no
 * license-clean, key-free source that we can honestly label.
 */
import { cached } from "@/lib/cache";

export interface MacroPoint {
  date: string;
  value: number | null;
}

export interface MacroSeries {
  id: string;
  title: string;
  unit: string;
  source: string;
  asOf: string | null;
  points: MacroPoint[];
  available: true;
}

export interface Unavailable {
  available: false;
  reason: string;
}

export interface ResearchEnvelope {
  macro: MacroSeries[] | Unavailable;
  news: Unavailable;
  fetchedAt: string;
}

const SERIES: Array<{ id: string; title: string; unit: string }> = [
  { id: "FEDFUNDS", title: "Fed funds rate", unit: "%" },
  { id: "DGS10", title: "10-year Treasury", unit: "%" },
  { id: "CPIAUCSL", title: "CPI (all urban)", unit: "index" },
];

const NEWS_UNAVAILABLE: Unavailable = {
  available: false,
  reason: "News is unavailable: no licensed provider is configured. Headlines are never generated.",
};

const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8_000;

async function fetchSeries(
  meta: { id: string; title: string; unit: string },
  key: string
): Promise<MacroSeries> {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", meta.id);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "90");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`FRED ${meta.id} responded ${response.status}`);
  }
  const body = (await response.json()) as {
    observations?: Array<{ date?: string; value?: string }>;
  };
  const points = (body.observations ?? [])
    .filter((o) => typeof o.date === "string")
    .map((o) => ({
      date: o.date as string,
      // FRED uses "." for a missing observation. Preserve it as null rather
      // than coercing it to zero.
      value: o.value === undefined || o.value === "." ? null : Number(o.value),
    }))
    .filter((p) => p.value === null || Number.isFinite(p.value));

  return {
    id: meta.id,
    title: meta.title,
    unit: meta.unit,
    source: "FRED (St. Louis Fed)",
    asOf: points[0]?.date ?? null,
    points,
    available: true,
  };
}

export async function getResearch(): Promise<ResearchEnvelope> {
  const key = process.env.FRED_API_KEY?.trim();
  const fetchedAt = new Date().toISOString();

  if (!key) {
    return {
      macro: {
        available: false,
        reason: "Macro data is unavailable: FRED_API_KEY is not configured on this deployment.",
      },
      news: NEWS_UNAVAILABLE,
      fetchedAt,
    };
  }

  try {
    const macro = await cached("research:fred", TTL_MS, () =>
      Promise.all(SERIES.map((meta) => fetchSeries(meta, key)))
    );
    return {
      macro,
      news: NEWS_UNAVAILABLE,
      fetchedAt,
    };
  } catch (e) {
    return {
      macro: {
        available: false,
        reason: `Macro data is unavailable: ${
          e instanceof Error ? e.message : "the provider did not answer"
        }.`,
      },
      news: NEWS_UNAVAILABLE,
      fetchedAt,
    };
  }
}
