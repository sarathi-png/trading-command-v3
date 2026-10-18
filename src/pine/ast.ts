/**
 * Pine Script AST.
 *
 * The shape follows TradingView's grammar closely enough for the runtime:
 * statements are newline-terminated, blocks are indentation-delimited, and
 * expressions are a normal Pratt hierarchy.
 */

export interface Pos {
  line: number;
  col: number;
}

export type Node = ProgramNode | Statement | Expression;

/* ---------------- expressions ---------------- */

export interface NumberLiteral extends Pos { kind: "number"; value: number; int: boolean }
export interface StringLiteral extends Pos { kind: "string"; value: string }
export interface BoolLiteral extends Pos { kind: "bool"; value: boolean }
export interface NaLiteral extends Pos { kind: "na" }
export interface Identifier extends Pos { kind: "ident"; name: string }
export interface MemberExpr extends Pos { kind: "member"; object: Expression; property: string }
export interface CallExpr extends Pos {
  kind: "call";
  callee: Expression;
  args: CallArg[];
  /** Stable id used to key per-call-site runtime state (Pine series semantics). */
  site: number;
}
export interface IndexExpr extends Pos { kind: "index"; object: Expression; offset: Expression }
export interface UnaryExpr extends Pos { kind: "unary"; op: "not" | "-" | "+"; argument: Expression }
export interface BinaryExpr extends Pos {
  kind: "binary";
  op: "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "and" | "or";
  left: Expression;
  right: Expression;
}
export interface TernaryExpr extends Pos {
  kind: "ternary";
  condition: Expression;
  whenTrue: Expression;
  whenFalse: Expression;
}
export interface TupleExpr extends Pos { kind: "tuple"; elements: Expression[] }
export interface ArrayLiteral extends Pos { kind: "array"; elements: Expression[] }

export interface CallArg {
  name: string | null;
  value: Expression;
}

export type Expression =
  | NumberLiteral | StringLiteral | BoolLiteral | NaLiteral | Identifier
  | MemberExpr | CallExpr | IndexExpr | UnaryExpr | BinaryExpr | TernaryExpr
  | TupleExpr | ArrayLiteral;

/* ---------------- statements ---------------- */

export interface VarDecl extends Pos {
  kind: "varDecl";
  /** "var" | "varip" | null (a plain assignment) */
  modifier: "var" | "varip" | null;
  typeName: string | null;
  name: string;
  value: Expression | null;
}

export interface AssignStmt extends Pos {
  kind: "assign";
  target: Expression;
  value: Expression;
  /** Assignment operators such as += are lowered to `target = target op value`. */
  op: string | null;
}

export interface TupleAssignStmt extends Pos {
  kind: "tupleAssign";
  /** The variables being assigned, in order. */
  names: string[];
  value: Expression;
}

export interface IfStmt extends Pos {
  kind: "if";
  condition: Expression;
  then: Block;
  otherwise: Block | IfStmt | null;
}

export interface ForStmt extends Pos {
  kind: "for";
  variable: string;
  from: Expression;
  to: Expression;
  by: Expression | null;
  body: Block;
}

export interface WhileStmt extends Pos {
  kind: "while";
  condition: Expression;
  body: Block;
}

export interface ExprStmt extends Pos { kind: "exprStmt"; expression: Expression }

export interface FunctionDecl extends Pos {
  kind: "function";
  name: string;
  returnType: string | null;
  params: Param[];
  body: Block;
}

export interface Param extends Pos {
  name: string;
  typeName: string | null;
  defaultValue: Expression | null;
}

export interface Block extends Pos { statements: Statement[] }

export interface ProgramNode extends Pos {
  kind: "program";
  body: Block;
  /** `indicator(...)` / `strategy(...)` declaration arguments, if present. */
  declaration: { type: "indicator" | "strategy" | "library"; args: CallArg[] } | null;
}

export type Statement =
  | VarDecl | AssignStmt | TupleAssignStmt | IfStmt | ForStmt | WhileStmt | ExprStmt
  | FunctionDecl;

/* ---------------- helpers ---------------- */

export function isExpressionNode(node: Node): node is Expression {
  return (node as Expression).kind !== undefined &&
    !["varDecl", "assign", "if", "for", "while", "exprStmt", "function", "program"].includes(
      (node as { kind: string }).kind
    );
}
