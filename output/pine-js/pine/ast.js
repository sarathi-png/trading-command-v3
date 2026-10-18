"use strict";
/**
 * Pine Script AST.
 *
 * The shape follows TradingView's grammar closely enough for the runtime:
 * statements are newline-terminated, blocks are indentation-delimited, and
 * expressions are a normal Pratt hierarchy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExpressionNode = isExpressionNode;
/* ---------------- helpers ---------------- */
function isExpressionNode(node) {
    return node.kind !== undefined &&
        !["varDecl", "assign", "tupleAssign", "if", "for", "while", "exprStmt", "function", "typeDecl", "program"].includes(node.kind);
}
