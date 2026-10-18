"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PineSyntaxError = void 0;
exports.runPine = runPine;
exports.emptyResult = emptyResult;
exports.toBars = toBars;
/**
 * Public API of the Pine runtime.
 *
 *   const result = runPine(source, candles, { symbol, timeframe });
 *
 * `runPine` never throws for a bad script: compile errors and runtime errors
 * come back in `result.errors` so the app can show them next to the editor.
 */
const lexer_1 = require("./lexer");
Object.defineProperty(exports, "PineSyntaxError", { enumerable: true, get: function () { return lexer_1.PineSyntaxError; } });
const parser_1 = require("./parser");
const evaluator_1 = require("./evaluator");
/**
 * Parse and execute a Pine Script over a series of bars.
 */
function runPine(source, bars, options = {}) {
    let program;
    try {
        program = (0, parser_1.parsePine)(source);
    }
    catch (error) {
        const message = error instanceof lexer_1.PineSyntaxError
            ? error.message
            : error instanceof Error
                ? error.message
                : String(error);
        return emptyResult([{ message }], true);
    }
    const evaluator = new evaluator_1.PineEvaluator(program, options);
    const result = evaluator.run(bars);
    return { ...result, compileFailed: false };
}
/** A result object for a script that failed to compile. */
function emptyResult(errors, compileFailed = false) {
    return {
        ok: false,
        compileFailed,
        meta: { title: "Untitled script", shorttitle: "", type: "script", overlay: false },
        inputs: [],
        plots: [],
        shapes: [],
        drawings: [],
        hlines: [],
        alerts: [],
        alertConditions: [],
        trades: [],
        stats: null,
        errors,
        warnings: [],
        barCount: 0,
    };
}
/** Convert app candles into the runtime's bar shape. */
function toBars(candles) {
    return candles.map((candle) => ({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
    }));
}
