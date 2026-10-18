"use strict";
/**
 * Pine Script lexer.
 *
 * A hand-written tokenizer for the Pine v5/v6 dialect used by TradingView
 * indicators and strategies. It is deliberately small: the runtime that
 * consumes it (see evaluator.ts) is the interesting part, and a full grammar
 * would buy nothing here.
 *
 * Line breaks are significant in Pine (a statement ends at a newline), but they
 * are ignored while any bracket is open, so a call may be wrapped across
 * lines exactly like in TradingView.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PineSyntaxError = exports.KEYWORDS = void 0;
exports.tokenize = tokenize;
exports.KEYWORDS = new Set([
    "if", "else", "for", "to", "by", "while", "var", "varip",
    "and", "or", "not", "na", "true", "false",
    "switch", "export", "import", "method", "unless", "break", "continue",
    // Type names — accepted and mostly ignored, but they are keywords.
    "bool", "int", "float", "string", "color", "line", "label", "box", "table",
    "point", "array", "matrix", "map", "enum", "struct", "type",
    // Type qualifiers.
    "series", "simple", "const",
]);
/** Multi-character operators, longest first. */
const PUNCTUATORS = [
    "==", "!=", "<=", ">=", "=>", "->", ":=", "+=", "-=", "*=", "/=", "%=",
    "(", ")", "[", "]", "{", "}", ",", ":", ";", ".", "=", "<", ">", "+", "-", "*", "/", "%", "!", "?",
];
class PineSyntaxError extends Error {
    constructor(message, line, col) {
        super(`${message} (line ${line}, column ${col})`);
        this.line = line;
        this.col = col;
        this.name = "PineSyntaxError";
    }
}
exports.PineSyntaxError = PineSyntaxError;
function tokenize(source) {
    const tokens = [];
    const src = source.replace(/\r\n?/g, "\n");
    let i = 0;
    let line = 1;
    let col = 1;
    let depth = 0;
    /**
     * `startLine`/`startCol` must be captured BEFORE advancing: the indent of a
     * line is the column of its FIRST token, and an off-by-token-length would
     * silently break every block in the script.
     */
    const push = (type, value, extra, startLine = line, startCol = col) => {
        tokens.push({ type, value, line: startLine, col: startCol, ...extra });
    };
    const advance = (n) => {
        for (let k = 0; k < n; k++) {
            if (src[i] === "\n") {
                line++;
                col = 1;
            }
            else {
                col++;
            }
            i++;
        }
    };
    while (i < src.length) {
        const ch = src[i];
        // ---- whitespace (newlines are meaningful) ----
        if (ch === " " || ch === "\t") {
            advance(1);
            continue;
        }
        if (ch === "\n") {
            if (depth === 0)
                push("newline", "\n");
            advance(1);
            continue;
        }
        // ---- comments ----
        if (ch === "/" && src[i + 1] === "/") {
            while (i < src.length && src[i] !== "\n")
                advance(1);
            continue;
        }
        if (ch === "/" && src[i + 1] === "*") {
            const startLine = line;
            advance(2);
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
                advance(1);
            if (i >= src.length)
                throw new PineSyntaxError("Unterminated block comment", startLine, col);
            advance(2);
            continue;
        }
        // ---- numbers ----
        if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
            const start = i;
            const startCol = col;
            const startLine = line;
            let isInt = true;
            while (i < src.length && /[0-9]/.test(src[i]))
                advance(1);
            if (src[i] === ".") {
                isInt = false;
                advance(1);
                while (i < src.length && /[0-9]/.test(src[i]))
                    advance(1);
            }
            if (src[i] === "e" || src[i] === "E") {
                const save = i;
                advance(1);
                if (src[i] === "+" || src[i] === "-")
                    advance(1);
                if (/[0-9]/.test(src[i] ?? "")) {
                    isInt = false;
                    while (i < src.length && /[0-9]/.test(src[i]))
                        advance(1);
                }
                else {
                    i = save; // not an exponent after all
                }
            }
            const value = src.slice(start, i);
            const token = { type: "number", value, line: startLine, col: startCol };
            if (isInt)
                token.int = true;
            tokens.push(token);
            continue;
        }
        // ---- strings ----
        if (ch === '"' || ch === "'") {
            const quote = ch;
            const startCol = col;
            const startLine = line;
            advance(1);
            let out = "";
            while (i < src.length && src[i] !== quote) {
                if (src[i] === "\\") {
                    advance(1);
                    const esc = src[i];
                    out += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "\\" ? "\\" : esc;
                    advance(1);
                    continue;
                }
                out += src[i];
                advance(1);
            }
            if (i >= src.length)
                throw new PineSyntaxError("Unterminated string literal", line, startCol);
            advance(1); // closing quote
            push("string", out, undefined, startLine, startCol);
            continue;
        }
        // ---- hex colour literals: #ff9800 ----
        if (ch === "#" && /[0-9a-fA-F]/.test(src[i + 1] ?? "")) {
            const startCol = col;
            const startLine = line;
            advance(1);
            let hex = "";
            while (i < src.length && /[0-9a-fA-F]/.test(src[i])) {
                hex += src[i];
                advance(1);
            }
            push("color", `#${hex}`, undefined, startLine, startCol);
            continue;
        }
        // ---- identifiers / keywords ----
        if (/[A-Za-z_]/.test(ch)) {
            const start = i;
            const startCol = col;
            while (i < src.length && /[A-Za-z0-9_]/.test(src[i]))
                advance(1);
            const value = src.slice(start, i);
            push(exports.KEYWORDS.has(value) ? "keyword" : "ident", value, undefined, line, startCol);
            continue;
        }
        // ---- punctuation ----
        const punct = PUNCTUATORS.find((p) => src.startsWith(p, i));
        if (punct) {
            const startCol = col;
            if ("([{".includes(punct))
                depth++;
            if (")]}".includes(punct))
                depth = Math.max(0, depth - 1);
            const punctCol = col;
            advance(punct.length);
            push("punct", punct, undefined, line, punctCol);
            continue;
        }
        throw new PineSyntaxError(`Unexpected character '${ch}'`, line, col);
    }
    push("newline", "\n");
    push("eof", "", undefined, line, col);
    return tokens;
}
