/**
 * Pine Script evaluator.
 *
 * The program is executed once per bar, exactly like TradingView does it:
 * every bar re-runs the whole script, `var` variables carry their value
 * forward, and the ta.* / strategy.* namespaces are stateful.
 *
 * Series history (`close[1]`, `x[2]`) is resolved from three sources:
 *   - the bar array for market series (open/high/low/close/volume/...),
 *   - a per-variable history for global variables,
 *   - a per-call-site history for function parameters.
 */
import {
  type Block, type CallExpr, type Expression, type FunctionDecl, type ProgramNode,
  type Statement, type TupleAssignStmt, type VarDecl,
} from "./ast";
import {
  type BuiltinContext, type BuiltinFn, type NamespaceEntry, NAMESPACES, isBuiltinFn,
} from "./builtins";
import type {
  PineAlertConditionCall, PineAlertEvent, PineHost, PineInput, PinePlotCall, PineShapeCall,
} from "./host";
import { type BarData, type StreamContext, TA_FUNCTIONS } from "./ta";
import { StrategySimulator, type StrategyStats, type StrategyTrade, strategyNamespace } from "./strategy";
import {
  type PineValue, isBoundMethod, isCallable, isProperty, toBoolean, toDisplayString, toNumber,
  truthy, type PineBoundMethod, type PineCallable, type PineObject, type PineProperty,
} from "./values";

export interface PineError {
  message: string;
  line?: number;
}

export interface PinePlotPoint {
  time: number;
  value: number;
}

export interface PinePlotResult {
  title: string;
  color: string;
  style: string;
  linewidth: number;
  points: PinePlotPoint[];
}

export interface PineShapeResult {
  title: string;
  shape: string;
  location: string;
  color: string;
  text: string;
  time: number;
  barIndex: number;
  price: number | null;
}

export interface PineHLine {
  value: number;
  title: string;
  color: string;
}

export interface PineRunOptions {
  symbol?: string;
  timeframe?: string;
  /** Overrides for `input.*` values, keyed by input id. */
  inputOverrides?: Record<string, PineValue>;
}

export interface PineRunResult {
  ok: boolean;
  meta: {
    title: string;
    shorttitle: string;
    type: "indicator" | "strategy" | "library" | "script";
    overlay: boolean;
  };
  inputs: PineInput[];
  plots: PinePlotResult[];
  shapes: PineShapeResult[];
  hlines: PineHLine[];
  alerts: PineAlertEvent[];
  alertConditions: { title: string; message: string; active: boolean; time: number }[];
  trades: StrategyTrade[];
  stats: StrategyStats | null;
  errors: PineError[];
  warnings: string[];
  barCount: number;
}

/* ------------------------------------------------------------------ */
/* Runtime markers                                                     */
/* ------------------------------------------------------------------ */

interface NamespaceMarker {
  __namespace: string;
}

interface MethodMarker {
  __method: BuiltinFn;
}

const MARKET_SERIES = new Set([
  "open", "high", "low", "close", "volume", "time", "time_close",
  "hl2", "hlc3", "ohlc4", "hlcc4",
]);

const isNamespace = (value: PineValue): value is PineValue & NamespaceMarker =>
  !!value && typeof value === "object" && !Array.isArray(value) && "__namespace" in value;

const isMethodMarker = (value: PineValue): value is PineValue & MethodMarker =>
  !!value && typeof value === "object" && !Array.isArray(value) && "__method" in value;

const isPlainObject = (value: PineValue): value is PineObject =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !("r" in value) &&
  !("__namespace" in value);

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

interface Scope {
  vars: Map<string, PineValue>;
  parent: Scope | null;
  /** Function parameters, for series history inside a function body. */
  params?: Set<string>;
  /** The call site that produced this frame (for parameter history). */
  callSite?: number;
  /** The value of the last expression statement — the function's return value. */
  result?: PineValue;
}

function createScope(parent: Scope | null, params?: Set<string>, callSite?: number): Scope {
  return { vars: new Map(), parent, params, callSite };
}

/* ------------------------------------------------------------------ */
/* Registries                                                          */
/* ------------------------------------------------------------------ */

interface PlotSlot {
  title: string;
  color: PineValue;
  style: string;
  linewidth: number;
  points: PinePlotPoint[];
  lastBar: number;
}

interface ShapeSlot {
  title: string;
  shape: string;
  location: string;
  color: PineValue;
  text: string;
  time: number;
  barIndex: number;
  price: number | null;
}

interface HLineSlot {
  value: number;
  title: string;
  color: PineValue;
}

/* ------------------------------------------------------------------ */

export class PineEvaluator implements PineHost {
  private program: ProgramNode;
  private options: PineRunOptions;

  private globals = new Map<string, PineValue>();
  private globalHistory = new Map<string, PineValue[]>();
  /** The bar each variable's history was last written on. */
  private historyBar = new Map<string, number>();
  private functions = new Map<string, FunctionDecl>();
  private namespaces: Record<string, Record<string, NamespaceEntry>>;
  private sim = new StrategySimulator();

  /** Per call-site state for the streaming indicators. */
  private streams = new Map<number, Map<string, unknown>>();
  private callHistories = new Map<number, Map<string, PineValue[]>>();
  private callHistoryBar = new Map<number, number>();

  private plots = new Map<string, PlotSlot>();
  private plotOrder: string[] = [];
  private shapes: ShapeSlot[] = [];
  private hlines: HLineSlot[] = [];
  private inputs = new Map<string, PineInput>();
  private alerts: PineAlertEvent[] = [];
  private alertConditions = new Map<string, PineAlertConditionCall>();
  private warnings: string[] = [];
  private errors: PineError[] = [];

  private bars: BarData[] = [];
  private barIndexValue = 0;
  private lastBarIndexValue = 0;
  private currentBar: BarData = { time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 };
  private globalScope: Scope = createScope(null);

  constructor(program: ProgramNode, options: PineRunOptions = {}) {
    this.program = program;
    this.options = options;
    this.namespaces = {
      ...NAMESPACES,
      strategy: strategyNamespace(this.sim) as unknown as Record<string, NamespaceEntry>,
      ta: this.buildTaNamespace(),
    };
  }

  /**
   * `ta.*` indicators are stateful, so each one is wrapped in a function
   * that receives a stream context bound to the CALL SITE of the call.
   */
  private buildTaNamespace(): Record<string, NamespaceEntry> {
    const namespace: Record<string, NamespaceEntry> = {};
    for (const [name, fn] of Object.entries(TA_FUNCTIONS)) {
      namespace[name] = (args: PineValue[], ctx: BuiltinContext): PineValue =>
        fn(args, this.streamFor(ctx.site), ctx.named);
    }
    return namespace;
  }

  private streamFor(site: number): StreamContext {
    return {
      site,
      barIndex: this.barIndexValue,
      lastBarIndex: this.lastBarIndexValue,
      bar: this.currentBar,
      prevClose: this.barIndexValue > 0 ? this.bars[this.barIndexValue - 1].close : undefined,
      bars: this.bars.slice(0, this.barIndexValue + 1),
      state: <T,>(name: string, create: () => T): T => {
        const siteStates = this.streams.get(site) ?? new Map<string, unknown>();
        if (!siteStates.has(name)) {
          const created = create();
          (created as { lastBar?: number }).lastBar = this.barIndexValue;
          siteStates.set(name, created);
          this.streams.set(site, siteStates);
        }
        const state = siteStates.get(name) as T;
        (state as { lastBar?: number }).lastBar = this.barIndexValue;
        return state;
      },
    };
  }

  /* ---------------- host interface ---------------- */

  recordInput(input: PineInput): void {
    const existing = this.inputs.get(input.id);
    if (existing) {
      existing.value = input.value;
      return;
    }
    this.inputs.set(input.id, input);
  }

  inputValue(id: string, fallback: PineValue): PineValue {
    const override = this.options.inputOverrides?.[id];
    if (override !== undefined) return override;
    return fallback;
  }

  recordPlot(plot: PinePlotCall): void {
    const value = toNumber(plot.value);
    const existing = this.plots.get(plot.title);
    if (existing) {
      existing.lastBar = this.barIndexValue;
      existing.points.push({ time: plot.time, value: value === null ? Number.NaN : value });
      return;
    }
    this.plots.set(plot.title, {
      title: plot.title,
      color: plot.color,
      style: plot.style,
      linewidth: plot.linewidth,
      points: [{ time: plot.time, value: value === null ? Number.NaN : value }],
      lastBar: this.barIndexValue,
    });
    this.plotOrder.push(plot.title);
  }

  recordShape(shape: PineShapeCall): void {
    this.shapes.push({
      title: shape.title,
      shape: shape.shape,
      location: shape.location,
      color: shape.color,
      text: shape.text,
      time: shape.time,
      barIndex: shape.barIndex,
      price: shape.price,
    });
  }

  recordHLine(line: { value: number; title: string; color: PineValue }): void {
    this.hlines.push(line);
  }

  recordAlertCondition(condition: PineAlertConditionCall): void {
    this.alertConditions.set(condition.title, condition);
  }

  recordAlert(alert: PineAlertEvent): void {
    this.alerts.push(alert);
  }

  strategyCall(name: string, args: PineValue[], named: Map<string, PineValue>): PineValue {
    const entry = this.namespaces.strategy[name];
    if (!entry) {
      this.warnings.push(`strategy.${name} is not supported by this runtime.`);
      return null;
    }
    if (!isBuiltinFn(entry)) return null;
    return entry(args, {
      site: 0,
      named,
      host: this,
      nextId: (prefix) => `${prefix}_${name}`,
    });
  }

  securityCall(timeframe: string, expression: PineValue): PineValue {
    if (timeframe && timeframe !== this.options.timeframe) {
      this.warnings.push(
        `request.security("${timeframe}") is not supported: only the chart timeframe can be requested.`
      );
    }
    return expression;
  }

  bar(): BarData {
    return this.currentBar;
  }

  barIndex(): number {
    return this.barIndexValue;
  }

  lastBarIndex(): number {
    return this.lastBarIndexValue;
  }

  symbol(): string {
    return this.options.symbol ?? "";
  }

  timeframe(): string {
    return this.options.timeframe ?? "5";
  }

  /* ---------------- running ---------------- */

  run(bars: BarData[]): PineRunResult {
    this.bars = bars;
    this.lastBarIndexValue = Math.max(0, bars.length - 1);
    this.collectDeclarations();

    for (let index = 0; index < bars.length; index++) {
      this.barIndexValue = index;
      this.currentBar = bars[index];
      this.sim.setBar(bars[index], index, this.lastBarIndexValue);
      this.sim.beginBar();
      try {
        this.executeBlock(this.program.body, this.globalScope);
      } catch (error) {
        this.errors.push({
          message: error instanceof Error ? error.message : String(error),
        });
        break;
      }
      this.sim.endBar();
      this.padPlots();
      this.padStreams();
    }
    this.sim.finish();

    return {
      ok: this.errors.length === 0,
      meta: this.readMeta(),
      inputs: [...this.inputs.values()],
      plots: this.plotOrder
        .map((title) => this.plots.get(title))
        .filter((plot): plot is PlotSlot => !!plot)
        .map((plot) => ({
          title: plot.title,
          color: toDisplayString(plot.color),
          style: plot.style,
          linewidth: plot.linewidth,
          points: plot.points.filter((point) => Number.isFinite(point.value)),
        })),
      shapes: this.shapes.map((shape) => ({
        title: shape.title,
        shape: shape.shape,
        location: shape.location,
        color: toDisplayString(shape.color),
        text: shape.text,
        time: shape.time,
        barIndex: shape.barIndex,
        price: shape.price,
      })),
      hlines: this.hlines.map((line) => ({
        value: line.value,
        title: line.title,
        color: toDisplayString(line.color),
      })),
      alerts: this.alerts,
      alertConditions: [...this.alertConditions.values()].map((condition) => ({
        title: condition.title,
        message: condition.message,
        active: condition.value,
        time: condition.time,
      })),
      trades: this.sim.closedTrades,
      stats: this.sim.stats(),
      errors: this.errors,
      warnings: [...new Set(this.warnings)],
      barCount: bars.length,
    };
  }

  /** First pass: register functions. */
  private collectDeclarations(): void {
    for (const statement of this.program.body.statements) {
      if (statement.kind === "function") this.functions.set(statement.name, statement);
    }
  }

  private readMeta() {
    const declaration = this.program.declaration;
    const meta = {
      title: "Untitled script",
      shorttitle: "",
      type: "script" as "indicator" | "strategy" | "library" | "script",
      overlay: false,
    };
    if (!declaration) return meta;
    const read = (name: string, position = -1): PineValue => {
      const found = declaration.args.find((arg) => arg.name === name);
      if (found) return this.evalExpression(found.value, this.globalScope);
      if (position >= 0) {
        const positional = declaration.args[position];
        if (positional && !positional.name) return this.evalExpression(positional.value, this.globalScope);
      }
      return null;
    };
    const title = read("title", 0);
    const shorttitle = read("shorttitle", 1);
    const overlay = read("overlay");
    meta.type = declaration.type;
    if (typeof title === "string") meta.title = title;
    if (typeof shorttitle === "string") meta.shorttitle = shorttitle;
    meta.overlay = toBoolean(overlay) || meta.type === "strategy";
    return meta;
  }

  /** Plots that were not touched on this bar get an `na` point. */
  private padPlots(): void {
    for (const plot of this.plots.values()) {
      if (plot.lastBar === this.barIndexValue) continue;
      plot.points.push({ time: this.currentBar.time, value: Number.NaN });
    }
  }

  /**
   * Window-based indicator states are padded with `na` when their call site
   * did not execute on this bar, so a window always covers exactly the bars
   * it should.
   */
  private padStreams(): void {
    for (const stateMap of this.streams.values()) {
      for (const state of stateMap.values()) {
        const holder = state as {
          window?: { push(value: null): void };
          pending?: PineValue[];
          lastBar?: number;
        };
        if (holder.lastBar === this.barIndexValue) continue;
        if (holder.window && typeof holder.window.push === "function") holder.window.push(null);
        else if (Array.isArray(holder.pending)) holder.pending.push(null);
      }
    }
  }

  /* ---------------- statements ---------------- */

  private executeBlock(block: Block, scope: Scope): void {
    for (const statement of block.statements) {
      this.executeStatement(statement, scope);
    }
  }

  private executeStatement(statement: Statement, scope: Scope): void {
    switch (statement.kind) {
      case "varDecl":
        this.executeVarDecl(statement, scope);
        return;
      case "assign":
        this.executeAssign(statement, scope);
        return;
      case "tupleAssign":
        this.executeTupleAssign(statement, scope);
        return;
      case "if":
        this.executeIf(statement, scope);
        return;
      case "for":
        this.executeFor(statement, scope);
        return;
      case "while":
        this.executeWhile(statement, scope);
        return;
      case "exprStmt": {
        const value = this.evalExpression(statement.expression, scope);
        // The value of the last expression statement is a function's result.
        if (scope.callSite !== undefined) scope.result = value;
        return;
      }
      case "function":
        this.functions.set(statement.name, statement);
        return;
      default:
        return;
    }
  }

  private executeVarDecl(declaration: VarDecl, scope: Scope): void {
    if (scope === this.globalScope) {
      // `var` declares and INITIALISES a variable: the initializer runs on the
      // first bar only, and the value is kept afterwards. This is what makes
      // `var float entry = na` + `if cond\n    entry := close` work.
      const existing = this.globals.get(declaration.name);
      if (existing !== undefined && declaration.modifier) {
        this.pushGlobalHistory(declaration.name, existing);
        return;
      }
      const value = declaration.value ? this.evalExpression(declaration.value, scope) : null;
      this.globals.set(declaration.name, value);
      this.pushGlobalHistory(declaration.name, value);
      return;
    }
    const value = declaration.value ? this.evalExpression(declaration.value, scope) : null;
    scope.vars.set(declaration.name, value);
  }

  /**
   * Record a variable's value for the current bar. A variable written twice
   * in the same bar (a `var` declaration plus a later assignment) produces a
   * single history entry, so `x[1]` always means "the previous bar".
   */
  private pushGlobalHistory(name: string, value: PineValue): void {
    const history = this.globalHistory.get(name) ?? [];
    if (this.historyBar.get(name) === this.barIndexValue && history.length) {
      history[history.length - 1] = value;
    } else {
      history.push(value);
      this.historyBar.set(name, this.barIndexValue);
    }
    this.globalHistory.set(name, history);
  }

  /**
   * `[a, b, c] = f()` — the right-hand side must be a tuple. A mismatch is
   * reported as a runtime error rather than silently binding `na`.
   */
  private executeTupleAssign(statement: TupleAssignStmt, scope: Scope): void {
    const value = this.evalExpression(statement.value, scope);
    if (!Array.isArray(value)) {
      this.errors.push({
        message: `Cannot destructure a single value into ${statement.names.length} variables.`,
        line: statement.line,
      });
      return;
    }
    if (value.length !== statement.names.length) {
      this.errors.push({
        message: `Expected ${statement.names.length} values, got ${value.length}.`,
        line: statement.line,
      });
      return;
    }
    statement.names.forEach((name, index) => {
      this.assignTo({ kind: "ident", name, line: statement.line, col: statement.col }, value[index], scope);
    });
  }

  private executeAssign(statement: { target: Expression; value: Expression; op: string | null }, scope: Scope): void {
    const right = this.evalExpression(statement.value, scope);
    const value = statement.op
      ? this.applyBinary(statement.op, this.evalExpression(statement.target, scope), right)
      : right;
    this.assignTo(statement.target, value, scope);
  }

  private assignTo(target: Expression, value: PineValue, scope: Scope): void {
    if (target.kind === "ident") {
      if (scope.vars.has(target.name)) {
        scope.vars.set(target.name, value);
        return;
      }
      if (scope === this.globalScope) {
        this.globals.set(target.name, value);
        this.pushGlobalHistory(target.name, value);
        return;
      }
      scope.vars.set(target.name, value);
      return;
    }
    if (target.kind === "member") {
      const base = this.evalExpression(target.object, scope);
      if (isNamespace(base)) {
        const entry = this.namespaces[base.__namespace]?.[target.property];
        if (isProperty(entry)) {
          entry.set(value);
          return;
        }
        if (isBuiltinFn(entry)) {
          entry([value], {
            site: 0,
            named: new Map(),
            host: this,
            nextId: (prefix) => `${prefix}_${target.property}`,
          });
          return;
        }
      }
      throw new Error(`Cannot assign to '${target.property}'.`);
    }
    if (target.kind === "index") {
      const collection = this.evalExpression(target.object, scope);
      const index = Math.floor(toNumber(this.evalExpression(target.offset, scope)) ?? 0);
      if (Array.isArray(collection) && index >= 0 && index < collection.length) {
        collection[index] = value;
        return;
      }
    }
    throw new Error("Invalid assignment target.");
  }

  private executeIf(
    statement: { condition: Expression; then: Block; otherwise: Block | Statement | null },
    scope: Scope
  ): void {
    const condition = truthy(this.evalExpression(statement.condition, scope));
    if (condition) {
      this.executeBlock(statement.then, scope);
      return;
    }
    if (statement.otherwise) {
      if ((statement.otherwise as Statement).kind === "if") {
        this.executeIf(statement.otherwise as never, scope);
        return;
      }
      this.executeBlock(statement.otherwise as Block, scope);
    }
  }

  private executeFor(
    statement: { variable: string; from: Expression; to: Expression; by: Expression | null; body: Block },
    scope: Scope
  ): void {
    const from = Math.round(toNumber(this.evalExpression(statement.from, scope)) ?? 0);
    const to = Math.round(toNumber(this.evalExpression(statement.to, scope)) ?? 0);
    const by = statement.by ? Math.round(toNumber(this.evalExpression(statement.by, scope)) ?? 1) : 1;
    if (by === 0) return;
    let iterations = 0;
    for (let value = from; by > 0 ? value <= to : value >= to; value += by) {
      if (++iterations > 100_000) {
        this.warnings.push("A for loop exceeded 100000 iterations and was stopped.");
        break;
      }
      scope.vars.set(statement.variable, value);
      this.executeBlock(statement.body, scope);
    }
  }

  private executeWhile(statement: { condition: Expression; body: Block }, scope: Scope): void {
    let iterations = 0;
    while (truthy(this.evalExpression(statement.condition, scope))) {
      if (++iterations > 100_000) {
        this.warnings.push("A while loop exceeded 100000 iterations and was stopped.");
        break;
      }
      this.executeBlock(statement.body, scope);
    }
  }

  /* ---------------- expressions ---------------- */

  private evalExpression(node: Expression, scope: Scope): PineValue {
    switch (node.kind) {
      case "number":
        return node.value;
      case "string":
        return node.value;
      case "bool":
        return node.value;
      case "na":
        return null;
      case "ident":
        return this.evalIdentifier(node.name, node.line, scope);
      case "member":
        return this.evalMember(node.object, node.property, node.line, scope);
      case "call":
        return this.evalCall(node, scope);
      case "index":
        return this.evalIndex(node, scope);
      case "unary":
        return this.evalUnary(node, scope);
      case "binary":
        return this.applyBinary(node.op, this.evalExpression(node.left, scope), this.evalExpression(node.right, scope));
      case "ternary": {
        const condition = truthy(this.evalExpression(node.condition, scope));
        return condition
          ? this.evalExpression(node.whenTrue, scope)
          : this.evalExpression(node.whenFalse, scope);
      }
      case "tuple":
      case "array":
        return node.elements.map((element) => this.evalExpression(element, scope));
    }
  }

  private evalIdentifier(name: string, line: number, scope: Scope): PineValue {
    const local = this.lookup(scope, name);
    if (local !== undefined) return local;
    if (this.globals.has(name)) return this.globals.get(name) ?? null;
    if (MARKET_SERIES.has(name)) return this.marketSeries(name);
    if (name === "bar_index") return this.barIndexValue;
    if (name === "last_bar_index") return this.lastBarIndexValue;
    if (this.namespaces[name]) return { __namespace: name } as unknown as PineValue;
    this.errors.push({ message: `Unknown identifier '${name}'.`, line });
    return null;
  }

  private lookup(scope: Scope, name: string): PineValue | undefined {
    let current: Scope | null = scope;
    while (current) {
      if (current.vars.has(name)) return current.vars.get(name);
      current = current.parent;
    }
    return undefined;
  }

  private marketSeries(name: string): PineValue {
    const bar = this.currentBar;
    switch (name) {
      case "open": return bar.open;
      case "high": return bar.high;
      case "low": return bar.low;
      case "close": return bar.close;
      case "volume": return bar.volume;
      case "time": return bar.time;
      case "time_close": return bar.time;
      case "hl2": return (bar.high + bar.low) / 2;
      case "hlc3": return (bar.high + bar.low + bar.close) / 3;
      case "ohlc4": return (bar.open + bar.high + bar.low + bar.close) / 4;
      case "hlcc4": return (bar.high + bar.low + bar.close + bar.close) / 4;
      default: return null;
    }
  }

  private evalMember(object: Expression, property: string, line: number, scope: Scope): PineValue {
    const base = this.evalExpression(object, scope);

    if (isNamespace(base)) {
      const entry = this.namespaces[base.__namespace]?.[property];
      if (entry === undefined) {
        this.errors.push({ message: `Unknown function or variable '${base.__namespace}.${property}'.`, line });
        return null;
      }
      if (isProperty(entry)) return entry.get();
      if (isBuiltinFn(entry)) return { __method: entry } as unknown as PineValue;
      return entry as PineValue;
    }

    if (isCallable(base)) {
      const method = base.methods[property];
      if (!method) {
        this.errors.push({ message: `Unknown method '${property}'.`, line });
        return null;
      }
      const bound: PineBoundMethod = { __boundMethod: true, fn: (...args: PineValue[]) => method(...args) };
      return bound as unknown as PineValue;
    }

    if (isPlainObject(base)) {
      const entry = base[property] as PineValue | undefined;
      if (entry === undefined) {
        this.errors.push({ message: `Unknown property '${property}'.`, line });
        return null;
      }
      if (isProperty(entry)) return entry.get();
      if (isBuiltinFn(entry)) return { __method: entry } as unknown as PineValue;
      return entry;
    }

    this.errors.push({ message: `Cannot read '${property}' from this value.`, line });
    return null;
  }

  private evalCall(node: CallExpr, scope: Scope): PineValue {
    const named = new Map<string, PineValue>();
    const positional: PineValue[] = [];
    for (const arg of node.args) {
      const value = this.evalExpression(arg.value, scope);
      if (arg.name) named.set(arg.name, value);
      else positional.push(value);
    }

    // A callee that is a member of a namespace / object.
    if (node.callee.kind === "member") {
      const base = this.evalExpression(node.callee.object, scope);
      if (isNamespace(base)) {
        const entry = this.namespaces[base.__namespace]?.[node.callee.property];
        if (entry === undefined) {
          this.errors.push({ message: `Unknown function '${base.__namespace}.${node.callee.property}'.`, line: node.line });
          return null;
        }
        if (isProperty(entry)) {
          this.errors.push({ message: `'${base.__namespace}.${node.callee.property}' is a value, not a function.`, line: node.line });
          return null;
        }
        if (isBuiltinFn(entry)) {
          return this.invokeBuiltin(entry, positional, named, node.site, node.line);
        }
        if (isCallable(entry)) return entry.value;
      }
      if (isCallable(base)) {
        const method = base.methods[node.callee.property];
        if (method) return method(...positional);
        this.errors.push({ message: `Unknown method '${node.callee.property}'.`, line: node.line });
        return null;
      }
      if (isPlainObject(base)) {
        const entry = base[node.callee.property];
        if (isBuiltinFn(entry)) return this.invokeBuiltin(entry, positional, named, node.site, node.line);
        if (isProperty(entry)) {
          this.errors.push({ message: `'${node.callee.property}' is a value, not a function.`, line: node.line });
          return null;
        }
      }
    }

    // A callee that is a plain identifier: a user function, or a global builtin.
    if (node.callee.kind === "ident") {
      const name = node.callee.name;
      const userFunction = this.functions.get(name);
      if (userFunction) return this.callUserFunction(userFunction, positional, named, node.site);
      const globalBuiltin = GLOBAL_BUILTINS[name];
      if (globalBuiltin) return this.invokeBuiltin(globalBuiltin, positional, named, node.site, node.line);
      this.errors.push({ message: `Unknown function '${name}'.`, line: node.line });
      return null;
    }

    // A callee that evaluated to a method marker or a bound method.
    const resolved = this.evalExpression(node.callee, scope);
    if (isMethodMarker(resolved)) {
      return this.invokeBuiltin(resolved.__method, positional, named, node.site, node.line);
    }
    if (isBoundMethod(resolved)) {
      return resolved.fn(...positional);
    }
    if (isCallable(resolved)) return resolved.value;

    this.errors.push({ message: "This value cannot be called.", line: node.line });
    return null;
  }

  private invokeBuiltin(
    fn: BuiltinFn,
    positional: PineValue[],
    named: Map<string, PineValue>,
    site: number,
    line: number
  ): PineValue {
    const context: BuiltinContext = {
      site,
      named,
      host: this,
      nextId: (prefix) => `${prefix}_${site}`,
    };
    try {
      return fn(positional, context);
    } catch (error) {
      this.errors.push({
        message: error instanceof Error ? error.message : String(error),
        line,
      });
      return null;
    }
  }

  private callUserFunction(
    fn: FunctionDecl,
    positional: PineValue[],
    named: Map<string, PineValue>,
    site: number
  ): PineValue {
    const frame = createScope(this.globalScope, new Set(fn.params.map((param) => param.name)), site);
    let positionalIndex = 0;
    for (const param of fn.params) {
      let value: PineValue | undefined;
      if (named.has(param.name)) value = named.get(param.name) ?? null;
      else if (positionalIndex < positional.length) value = positional[positionalIndex++];
      else if (param.defaultValue) value = this.evalExpression(param.defaultValue, frame);
      else value = null;
      frame.vars.set(param.name, value);
    }

    // Remember the series history of the arguments at this call site, so
    // `param[1]` inside the body means "the value on the previous bar".
    if (this.callHistoryBar.get(site) !== this.barIndexValue) {
      this.callHistoryBar.set(site, this.barIndexValue);
      const histories = this.callHistories.get(site) ?? new Map<string, PineValue[]>();
      for (const param of fn.params) {
        const history = histories.get(param.name) ?? [];
        history.push(frame.vars.get(param.name) ?? null);
        if (history.length > 2000) history.splice(0, history.length - 2000);
        histories.set(param.name, history);
      }
      this.callHistories.set(site, histories);
    }

    this.executeBlock(fn.body, frame);
    return frame.result ?? null;
  }

  private evalIndex(node: { object: Expression; offset: Expression }, scope: Scope): PineValue {
    const object = node.object;
    const offset = Math.floor(toNumber(this.evalExpression(node.offset, scope)) ?? 0);

    if (object.kind === "ident" && MARKET_SERIES.has(object.name)) {
      const index = this.barIndexValue - offset;
      if (index < 0 || index >= this.bars.length) return null;
      const bar = this.bars[index];
      switch (object.name) {
        case "open": return bar.open;
        case "high": return bar.high;
        case "low": return bar.low;
        case "close": return bar.close;
        case "volume": return bar.volume;
        case "time": return bar.time;
        case "time_close": return bar.time;
        case "hl2": return (bar.high + bar.low) / 2;
        case "hlc3": return (bar.high + bar.low + bar.close) / 3;
        case "ohlc4": return (bar.open + bar.high + bar.low + bar.close) / 4;
        case "hlcc4": return (bar.high + bar.low + bar.close + bar.close) / 4;
        default: return null;
      }
    }

    if (object.kind === "ident") {
      // A function parameter: history comes from the call site.
      const paramHistory = this.findParamHistory(scope, object.name);
      if (paramHistory) {
        const index = paramHistory.length - 1 - offset;
        return index >= 0 ? paramHistory[index] : null;
      }
      // A global variable: history comes from the assignment log.
      const globalHistory = this.globalHistory.get(object.name);
      if (globalHistory) {
        const index = globalHistory.length - 1 - offset;
        return index >= 0 ? globalHistory[index] : null;
      }
    }

    const collection = this.evalExpression(object, scope);
    if (Array.isArray(collection)) {
      const index = collection.length - 1 - offset;
      return index >= 0 ? collection[index] : null;
    }
    this.errors.push({ message: "This value has no series history." });
    return null;
  }

  private findParamHistory(scope: Scope, name: string): PineValue[] | null {
    let current: Scope | null = scope;
    while (current) {
      if (current.params?.has(name) && current.callSite !== undefined) {
        return this.callHistories.get(current.callSite)?.get(name) ?? null;
      }
      current = current.parent;
    }
    return null;
  }

  private evalUnary(node: { op: "not" | "-" | "+"; argument: Expression }, scope: Scope): PineValue {
    const value = this.evalExpression(node.argument, scope);
    if (node.op === "not") return !truthy(value);
    const numeric = toNumber(value);
    if (numeric === null) return null;
    return node.op === "-" ? -numeric : numeric;
  }

  private applyBinary(op: string, left: PineValue, right: PineValue): PineValue {
    switch (op) {
      case "and": return truthy(left) && truthy(right);
      case "or": return truthy(left) || truthy(right);
      case "==": return this.looseEqual(left, right);
      case "!=": return !this.looseEqual(left, right);
      case "+": {
        if (typeof left === "string" || typeof right === "string") {
          return toDisplayString(left) + toDisplayString(right);
        }
        const a = toNumber(left);
        const b = toNumber(right);
        return a === null || b === null ? null : a + b;
      }
      case "-": {
        const a = toNumber(left);
        const b = toNumber(right);
        return a === null || b === null ? null : a - b;
      }
      case "*": {
        const a = toNumber(left);
        const b = toNumber(right);
        return a === null || b === null ? null : a * b;
      }
      case "/": {
        const a = toNumber(left);
        const b = toNumber(right);
        if (a === null || b === null) return null;
        return b === 0 ? null : a / b;
      }
      case "%": {
        const a = toNumber(left);
        const b = toNumber(right);
        if (a === null || b === null) return null;
        return b === 0 ? null : a % b;
      }
      case "<": case ">": case "<=": case ">=": {
        const a = toNumber(left);
        const b = toNumber(right);
        if (a === null || b === null) return null;
        if (op === "<") return a < b;
        if (op === ">") return a > b;
        if (op === "<=") return a <= b;
        return a >= b;
      }
      default:
        return null;
    }
  }

  private looseEqual(left: PineValue, right: PineValue): boolean {
    if (left === null || right === null) return false;
    if (typeof left === "number" && typeof right === "number") return left === right;
    if (typeof left === "string" && typeof right === "string") return left === right;
    if (typeof left === "boolean" && typeof right === "boolean") return left === right;
    return toDisplayString(left) === toDisplayString(right);
  }
}

/* ------------------------------------------------------------------ */
/* Global built-in statements (plot, plotshape, alert, ...)            */
/* ------------------------------------------------------------------ */

function plotBuiltin(args: PineValue[], ctx: BuiltinContext): PineValue {
  const host = ctx.host;
  const value = args[0] ?? null;
  const title = (ctx.named.get("title") as string) ?? (typeof args[1] === "string" ? args[1] : `Plot ${ctx.site}`);
  const color = ctx.named.get("color") ?? args[2] ?? "#2962ff";
  const linewidth = toNumber(ctx.named.get("linewidth") ?? args[3]) ?? 1;
  const style = (ctx.named.get("style") as string) ?? (typeof args[4] === "string" ? args[4] : "line");
  host.recordPlot({
    title,
    color,
    style,
    linewidth,
    value,
    barIndex: host.barIndex(),
    time: host.bar().time,
  });
  return null;
}

function plotshapeBuiltin(args: PineValue[], ctx: BuiltinContext): PineValue {
  const host = ctx.host;
  const condition = truthy(args[0] ?? false);
  if (!condition) return null;
  const title = (ctx.named.get("title") as string) ?? (typeof args[1] === "string" ? args[1] : `Shape ${ctx.site}`);
  const shape = (ctx.named.get("shape") as string) ?? (typeof args[2] === "string" ? args[2] : "circle");
  const location = (ctx.named.get("location") as string) ?? (typeof args[3] === "string" ? args[3] : "abovebar");
  const color = ctx.named.get("color") ?? args[4] ?? "#f23645";
  const text = (ctx.named.get("text") as string) ?? (typeof args[8] === "string" ? args[8] : "");
  host.recordShape({
    title,
    shape,
    location,
    color,
    text,
    barIndex: host.barIndex(),
    time: host.bar().time,
    price: host.bar().close,
  });
  return null;
}

function alertconditionBuiltin(args: PineValue[], ctx: BuiltinContext): PineValue {
  const host = ctx.host;
  const condition = truthy(args[0] ?? false);
  const title = (ctx.named.get("title") as string) ?? (typeof args[1] === "string" ? args[1] : `Condition ${ctx.site}`);
  const message = (ctx.named.get("message") as string) ?? (typeof args[2] === "string" ? args[2] : title);
  host.recordAlertCondition({
    title,
    message,
    value: condition,
    barIndex: host.barIndex(),
    time: host.bar().time,
  });
  return null;
}

function alertBuiltin(args: PineValue[], ctx: BuiltinContext): PineValue {
  const host = ctx.host;
  const message = typeof args[0] === "string" ? args[0] : toDisplayString(args[0] ?? null);
  host.recordAlert({
    title: "alert",
    message,
    barIndex: host.barIndex(),
    time: host.bar().time,
    price: host.bar().close,
  });
  return null;
}

function hlineBuiltin(args: PineValue[], ctx: BuiltinContext): PineValue {
  const value = toNumber(args[0] ?? null);
  if (value === null) return null;
  const title = (ctx.named.get("title") as string) ?? (typeof args[1] === "string" ? args[1] : `HLine ${ctx.site}`);
  const color = ctx.named.get("color") ?? args[2] ?? "#787b86";
  ctx.host.recordHLine({ value, title, color });
  return null;
}

const GLOBAL_BUILTINS: Record<string, BuiltinFn> = {
  plot: plotBuiltin,
  plotshape: plotshapeBuiltin,
  plotchar: plotshapeBuiltin,
  alertcondition: alertconditionBuiltin,
  alert: alertBuiltin,
  hline: hlineBuiltin,
};

export { TA_FUNCTIONS, StrategySimulator };
export type { BarData, PineCallable, PineProperty };
