"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { fmtPrice } from "@/lib/format";
import type { AiContext } from "@/lib/ai/types";

/** A public audit trace, not a claim to expose a model's internal thoughts. */
export function TechnicalReasoning({ context }: { context: AiContext }) {
  useDisplayCurrency();
  const technical = context.technical;
  if (!technical) return null;
  const { indicators, patterns, strategies } = technical;
  const number = (n: number | null | undefined) =>
    n == null
      ? "warming up / unavailable"
      : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return (
    <details
      className="border border-edge rounded p-2 text-[11px] text-mut"
      open
    >
      <summary className="cursor-pointer text-ink">
        Pattern recognition · reasoning checks · memory
      </summary>
      <div className="space-y-3 pt-2">
        <p>
          Source: {context.dataSource ?? "unknown"} · {technical.basis} ·{" "}
          {technical.version}. These are rule matches, not visual predictions.
          Heikin-Ashi smoothing is not used for pattern geometry.
        </p>
        <div>
          <h4 className="text-ink">Latest closed-candle patterns</h4>
          {patterns.length ? (
            <ul className="space-y-1">
              {patterns.map((p) => (
                <li key={p.name}>
                  <strong>
                    {p.name} · {p.bias}
                  </strong>
                  <br />
                  {p.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No supported pattern matches the latest closed candles with the
              required prior trend.
            </p>
          )}
        </div>
        <details>
          <summary className="cursor-pointer text-accent">
            Indicator values (full names)
          </summary>
          <ul className="space-y-1 pt-1">
            {[9, 21, 50, 200].map((p) => (
              <li key={p}>
                Exponential Moving Average {p}: {fmtPrice(indicators.ema[p])}
              </li>
            ))}
            <li>
              Volume Weighted Average Price: {fmtPrice(indicators.vwap)} ·{" "}
              {indicators.vwapAnchor}
            </li>
            <li>Relative Strength Index 14: {number(indicators.rsi14)}</li>
            <li>
              Average Directional Index 14: {number(indicators.adx14)}{" "}
              (strength, not direction)
            </li>
            <li>
              Moving Average Convergence Divergence 12/26/9:{" "}
              {fmtPrice(indicators.macd?.line)} · signal{" "}
              {fmtPrice(indicators.macd?.signal)} · histogram{" "}
              {fmtPrice(indicators.macd?.histogram)}
            </li>
            <li>
              Bollinger Bands 20, 2 standard deviations:{" "}
              {fmtPrice(indicators.bollinger?.lower)} —{" "}
              {fmtPrice(indicators.bollinger?.middle)} —{" "}
              {fmtPrice(indicators.bollinger?.upper)}
            </li>
          </ul>
        </details>
        <details>
          <summary className="cursor-pointer text-accent">
            Strategy checklists · why / why not
          </summary>
          <div className="space-y-2 pt-1">
            {strategies.map((s) => (
              <div key={s.name}>
                <strong>
                  {s.name} ·{" "}
                  {s.direction === "NEUTRAL"
                    ? "not qualified"
                    : `${s.direction} conditions met (not an order)`}
                </strong>
                <ul>
                  {s.checks.map((c) => (
                    <li key={c.rule}>
                      {c.passed === null
                        ? "? Missing"
                        : c.passed
                          ? "✓ Pass"
                          : "✕ Fail"}{" "}
                      · {c.rule}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
        <div>
          <h4 className="text-ink">Recorded memory · not model training</h4>
          {context.memory ? (
            <>
              <p>
                {context.memory.matching} comparable, non-overlapping prior
                calls: {context.memory.correct} moved as called ·{" "}
                {context.memory.wrong} against · {context.memory.noMove} no
                meaningful move.
              </p>
              <p>{context.memory.note}</p>
            </>
          ) : (
            <p>No comparable stored history yet.</p>
          )}
          {!!context.memory?.examples.length && (
            <p>Example record IDs: {context.memory.examples.join(", ")}</p>
          )}
          <p>
            Matches require the same symbol, timeframe, chart type, data source
            and rule version. Memory is bounded to the last 500 saved calls; it
            does not change weights or raise certainty. Local storage on
            serverless hosts can disappear on restart; use a durable data
            directory for lasting memory.
          </p>
        </div>
        <ul className="text-dim">
          {technical.cautions.map((c) => (
            <li key={c}>• {c}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
