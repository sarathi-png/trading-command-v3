/**
 * The contract between the Pine evaluator and the built-in namespaces.
 *
 * Built-ins need a few services from the runtime (recording plots, firing
 * alerts, talking to the strategy simulator). Declaring them here keeps
 * builtins.ts free of any dependency on the evaluator and makes the whole
 * runtime testable in isolation.
 */
import type { PineDrawing, PineValue } from "./values";
import type { BarData } from "./ta";

export interface PineInput {
  /** Stable id, e.g. "input.int_3" — also the key used for overrides. */
  id: string;
  title: string;
  type: "int" | "float" | "bool" | "string" | "color" | "source" | "timeframe" | "price" | "time" | "session";
  defval: PineValue;
  value: PineValue;
  minval?: number;
  maxval?: number;
  step?: number;
  options?: string[];
}

export interface PinePlotCall {
  title: string;
  color: PineValue;
  style: string;
  linewidth: number;
  value: PineValue;
  barIndex: number;
  time: number;
}

export interface PineShapeCall {
  title: string;
  shape: string;
  location: string;
  color: PineValue;
  text: string;
  barIndex: number;
  time: number;
  price: number | null;
}

export interface PineAlertConditionCall {
  title: string;
  message: string;
  value: boolean;
  barIndex: number;
  time: number;
}

export interface PineAlertEvent {
  title: string;
  message: string;
  barIndex: number;
  time: number;
  price: number | null;
}

export interface PineHost {
  /** Record an `input.*` declaration so the app can offer an override. */
  recordInput(input: PineInput): void;
  /** Current value of an input (override applied by the host). */
  inputValue(id: string, fallback: PineValue): PineValue;
  recordPlot(plot: PinePlotCall): void;
  recordShape(shape: PineShapeCall): void;
  recordHLine(line: { value: number; title: string; color: PineValue }): void;
  recordAlertCondition(condition: PineAlertConditionCall): void;
  recordAlert(alert: PineAlertEvent): void;
  /** Record a drawing object (box, label, table) so the app can draw it. */
  recordDrawing(drawing: PineDrawing): void;
  /** `strategy.*` entry point — implemented by the order simulator. */
  strategyCall(name: string, args: PineValue[], named: Map<string, PineValue>): PineValue;
  /** `request.security(...)` — only same-timeframe requests are supported. */
  securityCall(timeframe: string, expression: PineValue): PineValue;
  bar(): BarData;
  /** The time of the bar before the current one, or null on the first bar. */
  previousBarTime(): number | null;
  barIndex(): number;
  lastBarIndex(): number;
  symbol(): string;
  timeframe(): string;
}
