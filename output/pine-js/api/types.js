"use strict";
/**
 * Types shared with the desktop backend.
 *
 * These mirror the shapes returned by the Next.js API in the parent project
 * (src/lib/types.ts and the route handlers). The mobile app is a pure client
 * of that API — it never talks to CoinDCX directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TF_MINUTES = exports.TIMEFRAMES = void 0;
exports.TIMEFRAMES = [
    "1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W",
];
exports.TF_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1H": 60, "2H": 120, "4H": 240, "1D": 1440, "1W": 10080,
};
