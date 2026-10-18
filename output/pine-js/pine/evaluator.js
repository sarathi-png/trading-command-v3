"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategySimulator = exports.TA_FUNCTIONS = exports.PineEvaluator = void 0;
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
const drawings_1 = require("./drawings");
const builtins_1 = require("./builtins");
const ta_1 = require("./ta");
Object.defineProperty(exports, "TA_FUNCTIONS", { enumerable: true, get: function () { return ta_1.TA_FUNCTIONS; } });
const strategy_1 = require("./strategy");
Object.defineProperty(exports, "StrategySimulator", { enumerable: true, get: function () { return strategy_1.StrategySimulator; } });
const values_1 = require("./values");
const MARKET_SERIES = new Set([
    "open", "high", "low", "close", "volume", "time", "time_close",
    "hl2", "hlc3", "ohlc4", "hlcc4",
]);
const isNamespace = (value) => !!value && typeof value === "object" && !Array.isArray(value) && "__namespace" in value;
const isMethodMarker = (value) => !!value && typeof value === "object" && !Array.isArray(value) && "__method" in value;
/** Thrown by `break`; caught by the loop that owns it. */
class BreakSignal {
    constructor() {
        this.__break = true;
    }
}
/** Thrown by `continue`; caught by the loop that owns it. */
class ContinueSignal {
    constructor() {
        this.__continue = true;
    }
}
const isPlainObject = (value) => !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("r" in value) &&
    !("__namespace" in value);
function createScope(parent, params, callSite) {
    return { vars: new Map(), parent, params, callSite };
}
/* ------------------------------------------------------------------ */
class PineEvaluator {
    constructor(program, options = {}) {
        this.globals = new Map();
        this.globalHistory = new Map();
        /** The bar each variable's history was last written on. */
        this.historyBar = new Map();
        this.functions = new Map();
        /** User-declared types: `type SRZone`. */
        this.types = new Map();
        /** History for plain (non-var) locals, so `dcMid[1]` means the previous bar. */
        this.localHistory = new Map();
        this.localHistoryBar = new Map();
        /** Drawing objects created by the script. */
        this.drawings = [];
        this.nextDrawingId = 1;
        this.sim = new strategy_1.StrategySimulator();
        /** Per call-site state for the streaming indicators. */
        this.streams = new Map();
        this.callHistories = new Map();
        this.callHistoryBar = new Map();
        this.plots = new Map();
        this.plotOrder = [];
        this.shapes = [];
        this.hlines = [];
        this.inputs = new Map();
        this.alerts = [];
        this.alertConditions = new Map();
        this.warnings = [];
        this.errors = [];
        this.bars = [];
        this.barIndexValue = 0;
        this.lastBarIndexValue = 0;
        this.currentBar = { time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 };
        this.globalScope = createScope(null);
        this.program = program;
        this.options = options;
        this.namespaces = {
            ...builtins_1.NAMESPACES,
            strategy: (0, strategy_1.strategyNamespace)(this.sim),
            ta: this.buildTaNamespace(),
        };
    }
    /**
     * `ta.*` indicators are stateful, so each one is wrapped in a function
     * that receives a stream context bound to the CALL SITE of the call.
     */
    buildTaNamespace() {
        const namespace = {};
        for (const [name, fn] of Object.entries(ta_1.TA_FUNCTIONS)) {
            namespace[name] = (args, ctx) => fn(args, this.streamFor(ctx.site), ctx.named);
        }
        return namespace;
    }
    streamFor(site) {
        return {
            site,
            barIndex: this.barIndexValue,
            lastBarIndex: this.lastBarIndexValue,
            bar: this.currentBar,
            prevClose: this.barIndexValue > 0 ? this.bars[this.barIndexValue - 1].close : undefined,
            bars: this.bars.slice(0, this.barIndexValue + 1),
            state: (name, create) => {
                const siteStates = this.streams.get(site) ?? new Map();
                if (!siteStates.has(name)) {
                    const created = create();
                    created.lastBar = this.barIndexValue;
                    siteStates.set(name, created);
                    this.streams.set(site, siteStates);
                }
                const state = siteStates.get(name);
                state.lastBar = this.barIndexValue;
                return state;
            },
        };
    }
    /* ---------------- host interface ---------------- */
    recordInput(input) {
        const existing = this.inputs.get(input.id);
        if (existing) {
            existing.value = input.value;
            return;
        }
        this.inputs.set(input.id, input);
    }
    inputValue(id, fallback) {
        const override = this.options.inputOverrides?.[id];
        if (override !== undefined)
            return override;
        return fallback;
    }
    recordPlot(plot) {
        const value = (0, values_1.toNumber)(plot.value);
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
    recordShape(shape) {
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
    recordHLine(line) {
        this.hlines.push(line);
    }
    recordAlertCondition(condition) {
        this.alertConditions.set(condition.title, condition);
    }
    recordAlert(alert) {
        this.alerts.push(alert);
    }
    recordDrawing(drawing) {
        this.drawings.push(drawing);
    }
    strategyCall(name, args, named) {
        const entry = this.namespaces.strategy[name];
        if (!entry) {
            this.warnings.push(`strategy.${name} is not supported by this runtime.`);
            return null;
        }
        if (!(0, builtins_1.isBuiltinFn)(entry))
            return null;
        return entry(args, {
            site: 0,
            named,
            host: this,
            nextId: (prefix) => `${prefix}_${name}`,
        });
    }
    securityCall(timeframe, expression) {
        if (timeframe && timeframe !== this.options.timeframe) {
            this.warnings.push(`request.security("${timeframe}") is not supported: only the chart timeframe can be requested.`);
        }
        return expression;
    }
    bar() {
        return this.currentBar;
    }
    previousBarTime() {
        if (this.barIndexValue <= 0)
            return null;
        return this.bars[this.barIndexValue - 1]?.time ?? null;
    }
    barIndex() {
        return this.barIndexValue;
    }
    lastBarIndex() {
        return this.lastBarIndexValue;
    }
    symbol() {
        return this.options.symbol ?? "";
    }
    timeframe() {
        return this.options.timeframe ?? "5";
    }
    /* ---------------- running ---------------- */
    run(bars) {
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
            }
            catch (error) {
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
                .filter((plot) => !!plot)
                .map((plot) => ({
                title: plot.title,
                color: (0, values_1.toDisplayString)(plot.color),
                style: plot.style,
                linewidth: plot.linewidth,
                points: plot.points.filter((point) => Number.isFinite(point.value)),
            })),
            drawings: this.drawings
                .map((drawing) => (0, drawings_1.normaliseDrawing)(drawing, (barIndex) => this.bars[barIndex]?.time ?? null))
                .filter((drawing) => drawing !== null),
            shapes: this.shapes.map((shape) => ({
                title: shape.title,
                shape: shape.shape,
                location: shape.location,
                color: (0, values_1.toDisplayString)(shape.color),
                text: shape.text,
                time: shape.time,
                barIndex: shape.barIndex,
                price: shape.price,
            })),
            hlines: this.hlines.map((line) => ({
                value: line.value,
                title: line.title,
                color: (0, values_1.toDisplayString)(line.color),
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
    /** First pass: register functions and user-declared types. */
    collectDeclarations() {
        for (const statement of this.program.body.statements) {
            if (statement.kind === "function")
                this.functions.set(statement.name, statement);
            if (statement.kind === "typeDecl")
                this.types.set(statement.name, statement);
        }
    }
    readMeta() {
        const declaration = this.program.declaration;
        const meta = {
            title: "Untitled script",
            shorttitle: "",
            type: "script",
            overlay: false,
        };
        if (!declaration)
            return meta;
        const read = (name, position = -1) => {
            const found = declaration.args.find((arg) => arg.name === name);
            if (found)
                return this.evalExpression(found.value, this.globalScope);
            if (position >= 0) {
                const positional = declaration.args[position];
                if (positional && !positional.name)
                    return this.evalExpression(positional.value, this.globalScope);
            }
            return null;
        };
        const title = read("title", 0);
        const shorttitle = read("shorttitle", 1);
        const overlay = read("overlay");
        meta.type = declaration.type;
        if (typeof title === "string")
            meta.title = title;
        if (typeof shorttitle === "string")
            meta.shorttitle = shorttitle;
        meta.overlay = (0, values_1.toBoolean)(overlay) || meta.type === "strategy";
        return meta;
    }
    /** Plots that were not touched on this bar get an `na` point. */
    padPlots() {
        for (const plot of this.plots.values()) {
            if (plot.lastBar === this.barIndexValue)
                continue;
            plot.points.push({ time: this.currentBar.time, value: Number.NaN });
        }
    }
    /**
     * Window-based indicator states are padded with `na` when their call site
     * did not execute on this bar, so a window always covers exactly the bars
     * it should.
     */
    padStreams() {
        for (const stateMap of this.streams.values()) {
            for (const state of stateMap.values()) {
                const holder = state;
                if (holder.lastBar === this.barIndexValue)
                    continue;
                if (holder.window && typeof holder.window.push === "function")
                    holder.window.push(null);
                else if (Array.isArray(holder.pending))
                    holder.pending.push(null);
            }
        }
    }
    /* ---------------- statements ---------------- */
    executeBlock(block, scope) {
        for (const statement of block.statements) {
            this.executeStatement(statement, scope);
        }
    }
    executeStatement(statement, scope) {
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
                if (scope.callSite !== undefined)
                    scope.result = value;
                return;
            }
            case "function":
                this.functions.set(statement.name, statement);
                return;
            case "typeDecl":
                this.types.set(statement.name, statement);
                return;
            case "break":
                throw new BreakSignal();
            case "continue":
                throw new ContinueSignal();
            default:
                return;
        }
    }
    executeVarDecl(declaration, scope) {
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
        this.pushLocalHistory(declaration.name, value);
    }
    /**
     * Record a local variable's value for the current bar. Pine only guarantees
     * history for `var` variables, but scripts read `x[1]` on plain locals all
     * the time, so the history is kept for them as well.
     */
    pushLocalHistory(name, value) {
        if (this.localHistoryBar.get(name) === this.barIndexValue) {
            const history = this.localHistory.get(name);
            if (history && history.length) {
                history[history.length - 1] = value;
                return;
            }
        }
        const history = this.localHistory.get(name) ?? [];
        history.push(value);
        if (history.length > 2000)
            history.splice(0, history.length - 2000);
        this.localHistory.set(name, history);
        this.localHistoryBar.set(name, this.barIndexValue);
    }
    /**
     * Record a variable's value for the current bar. A variable written twice
     * in the same bar (a `var` declaration plus a later assignment) produces a
     * single history entry, so `x[1]` always means "the previous bar".
     */
    pushGlobalHistory(name, value) {
        const history = this.globalHistory.get(name) ?? [];
        if (this.historyBar.get(name) === this.barIndexValue && history.length) {
            history[history.length - 1] = value;
        }
        else {
            history.push(value);
            this.historyBar.set(name, this.barIndexValue);
        }
        this.globalHistory.set(name, history);
    }
    /**
     * `[a, b, c] = f()` — the right-hand side must be a tuple. A mismatch is
     * reported as a runtime error rather than silently binding `na`.
     */
    executeTupleAssign(statement, scope) {
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
    executeAssign(statement, scope) {
        const right = this.evalExpression(statement.value, scope);
        const value = statement.op
            ? this.applyBinary(statement.op, this.evalExpression(statement.target, scope), right)
            : right;
        this.assignTo(statement.target, value, scope);
    }
    assignTo(target, value, scope) {
        if (target.kind === "ident") {
            if (scope.vars.has(target.name)) {
                scope.vars.set(target.name, value);
                this.pushLocalHistory(target.name, value);
                return;
            }
            if (scope === this.globalScope) {
                this.globals.set(target.name, value);
                this.pushGlobalHistory(target.name, value);
                return;
            }
            scope.vars.set(target.name, value);
            this.pushLocalHistory(target.name, value);
            return;
        }
        if (target.kind === "member") {
            const base = this.evalExpression(target.object, scope);
            if ((0, values_1.isUserObject)(base)) {
                // A user object is a reference: writing a field mutates the instance
                // that the array holds.
                base[target.property] = value;
                return;
            }
            if (isNamespace(base)) {
                const entry = this.namespaces[base.__namespace]?.[target.property];
                if ((0, values_1.isProperty)(entry)) {
                    entry.set(value);
                    return;
                }
                if ((0, builtins_1.isBuiltinFn)(entry)) {
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
            const index = Math.floor((0, values_1.toNumber)(this.evalExpression(target.offset, scope)) ?? 0);
            if (Array.isArray(collection) && index >= 0 && index < collection.length) {
                collection[index] = value;
                return;
            }
        }
        throw new Error("Invalid assignment target.");
    }
    executeIf(statement, scope) {
        const condition = (0, values_1.truthy)(this.evalExpression(statement.condition, scope));
        if (condition) {
            this.executeBlock(statement.then, scope);
            return;
        }
        if (statement.otherwise) {
            if (statement.otherwise.kind === "if") {
                this.executeIf(statement.otherwise, scope);
                return;
            }
            this.executeBlock(statement.otherwise, scope);
        }
    }
    executeFor(statement, scope) {
        const from = Math.round((0, values_1.toNumber)(this.evalExpression(statement.from, scope)) ?? 0);
        const to = Math.round((0, values_1.toNumber)(this.evalExpression(statement.to, scope)) ?? 0);
        const by = statement.by ? Math.round((0, values_1.toNumber)(this.evalExpression(statement.by, scope)) ?? 1) : 1;
        if (by === 0)
            return;
        let iterations = 0;
        for (let value = from; by > 0 ? value <= to : value >= to; value += by) {
            if (++iterations > 100_000) {
                this.warnings.push("A for loop exceeded 100000 iterations and was stopped.");
                break;
            }
            scope.vars.set(statement.variable, value);
            try {
                this.executeBlock(statement.body, scope);
            }
            catch (error) {
                if (error instanceof BreakSignal)
                    break;
                if (error instanceof ContinueSignal)
                    continue;
                throw error;
            }
        }
    }
    executeWhile(statement, scope) {
        let iterations = 0;
        while ((0, values_1.truthy)(this.evalExpression(statement.condition, scope))) {
            if (++iterations > 100_000) {
                this.warnings.push("A while loop exceeded 100000 iterations and was stopped.");
                break;
            }
            try {
                this.executeBlock(statement.body, scope);
            }
            catch (error) {
                if (error instanceof BreakSignal)
                    break;
                if (error instanceof ContinueSignal)
                    continue;
                throw error;
            }
        }
    }
    /* ---------------- expressions ---------------- */
    evalExpression(node, scope) {
        switch (node.kind) {
            case "number":
                return node.value;
            case "string":
                return node.value;
            case "bool":
                return node.value;
            case "na":
                return null;
            case "color":
                return node.value;
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
                const condition = (0, values_1.truthy)(this.evalExpression(node.condition, scope));
                return condition
                    ? this.evalExpression(node.whenTrue, scope)
                    : this.evalExpression(node.whenFalse, scope);
            }
            case "tuple":
            case "array":
                return node.elements.map((element) => this.evalExpression(element, scope));
        }
    }
    evalIdentifier(name, line, scope) {
        const local = this.lookup(scope, name);
        if (local !== undefined)
            return local;
        if (this.globals.has(name))
            return this.globals.get(name) ?? null;
        if (MARKET_SERIES.has(name))
            return this.marketSeries(name);
        if (name === "bar_index")
            return this.barIndexValue;
        if (name === "last_bar_index")
            return this.lastBarIndexValue;
        if (this.namespaces[name])
            return { __namespace: name };
        this.errors.push({ message: `Unknown identifier '${name}'.`, line });
        return null;
    }
    lookup(scope, name) {
        let current = scope;
        while (current) {
            if (current.vars.has(name))
                return current.vars.get(name);
            current = current.parent;
        }
        return undefined;
    }
    marketSeries(name) {
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
    evalMember(object, property, line, scope) {
        const base = this.evalExpression(object, scope);
        if (isNamespace(base)) {
            const entry = this.namespaces[base.__namespace]?.[property];
            if (entry === undefined) {
                this.errors.push({ message: `Unknown function or variable '${base.__namespace}.${property}'.`, line });
                return null;
            }
            if ((0, values_1.isProperty)(entry))
                return entry.get(this);
            if ((0, builtins_1.isBuiltinFn)(entry))
                return { __method: entry };
            return entry;
        }
        if ((0, values_1.isCallable)(base)) {
            const method = base.methods[property];
            if (!method) {
                this.errors.push({ message: `Unknown method '${property}'.`, line });
                return null;
            }
            const bound = { __boundMethod: true, fn: (...args) => method(...args) };
            return bound;
        }
        if (isPlainObject(base)) {
            const entry = base[property];
            if (entry === undefined) {
                this.errors.push({ message: `Unknown property '${property}'.`, line });
                return null;
            }
            if ((0, values_1.isProperty)(entry))
                return entry.get(this);
            if ((0, builtins_1.isBuiltinFn)(entry))
                return { __method: entry };
            return entry;
        }
        this.errors.push({ message: `Cannot read '${property}' from this value.`, line });
        return null;
    }
    evalCall(node, scope) {
        const named = new Map();
        const positional = [];
        for (const arg of node.args) {
            const value = this.evalExpression(arg.value, scope);
            if (arg.name)
                named.set(arg.name, value);
            else
                positional.push(value);
        }
        // A callee that is a member of a namespace / object.
        if (node.callee.kind === "member") {
            // `SRZone.new(...)` — constructing a user-declared type.
            if (node.callee.object.kind === "ident" &&
                node.callee.property === "new" &&
                this.types.has(node.callee.object.name)) {
                return this.constructType(node.callee.object.name, positional, named, node.line);
            }
            const base = this.evalExpression(node.callee.object, scope);
            if (isNamespace(base)) {
                const entry = this.namespaces[base.__namespace]?.[node.callee.property];
                if (entry === undefined) {
                    this.errors.push({ message: `Unknown function '${base.__namespace}.${node.callee.property}'.`, line: node.line });
                    return null;
                }
                if ((0, values_1.isProperty)(entry)) {
                    this.errors.push({ message: `'${base.__namespace}.${node.callee.property}' is a value, not a function.`, line: node.line });
                    return null;
                }
                if ((0, builtins_1.isBuiltinFn)(entry)) {
                    return this.invokeBuiltin(entry, positional, named, node.site, node.line, node.typeArgs);
                }
                if ((0, values_1.isCallable)(entry))
                    return entry.value;
            }
            if ((0, values_1.isCallable)(base)) {
                const method = base.methods[node.callee.property];
                if (method)
                    return method(...positional);
                this.errors.push({ message: `Unknown method '${node.callee.property}'.`, line: node.line });
                return null;
            }
            if ((0, values_1.isArray)(base)) {
                return this.arrayMethod(base, node.callee.property, positional, node.line);
            }
            if (isPlainObject(base)) {
                const entry = base[node.callee.property];
                if ((0, builtins_1.isBuiltinFn)(entry))
                    return this.invokeBuiltin(entry, positional, named, node.site, node.line);
                if ((0, values_1.isProperty)(entry)) {
                    this.errors.push({ message: `'${node.callee.property}' is a value, not a function.`, line: node.line });
                    return null;
                }
            }
        }
        // A callee that is a plain identifier: a user function, or a global builtin.
        if (node.callee.kind === "ident") {
            const name = node.callee.name;
            const userFunction = this.functions.get(name);
            if (userFunction)
                return this.callUserFunction(userFunction, positional, named, node.site);
            const globalBuiltin = GLOBAL_BUILTINS[name];
            if (globalBuiltin)
                return this.invokeBuiltin(globalBuiltin, positional, named, node.site, node.line);
            this.errors.push({ message: `Unknown function '${name}'.`, line: node.line });
            return null;
        }
        // A callee that evaluated to a method marker or a bound method.
        const resolved = this.evalExpression(node.callee, scope);
        if (isMethodMarker(resolved)) {
            return this.invokeBuiltin(resolved.__method, positional, named, node.site, node.line);
        }
        if ((0, values_1.isBoundMethod)(resolved)) {
            return resolved.fn(...positional);
        }
        if ((0, values_1.isCallable)(resolved))
            return resolved.value;
        this.errors.push({ message: "This value cannot be called.", line: node.line });
        return null;
    }
    /**
     * `SRZone.new(top = 1, bot = 2)` — build an instance of a user type.
     * Fields not supplied keep their declared default.
     */
    constructType(typeName, positional, named, line) {
        const declaration = this.types.get(typeName);
        if (!declaration) {
            this.errors.push({ message: `Unknown type '${typeName}'.`, line });
            return null;
        }
        const instance = { __userType: typeName };
        declaration.fields.forEach((field, index) => {
            if (named.has(field.name)) {
                instance[field.name] = named.get(field.name) ?? null;
                return;
            }
            if (index < positional.length) {
                instance[field.name] = positional[index];
                return;
            }
            instance[field.name] = field.defaultValue
                ? this.evalExpression(field.defaultValue, this.globalScope)
                : null;
        });
        return instance;
    }
    /**
     * The methods of a Pine array: `push`, `get`, `set`, `remove`, ...
     */
    arrayMethod(array, method, positional, line) {
        const items = array.items;
        switch (method) {
            case "size":
                return items.length;
            case "get": {
                const index = Math.floor((0, values_1.toNumber)(positional[0] ?? null) ?? -1);
                return index >= 0 && index < items.length ? items[index] : null;
            }
            case "set": {
                const index = Math.floor((0, values_1.toNumber)(positional[0] ?? null) ?? -1);
                if (index < 0 || index >= items.length) {
                    this.errors.push({ message: "Array index out of bounds.", line });
                    return null;
                }
                items[index] = positional[1] ?? null;
                return null;
            }
            case "push":
                items.push(positional[0] ?? null);
                return null;
            case "pop":
                return items.length ? (items.pop() ?? null) : null;
            case "shift":
                return items.length ? (items.shift() ?? null) : null;
            case "unshift":
                items.unshift(positional[0] ?? null);
                return null;
            case "insert": {
                const index = Math.floor((0, values_1.toNumber)(positional[0] ?? null) ?? 0);
                items.splice(index, 0, positional[1] ?? null);
                return null;
            }
            case "remove": {
                const index = Math.floor((0, values_1.toNumber)(positional[0] ?? null) ?? -1);
                if (index < 0 || index >= items.length) {
                    this.errors.push({ message: "Array index out of bounds.", line });
                    return null;
                }
                const removed = items.splice(index, 1)[0];
                return removed ?? null;
            }
            case "clear":
                items.length = 0;
                return null;
            case "slice": {
                const from = Math.floor((0, values_1.toNumber)(positional[0] ?? null) ?? 0);
                const to = positional[1] === undefined ? items.length : Math.floor((0, values_1.toNumber)(positional[1]) ?? items.length);
                return (0, values_1.newArray)(array.typeName);
            }
            case "concat": {
                const other = positional[0];
                if ((0, values_1.isArray)(other)) {
                    items.push(...other.items);
                }
                return null;
            }
            case "indexof": {
                const target = positional[0] ?? null;
                return items.findIndex((item) => this.looseEqual(item, target));
            }
            case "lastindexof": {
                const target = positional[0] ?? null;
                for (let index = items.length - 1; index >= 0; index--) {
                    if (this.looseEqual(items[index], target))
                        return index;
                }
                return -1;
            }
            case "includes": {
                const target = positional[0] ?? null;
                return items.some((item) => this.looseEqual(item, target));
            }
            default:
                this.errors.push({ message: `Unknown array method '${method}'.`, line });
                return null;
        }
    }
    invokeBuiltin(fn, positional, named, site, line, typeArgs) {
        const context = {
            site,
            named,
            host: this,
            nextId: (prefix) => `${prefix}_${site}`,
            typeArgs: typeArgs ?? undefined,
        };
        try {
            return fn(positional, context);
        }
        catch (error) {
            this.errors.push({
                message: error instanceof Error ? error.message : String(error),
                line,
            });
            return null;
        }
    }
    callUserFunction(fn, positional, named, site) {
        const frame = createScope(this.globalScope, new Set(fn.params.map((param) => param.name)), site);
        let positionalIndex = 0;
        for (const param of fn.params) {
            let value;
            if (named.has(param.name))
                value = named.get(param.name) ?? null;
            else if (positionalIndex < positional.length)
                value = positional[positionalIndex++];
            else if (param.defaultValue)
                value = this.evalExpression(param.defaultValue, frame);
            else
                value = null;
            frame.vars.set(param.name, value);
        }
        // Remember the series history of the arguments at this call site, so
        // `param[1]` inside the body means "the value on the previous bar".
        if (this.callHistoryBar.get(site) !== this.barIndexValue) {
            this.callHistoryBar.set(site, this.barIndexValue);
            const histories = this.callHistories.get(site) ?? new Map();
            for (const param of fn.params) {
                const history = histories.get(param.name) ?? [];
                history.push(frame.vars.get(param.name) ?? null);
                if (history.length > 2000)
                    history.splice(0, history.length - 2000);
                histories.set(param.name, history);
            }
            this.callHistories.set(site, histories);
        }
        this.executeBlock(fn.body, frame);
        return frame.result ?? null;
    }
    evalIndex(node, scope) {
        const object = node.object;
        const offset = Math.floor((0, values_1.toNumber)(this.evalExpression(node.offset, scope)) ?? 0);
        if (object.kind === "ident" && MARKET_SERIES.has(object.name)) {
            const index = this.barIndexValue - offset;
            if (index < 0 || index >= this.bars.length)
                return null;
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
            // A plain local: history is recorded per bar as well.
            const localHistory = this.localHistory.get(object.name);
            if (localHistory) {
                const index = localHistory.length - 1 - offset;
                return index >= 0 ? localHistory[index] : null;
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
    findParamHistory(scope, name) {
        let current = scope;
        while (current) {
            if (current.params?.has(name) && current.callSite !== undefined) {
                return this.callHistories.get(current.callSite)?.get(name) ?? null;
            }
            current = current.parent;
        }
        return null;
    }
    evalUnary(node, scope) {
        if (node.op === "not") {
            // `not na(x)` is Pine's idiom for "x has a value". `na(x)` itself
            // evaluates to the value, so the negation is handled here.
            const argument = node.argument;
            if (argument.kind === "call" &&
                argument.callee.kind === "ident" &&
                argument.callee.name === "na" &&
                argument.args.length === 1 &&
                argument.args[0].name === null) {
                return hasValue(this.evalExpression(argument.args[0].value, scope));
            }
            return !(0, values_1.truthy)(this.evalExpression(node.argument, scope));
        }
        const value = this.evalExpression(node.argument, scope);
        const numeric = (0, values_1.toNumber)(value);
        if (numeric === null)
            return null;
        return node.op === "-" ? -numeric : numeric;
    }
    applyBinary(op, left, right) {
        switch (op) {
            case "and": return (0, values_1.truthy)(left) && (0, values_1.truthy)(right);
            case "or": return (0, values_1.truthy)(left) || (0, values_1.truthy)(right);
            case "==": return this.looseEqual(left, right);
            case "!=": return !this.looseEqual(left, right);
            case "+": {
                if (typeof left === "string" || typeof right === "string") {
                    return (0, values_1.toDisplayString)(left) + (0, values_1.toDisplayString)(right);
                }
                const a = (0, values_1.toNumber)(left);
                const b = (0, values_1.toNumber)(right);
                return a === null || b === null ? null : a + b;
            }
            case "-": {
                const a = (0, values_1.toNumber)(left);
                const b = (0, values_1.toNumber)(right);
                return a === null || b === null ? null : a - b;
            }
            case "*": {
                const a = (0, values_1.toNumber)(left);
                const b = (0, values_1.toNumber)(right);
                return a === null || b === null ? null : a * b;
            }
            case "/": {
                const a = (0, values_1.toNumber)(left);
                const b = (0, values_1.toNumber)(right);
                if (a === null || b === null)
                    return null;
                return b === 0 ? null : a / b;
            }
            case "%": {
                const a = (0, values_1.toNumber)(left);
                const b = (0, values_1.toNumber)(right);
                if (a === null || b === null)
                    return null;
                return b === 0 ? null : a % b;
            }
            case "<":
            case ">":
            case "<=":
            case ">=": {
                const a = (0, values_1.toNumber)(left);
                const b = (0, values_1.toNumber)(right);
                if (a === null || b === null)
                    return null;
                if (op === "<")
                    return a < b;
                if (op === ">")
                    return a > b;
                if (op === "<=")
                    return a <= b;
                return a >= b;
            }
            default:
                return null;
        }
    }
    looseEqual(left, right) {
        if (left === null || right === null)
            return false;
        if (typeof left === "number" && typeof right === "number")
            return left === right;
        if (typeof left === "string" && typeof right === "string")
            return left === right;
        if (typeof left === "boolean" && typeof right === "boolean")
            return left === right;
        return (0, values_1.toDisplayString)(left) === (0, values_1.toDisplayString)(right);
    }
}
exports.PineEvaluator = PineEvaluator;
/* ------------------------------------------------------------------ */
/* Global built-in statements (plot, plotshape, alert, ...)            */
/* ------------------------------------------------------------------ */
function plotBuiltin(args, ctx) {
    const host = ctx.host;
    const value = args[0] ?? null;
    // `display = display.none` hides the plot without removing it.
    const display = ctx.named.get("display");
    if (typeof display === "string" && display === "none")
        return null;
    const title = ctx.named.get("title") ?? (typeof args[1] === "string" ? args[1] : `Plot ${ctx.site}`);
    const color = ctx.named.get("color") ?? args[2] ?? "#2962ff";
    const linewidth = (0, values_1.toNumber)(ctx.named.get("linewidth") ?? args[3]) ?? 1;
    const style = ctx.named.get("style") ?? (typeof args[4] === "string" ? args[4] : "line");
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
function plotshapeBuiltin(args, ctx) {
    const host = ctx.host;
    const condition = (0, values_1.truthy)(args[0] ?? false);
    if (!condition)
        return null;
    const title = ctx.named.get("title") ?? (typeof args[1] === "string" ? args[1] : `Shape ${ctx.site}`);
    const shape = ctx.named.get("shape") ?? (typeof args[2] === "string" ? args[2] : "circle");
    const location = ctx.named.get("location") ?? (typeof args[3] === "string" ? args[3] : "abovebar");
    const color = ctx.named.get("color") ?? args[4] ?? "#f23645";
    const text = ctx.named.get("text") ?? (typeof args[8] === "string" ? args[8] : "");
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
function alertconditionBuiltin(args, ctx) {
    const host = ctx.host;
    const condition = (0, values_1.truthy)(args[0] ?? false);
    const title = ctx.named.get("title") ?? (typeof args[1] === "string" ? args[1] : `Condition ${ctx.site}`);
    const message = ctx.named.get("message") ?? (typeof args[2] === "string" ? args[2] : title);
    host.recordAlertCondition({
        title,
        message,
        value: condition,
        barIndex: host.barIndex(),
        time: host.bar().time,
    });
    return null;
}
function alertBuiltin(args, ctx) {
    const host = ctx.host;
    const message = typeof args[0] === "string" ? args[0] : (0, values_1.toDisplayString)(args[0] ?? null);
    host.recordAlert({
        title: "alert",
        message,
        barIndex: host.barIndex(),
        time: host.bar().time,
        price: host.bar().close,
    });
    return null;
}
function hlineBuiltin(args, ctx) {
    const value = (0, values_1.toNumber)(args[0] ?? null);
    if (value === null)
        return null;
    const title = ctx.named.get("title") ?? (typeof args[1] === "string" ? args[1] : `HLine ${ctx.site}`);
    const color = ctx.named.get("color") ?? args[2] ?? "#787b86";
    ctx.host.recordHLine({ value, title, color });
    return null;
}
/** `nz(value)` — the value, or zero when it is na. */
function nzBuiltin(args) {
    const value = args[0] ?? null;
    if (value === null || value === undefined)
        return args.length > 1 ? args[1] : 0;
    if (typeof value === "number" && !Number.isFinite(value))
        return args.length > 1 ? args[1] : 0;
    return value;
}
/** `na(value)` — the value, or na when the value is missing. */
function naBuiltin(args) {
    const value = args[0] ?? null;
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number" && !Number.isFinite(value))
        return null;
    return value;
}
/** True when a value is present (not na). */
function hasValue(value) {
    if (value === null || value === undefined)
        return false;
    if (typeof value === "number" && !Number.isFinite(value))
        return false;
    return true;
}
/** `hour(time, "UTC")` — the hour of the bar. */
function hourBuiltin(args, ctx) {
    const time = (0, values_1.toNumber)(args[0] ?? null) ?? ctx.host.bar().time;
    return new Date(time * 1000).getUTCHours();
}
function minuteBuiltin(args, ctx) {
    const time = (0, values_1.toNumber)(args[0] ?? null) ?? ctx.host.bar().time;
    return new Date(time * 1000).getUTCMinutes();
}
function dayofweekBuiltin(args, ctx) {
    const time = (0, values_1.toNumber)(args[0] ?? null) ?? ctx.host.bar().time;
    return new Date(time * 1000).getUTCDay() + 1;
}
function dayofmonthBuiltin(args, ctx) {
    const time = (0, values_1.toNumber)(args[0] ?? null) ?? ctx.host.bar().time;
    return new Date(time * 1000).getUTCDate();
}
const GLOBAL_BUILTINS = {
    nz: nzBuiltin,
    na: naBuiltin,
    hour: hourBuiltin,
    minute: minuteBuiltin,
    dayofweek: dayofweekBuiltin,
    dayofmonth: dayofmonthBuiltin,
    plot: plotBuiltin,
    plotshape: plotshapeBuiltin,
    plotchar: plotshapeBuiltin,
    alertcondition: alertconditionBuiltin,
    alert: alertBuiltin,
    hline: hlineBuiltin,
};
