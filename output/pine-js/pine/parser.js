"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePine = parsePine;
const lexer_1 = require("./lexer");
function groupLines(tokens) {
    const lines = [];
    let current = [];
    for (const token of tokens) {
        if (token.type === "newline") {
            if (current.length)
                lines.push({ tokens: current, indent: current[0].col - 1, line: current[0].line });
            current = [];
            continue;
        }
        if (token.type === "eof")
            continue;
        current.push(token);
    }
    if (current.length)
        lines.push({ tokens: current, indent: current[0].col - 1, line: current[0].line });
    return lines;
}
const TYPE_NAMES = new Set([
    "int", "float", "bool", "string", "color", "line", "label", "box", "table",
    "point", "array", "matrix", "map",
]);
const TYPE_QUALIFIERS = new Set(["series", "simple", "const"]);
/** A name token: an identifier, or a Pine type keyword used as a name. */
function isNameToken(token) {
    if (!token)
        return false;
    if (token.type === "ident")
        return true;
    return token.type === "keyword" && TYPE_NAMES.has(token.value);
}
class Parser {
    constructor(source) {
        this.index = 0;
        this.siteCounter = 0;
        /** User-declared type names, collected before parsing so that a type may be
         * used in a declaration wherever it appears in the file. */
        this.typeNames = new Set();
        this.lines = groupLines((0, lexer_1.tokenize)(source));
        for (const line of this.lines) {
            if (line.tokens[0]?.type === "keyword" && line.tokens[0]?.value === "type") {
                const name = line.tokens[1];
                if (name?.type === "ident")
                    this.typeNames.add(name.value);
            }
        }
    }
    /* ---------------- line helpers ---------------- */
    peek(offset = 0) {
        return this.lines[this.index + offset];
    }
    get current() {
        return this.lines[this.index];
    }
    error(message, line = this.current?.line ?? 0) {
        throw new lexer_1.PineSyntaxError(message, line, 1);
    }
    /* ---------------- entry point ---------------- */
    parse() {
        const body = this.parseBlock(-1, true);
        let declaration = null;
        // A leading `indicator(...)` / `strategy(...)` call is metadata, not a
        // statement to execute. It is peeled off the front of the program.
        const first = body.statements[0];
        if (first && first.kind === "exprStmt" && first.expression.kind === "call") {
            const callee = first.expression.callee;
            if (callee.kind === "ident" && (callee.name === "indicator" || callee.name === "strategy" || callee.name === "library")) {
                declaration = { type: callee.name, args: first.expression.args };
                body.statements.shift();
            }
        }
        return {
            kind: "program",
            body,
            declaration,
            line: 1,
            col: 1,
        };
    }
    /**
     * Parse a block: every following line indented strictly deeper than
     * `parentIndent`. When `stopAtElse` is set, an `else` at the parent level
     * ends the block instead of being consumed.
     */
    parseBlock(parentIndent, stopAtElse = false) {
        const statements = [];
        while (this.current) {
            const line = this.current;
            if (line.indent <= parentIndent)
                break;
            if (stopAtElse && this.isElseLine(line))
                break;
            statements.push(this.parseStatement());
        }
        return { statements, line: this.current?.line ?? 0, col: 1 };
    }
    isElseLine(line) {
        const first = line.tokens[0];
        return first.type === "keyword" && first.value === "else";
    }
    /* ---------------- statements ---------------- */
    parseStatement() {
        const line = this.current;
        const first = line.tokens[0];
        // `if`
        if (first.type === "keyword" && first.value === "if") {
            return this.parseIf();
        }
        // `for`
        if (first.type === "keyword" && first.value === "for") {
            return this.parseFor();
        }
        // `while`
        if (first.type === "keyword" && first.value === "while") {
            return this.parseWhile();
        }
        // `type SRZone` — a user-declared type
        if (first.type === "keyword" && first.value === "type" && line.tokens[1]?.type === "ident") {
            return this.parseTypeDecl();
        }
        // `break` / `continue`
        if (first.type === "keyword" && first.value === "break") {
            this.index++;
            return { kind: "break", line: line.line, col: line.indent + 1 };
        }
        if (first.type === "keyword" && first.value === "continue") {
            this.index++;
            return { kind: "continue", line: line.line, col: line.indent + 1 };
        }
        // function declaration:  name(params) =>   (possibly preceded by a type)
        const fn = this.tryParseFunction();
        if (fn)
            return fn;
        // Tuple destructuring:  [a, b, c] = ta.macd(close)
        const tuple = this.tryParseTupleAssign();
        if (tuple)
            return tuple;
        // var / varip declaration, typed declaration, or plain assignment
        return this.parseVarOrAssign();
    }
    /**
     * `[a, b] = expression` — Pine's tuple destructuring. The names are plain
     * identifiers; anything else is left to the expression parser.
     */
    tryParseTupleAssign() {
        const line = this.current;
        const tokens = line.tokens;
        if (tokens[0]?.value !== "[")
            return null;
        let cursor = 1;
        const names = [];
        for (;;) {
            const name = tokens[cursor];
            if (!name || !isNameToken(name))
                return null;
            names.push(name.value);
            cursor++;
            if (tokens[cursor]?.value === ",") {
                cursor++;
                continue;
            }
            break;
        }
        if (tokens[cursor]?.value !== "]")
            return null;
        cursor++;
        if (tokens[cursor]?.value !== "=")
            return null;
        cursor++;
        const value = this.parseExpressionFrom(tokens, cursor);
        this.index++;
        return { kind: "tupleAssign", names, value, line: line.line, col: line.indent + 1 };
    }
    /**
     * `type SRZone` followed by an indented block of field declarations:
     *
     *   type SRZone
     *       float top = na
     *       bool  isRes = false
     */
    parseTypeDecl() {
        const line = this.current;
        const name = line.tokens[1].value;
        this.index++;
        const block = this.parseIndentedBlock();
        const fields = [];
        for (const statement of block.statements) {
            if (statement.kind !== "varDecl") {
                this.error(`Type '${name}' can only contain field declarations.`, line.line);
            }
            fields.push({
                name: statement.name,
                typeName: statement.typeName,
                defaultValue: statement.value,
                line: statement.line,
                col: statement.col,
            });
        }
        return { kind: "typeDecl", name, fields, line: line.line, col: line.indent + 1 };
    }
    /**
     * Parse an `if`. The header may be `if ...` or `else if ...` — in the
     * second case the condition starts after the `if` token.
     */
    parseIf() {
        const line = this.current;
        this.index++;
        const start = line.tokens[0]?.value === "else" ? 2 : 1;
        const condition = this.parseExpressionFrom(line.tokens, start);
        const then = this.parseIndentedBlock();
        let otherwise = null;
        const next = this.current;
        if (next && this.isElseLine(next) && next.indent === line.indent) {
            // `else if` — a nested if statement at the same level. parseIf consumes
            // the line itself, so the index is only advanced for a plain `else`.
            if (next.tokens[1] && next.tokens[1].type === "keyword" && next.tokens[1].value === "if") {
                otherwise = this.parseIf();
            }
            else {
                this.index++;
                otherwise = this.parseIndentedBlock();
            }
        }
        return { kind: "if", condition, then, otherwise, line: line.line, col: line.indent + 1 };
    }
    parseFor() {
        const line = this.current;
        this.index++;
        // for i = 0 to 10 [by 1]
        const variable = line.tokens[1];
        if (!variable || variable.type !== "ident")
            this.error("for loop needs a counter variable", line.line);
        const variableName = variable.value;
        let cursor = 2;
        if (line.tokens[cursor]?.value !== "=")
            this.error("for loop needs '='", line.line);
        cursor++;
        const from = this.parseExpressionFrom(line.tokens, cursor, () => {
            const next = this.findTopLevel(line.tokens, cursor, "to");
            return next === -1 ? line.tokens.length : next;
        });
        cursor = this.findTopLevel(line.tokens, cursor, "to");
        if (cursor === -1)
            this.error("for loop needs 'to'", line.line);
        cursor++;
        let by = null;
        const byIndex = this.findTopLevel(line.tokens, cursor, "by");
        if (byIndex !== -1) {
            by = this.parseExpressionFrom(line.tokens, byIndex + 1);
            cursor = line.tokens.length;
        }
        const to = this.parseExpressionFrom(line.tokens, cursor, () => {
            const stop = byIndex !== -1 ? byIndex : line.tokens.length;
            return stop;
        });
        const body = this.parseIndentedBlock();
        return { kind: "for", variable: variableName, from, to, by, body, line: line.line, col: line.indent + 1 };
    }
    parseWhile() {
        const line = this.current;
        this.index++;
        const condition = this.parseExpressionFrom(line.tokens, 1);
        const body = this.parseIndentedBlock();
        return { kind: "while", condition, body, line: line.line, col: line.indent + 1 };
    }
    /**
     * A block is the indented run of lines that follows the header line.
     * The header line has already been consumed, so the block is simply the
     * following lines indented deeper than the header.
     */
    parseIndentedBlock() {
        const headerIndent = this.lines[this.index - 1]?.indent ?? 0;
        const statements = [];
        while (this.current && this.current.indent > headerIndent) {
            statements.push(this.parseStatement());
        }
        if (!statements.length)
            this.error("Expected an indented block", this.current?.line ?? 0);
        return { statements, line: this.current?.line ?? 0, col: 1 };
    }
    /** Detect `name(params) =>` and parse it as a function declaration. */
    tryParseFunction() {
        const line = this.current;
        const tokens = line.tokens;
        let cursor = 0;
        let returnType = null;
        if (tokens[cursor]?.type === "keyword" &&
            TYPE_QUALIFIERS.has(tokens[cursor].value) &&
            tokens[cursor + 1]?.type !== "ident") {
            // series float f(...) — qualifiers before the type
            while (tokens[cursor] && tokens[cursor].type === "keyword" && TYPE_QUALIFIERS.has(tokens[cursor].value))
                cursor++;
        }
        if (tokens[cursor]?.type === "keyword" &&
            TYPE_NAMES.has(tokens[cursor].value) &&
            tokens[cursor + 1]?.type === "ident") {
            returnType = tokens[cursor].value;
            cursor++;
            if (tokens[cursor]?.type === "keyword" && TYPE_QUALIFIERS.has(tokens[cursor].value))
                cursor++;
        }
        const name = tokens[cursor];
        if (!isNameToken(name))
            return null;
        if (tokens[cursor + 1]?.value !== "(")
            return null;
        // Find the matching ')' and check that '=>' follows.
        const close = this.matchParen(tokens, cursor + 1);
        if (close === -1)
            return null;
        if (tokens[close + 1]?.value !== "=>")
            return null;
        const params = this.parseParams(tokens, cursor + 1, close, line.line);
        this.index++;
        // Body: either a single expression on the same line, or an indented block.
        const inline = tokens.slice(close + 2);
        let body;
        if (inline.length) {
            const expr = this.parseExpressionFrom(inline, 0);
            body = { statements: [{ kind: "exprStmt", expression: expr, line: line.line, col: line.indent + 1 }], line: line.line, col: 1 };
        }
        else {
            body = this.parseIndentedBlock();
        }
        return { kind: "function", name: name.value, returnType, params, body, line: line.line, col: line.indent + 1 };
    }
    parseParams(tokens, open, close, line) {
        const params = [];
        let cursor = open + 1;
        while (cursor < close) {
            let typeName = null;
            if (tokens[cursor]?.type === "keyword" &&
                TYPE_QUALIFIERS.has(tokens[cursor].value) &&
                tokens[cursor + 1]?.type === "ident")
                cursor++;
            if (tokens[cursor]?.type === "keyword" &&
                TYPE_NAMES.has(tokens[cursor].value) &&
                tokens[cursor + 1]?.type === "ident") {
                typeName = tokens[cursor].value;
                cursor++;
                if (tokens[cursor]?.type === "keyword" && TYPE_QUALIFIERS.has(tokens[cursor].value))
                    cursor++;
            }
            const name = tokens[cursor];
            if (!name || name.type !== "ident")
                this.error("Invalid parameter name", line);
            cursor++;
            let defaultValue = null;
            if (tokens[cursor]?.value === "=") {
                defaultValue = this.parseExpressionFrom(tokens, cursor + 1, () => this.findArgEnd(tokens, cursor + 1));
                cursor = this.findArgEnd(tokens, cursor + 1);
            }
            params.push({ name: name.value, typeName, defaultValue, line, col: 1 });
            if (tokens[cursor]?.value === ",")
                cursor++;
        }
        return params;
    }
    /** Index of the comma that ends the argument starting at `start` (or tokens.length). */
    findArgEnd(tokens, start) {
        let depth = 0;
        for (let i = start; i < tokens.length; i++) {
            const value = tokens[i].value;
            if ("([{".includes(value))
                depth++;
            else if (")]}".includes(value)) {
                if (depth === 0)
                    return i;
                depth--;
            }
            else if (value === "," && depth === 0)
                return i;
        }
        return tokens.length;
    }
    /** Index of a top-level keyword (e.g. "to") at or after `start`. */
    findTopLevel(tokens, start, keyword) {
        let depth = 0;
        for (let i = start; i < tokens.length; i++) {
            const value = tokens[i].value;
            if ("([{".includes(value))
                depth++;
            else if (")]}".includes(value))
                depth = Math.max(0, depth - 1);
            else if (depth === 0 && value === keyword)
                return i;
        }
        return -1;
    }
    matchParen(tokens, open) {
        let depth = 0;
        for (let i = open; i < tokens.length; i++) {
            if (tokens[i].value === "(")
                depth++;
            else if (tokens[i].value === ")") {
                depth--;
                if (depth === 0)
                    return i;
            }
        }
        return -1;
    }
    parseVarOrAssign() {
        const line = this.current;
        const tokens = line.tokens;
        let cursor = 0;
        let modifier = null;
        if (tokens[cursor]?.type === "keyword" && (tokens[cursor].value === "var" || tokens[cursor].value === "varip")) {
            modifier = tokens[cursor].value;
            cursor++;
        }
        // Type qualifiers may precede the type: `var series float x = 0`.
        while (tokens[cursor]?.type === "keyword" &&
            TYPE_QUALIFIERS.has(tokens[cursor].value) &&
            tokens[cursor + 1]?.type === "ident")
            cursor++;
        let typeName = null;
        if (tokens[cursor]?.type === "keyword" &&
            TYPE_NAMES.has(tokens[cursor].value) &&
            tokens[cursor + 1]?.type === "ident") {
            typeName = tokens[cursor].value;
            cursor++;
        }
        // A user type used as an array: `var SRZone[] zoneList = ...`
        if (tokens[cursor]?.type === "ident" &&
            tokens[cursor + 1]?.value === "[" &&
            tokens[cursor + 2]?.value === "]" &&
            tokens[cursor + 3]?.type === "ident") {
            typeName = `${tokens[cursor].value}[]`;
            cursor += 3;
        }
        // A user type used as a declaration: `SRZone z = ...`
        if (!typeName &&
            tokens[cursor]?.type === "ident" &&
            this.typeNames.has(tokens[cursor].value) &&
            tokens[cursor + 1]?.type === "ident") {
            typeName = tokens[cursor].value;
            cursor++;
        }
        const name = tokens[cursor];
        if (!isNameToken(name)) {
            this.error(`Unexpected token '${tokens[cursor]?.value ?? ""}'`, line.line);
        }
        cursor++;
        // Assignment to a member of an object: `zone.top := 12`. The target is
        // `object.property`, so the whole expression is parsed and then checked
        // for an assignment operator.
        if (tokens[cursor]?.value === "." && isNameToken(tokens[cursor + 1])) {
            const member = this.parseExpressionFrom(tokens, 0, () => cursor + 2);
            const memberOperator = tokens[cursor + 2]?.value;
            if (memberOperator && ["=", ":=", "+=", "-=", "*=", "/=", "%="].includes(memberOperator)) {
                const value = this.parseExpressionFrom(tokens, cursor + 3);
                this.index++;
                return {
                    kind: "assign",
                    target: member,
                    value,
                    op: memberOperator === "=" || memberOperator === ":=" ? null : memberOperator.slice(0, -1),
                    line: line.line,
                    col: line.indent + 1,
                };
            }
        }
        const operator = tokens[cursor]?.value;
        if (operator && ["=", "+=", "-=", "*=", "/=", "%=", ":="].includes(operator)) {
            const value = this.parseExpressionFrom(tokens, cursor + 1);
            this.index++;
            if (modifier || typeName) {
                // `var float x = ...` / `varip int counter = 0`
                return {
                    kind: "varDecl",
                    modifier,
                    typeName,
                    name: name.value,
                    value,
                    line: line.line,
                    col: line.indent + 1,
                };
            }
            // A plain assignment. `:=` (Pine v6) and `=` behave the same here;
            // compound operators are lowered to `target = target op value`.
            return {
                kind: "assign",
                target: { kind: "ident", name: name.value, line: line.line, col: line.indent + 1 },
                value,
                op: operator === "=" || operator === ":=" ? null : operator.slice(0, -1),
                line: line.line,
                col: line.indent + 1,
            };
        }
        if (modifier || typeName) {
            // A bare declaration with no value: `var int counter = 0` is the common
            // form, but `var float x` is legal too.
            this.index++;
            return { kind: "varDecl", modifier, typeName, name: name.value, value: null, line: line.line, col: line.indent + 1 };
        }
        // Not an assignment: this is a plain expression statement such as
        // `indicator("name", overlay=true)`, `plot(...)` or `alert(...)`.
        const expression = this.parseExpressionFrom(tokens, 0);
        this.index++;
        return { kind: "exprStmt", expression, line: line.line, col: line.indent + 1 };
    }
    /* ---------------- expressions ---------------- */
    /**
     * Parse an expression from a token slice. `endAt` gives the exclusive index
     * where the expression must stop (used to stop before `to`/`by` in a for
     * loop and before a closing bracket).
     */
    parseExpressionFrom(tokens, start, endAt) {
        const end = endAt ? endAt() : tokens.length;
        const cursor = { pos: start, end };
        const expr = this.parseExpression(cursor, tokens);
        return expr;
    }
    parseExpression(cursor, tokens) {
        return this.parseTernary(cursor, tokens);
    }
    parseTernary(cursor, tokens) {
        const condition = this.parseBinary(cursor, tokens, 0);
        if (this.peekPunct(cursor, tokens, "?")) {
            cursor.pos++;
            const whenTrue = this.parseTernary(cursor, tokens);
            if (!this.peekPunct(cursor, tokens, ":"))
                this.error("Expected ':' in ternary expression");
            cursor.pos++;
            const whenFalse = this.parseTernary(cursor, tokens);
            return { kind: "ternary", condition, whenTrue, whenFalse, line: condition.line, col: condition.col };
        }
        return condition;
    }
    parseBinary(cursor, tokens, level) {
        if (level >= Parser.PRECEDENCE.length)
            return this.parseUnary(cursor, tokens);
        const table = Parser.PRECEDENCE[level];
        let left = this.parseBinary(cursor, tokens, level + 1);
        for (;;) {
            const token = tokens[cursor.pos];
            if (!token || cursor.pos >= cursor.end)
                break;
            const op = token.value;
            const precedence = table[op];
            if (precedence === undefined)
                break;
            if (op === "and" || op === "or") {
                if (token.type !== "keyword")
                    break;
            }
            else if (token.type !== "punct")
                break;
            cursor.pos++;
            const right = this.parseBinary(cursor, tokens, level + 1);
            left = { kind: "binary", op: op, left, right, line: left.line, col: left.col };
        }
        return left;
    }
    parseUnary(cursor, tokens) {
        const token = tokens[cursor.pos];
        if (token && (token.value === "not" || token.value === "-" || token.value === "+") &&
            (token.type === "keyword" || token.type === "punct")) {
            // A unary minus must not be mistaken for the binary operator.
            const next = tokens[cursor.pos + 1];
            const isUnary = token.value === "not" || !next || next.value === "(" ||
                next.type === "number" || next.type === "ident" || next.type === "keyword";
            if (isUnary) {
                cursor.pos++;
                const argument = this.parseUnary(cursor, tokens);
                return { kind: "unary", op: token.value, argument, line: token.line, col: token.col };
            }
        }
        return this.parsePostfix(cursor, tokens);
    }
    parsePostfix(cursor, tokens) {
        let expression = this.parsePrimary(cursor, tokens);
        // Explicit type arguments, as in `array.new<SRZone>()`.
        let typeArgs;
        for (;;) {
            const token = tokens[cursor.pos];
            if (!token || cursor.pos >= cursor.end)
                break;
            if (token.value === "(") {
                cursor.pos++;
                const args = this.parseArgs(cursor, tokens);
                expression = {
                    kind: "call",
                    callee: expression,
                    args,
                    site: this.siteCounter++,
                    ...(typeArgs ? { typeArgs } : {}),
                    line: expression.line,
                    col: expression.col,
                };
                typeArgs = undefined;
                continue;
            }
            // Generic call: `array.new<SRZone>()`. The type argument list is only
            // recognised when it is closed and followed by `(`, so `a < b` still
            // parses as a comparison.
            if (token.value === "<" && expression.kind === "member" && !typeArgs) {
                const parsed = this.tryParseTypeArgs(cursor, tokens);
                if (parsed) {
                    typeArgs = parsed;
                    continue;
                }
            }
            if (token.value === "[") {
                cursor.pos++;
                const offset = this.parseExpression(cursor, tokens);
                if (!this.peekPunct(cursor, tokens, "]"))
                    this.error("Expected ']'");
                cursor.pos++;
                expression = { kind: "index", object: expression, offset, line: expression.line, col: expression.col };
                continue;
            }
            // A member property may be an identifier (`ta.sma`) or a Pine type
            // keyword (`input.int`, `input.float`) — both are valid.
            const propertyToken = token.value === "." ? tokens[cursor.pos + 1] : undefined;
            if (token.value === "." &&
                propertyToken &&
                (propertyToken.type === "ident" || propertyToken.type === "keyword")) {
                const property = propertyToken.value;
                cursor.pos += 2;
                expression = { kind: "member", object: expression, property, line: expression.line, col: expression.col };
                continue;
            }
            break;
        }
        return expression;
    }
    /**
     * Read `<Type, Type>` when it is followed by `(`. Returns null when the
     * `<` is a comparison rather than a type argument list.
     */
    tryParseTypeArgs(cursor, tokens) {
        const start = cursor.pos;
        let index = cursor.pos + 1;
        const typeArgs = [];
        while (index < tokens.length) {
            const token = tokens[index];
            if (token.type === "ident" || token.type === "keyword") {
                typeArgs.push(token.value);
                index++;
                if (tokens[index]?.value === ",") {
                    index++;
                    continue;
                }
                if (tokens[index]?.value === ">") {
                    index++;
                    if (tokens[index]?.value === "(") {
                        cursor.pos = index;
                        return typeArgs;
                    }
                }
            }
            break;
        }
        cursor.pos = start;
        return null;
    }
    parseArgs(cursor, tokens) {
        const args = [];
        if (this.peekPunct(cursor, tokens, ")")) {
            cursor.pos++;
            return args;
        }
        for (;;) {
            // Named argument: `name=value`. A name may be a keyword — `color` is
            // both a Pine type and a namespace, so `color=color.teal` has to parse.
            let name = null;
            const nameToken = tokens[cursor.pos];
            if (nameToken &&
                (nameToken.type === "ident" || nameToken.type === "keyword") &&
                tokens[cursor.pos + 1]?.value === "=") {
                name = nameToken.value;
                cursor.pos += 2;
            }
            const value = this.parseExpression(cursor, tokens);
            args.push({ name, value });
            if (this.peekPunct(cursor, tokens, ",")) {
                cursor.pos++;
                continue;
            }
            if (this.peekPunct(cursor, tokens, ")")) {
                cursor.pos++;
                break;
            }
            this.error("Expected ',' or ')' in argument list");
        }
        return args;
    }
    peekPunct(cursor, tokens, value) {
        const token = tokens[cursor.pos];
        return !!token && token.value === value && cursor.pos < cursor.end;
    }
    parsePrimary(cursor, tokens) {
        const token = tokens[cursor.pos];
        if (!token)
            this.error("Unexpected end of expression");
        cursor.pos++;
        if (token.type === "number") {
            return { kind: "number", value: Number(token.value), int: token.int ?? false, line: token.line, col: token.col };
        }
        if (token.type === "string") {
            return { kind: "string", value: token.value, line: token.line, col: token.col };
        }
        if (token.type === "color") {
            const hex = token.value.replace("#", "");
            const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
            return {
                kind: "color",
                value: {
                    r: parseInt(full.slice(0, 2), 16) || 0,
                    g: parseInt(full.slice(2, 4), 16) || 0,
                    b: parseInt(full.slice(4, 6), 16) || 0,
                    a: 1,
                },
                line: token.line,
                col: token.col,
            };
        }
        if (token.type === "keyword") {
            if (token.value === "true")
                return { kind: "bool", value: true, line: token.line, col: token.col };
            if (token.value === "false")
                return { kind: "bool", value: false, line: token.line, col: token.col };
            if (token.value === "na") {
                // `na` is a keyword, but Pine also has a function of that name:
                // `na(value)` returns the value unless it is zero.
                if (tokens[cursor.pos]?.value === "(") {
                    return { kind: "ident", name: "na", line: token.line, col: token.col };
                }
                return { kind: "na", line: token.line, col: token.col };
            }
            if (TYPE_NAMES.has(token.value) || TYPE_QUALIFIERS.has(token.value)) {
                // A bare type used as a value (e.g. `int` in `x = int`) — treat as a
                // named constant so the evaluator can report a precise error.
                return { kind: "ident", name: token.value, line: token.line, col: token.col };
            }
        }
        if (token.type === "ident") {
            return { kind: "ident", name: token.value, line: token.line, col: token.col };
        }
        if (token.value === "(") {
            const expr = this.parseExpression(cursor, tokens);
            if (!this.peekPunct(cursor, tokens, ")"))
                this.error("Expected ')'");
            cursor.pos++;
            return expr;
        }
        if (token.value === "[") {
            const elements = [];
            if (!this.peekPunct(cursor, tokens, "]")) {
                for (;;) {
                    elements.push(this.parseExpression(cursor, tokens));
                    if (this.peekPunct(cursor, tokens, ",")) {
                        cursor.pos++;
                        continue;
                    }
                    break;
                }
            }
            if (!this.peekPunct(cursor, tokens, "]"))
                this.error("Expected ']'");
            cursor.pos++;
            return { kind: "array", elements, line: token.line, col: token.col };
        }
        this.error(`Unexpected token '${token.value}'`, token.line);
    }
}
Parser.PRECEDENCE = [
    { or: 1 },
    { and: 2 },
    { "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3 },
    { "+": 4, "-": 4 },
    { "*": 5, "/": 5, "%": 5 },
];
/** Parse a Pine Script source file into a program AST. */
function parsePine(source) {
    return new Parser(source).parse();
}
