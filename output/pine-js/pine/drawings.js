"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawingColor = drawingColor;
exports.normaliseDrawing = normaliseDrawing;
/**
 * Normalised view of the drawing objects a Pine script creates.
 *
 * Inside the runtime a drawing is a live mutable object (`box.new(...)` then
 * `box.set_top(...)`), which is exactly what Pine needs. The app, however,
 * wants plain JSON it can hand to the chart, so the raw objects are converted
 * once, after the run, into the shapes below.
 */
const values_1 = require("./values");
/** A CSS colour for any Pine value that may hold a colour. */
function drawingColor(value, fallback = "rgba(0, 0, 0, 0)") {
    if ((0, values_1.isColor)(value))
        return (0, values_1.valueToCss)(value);
    if (typeof value === "string" && value.startsWith("#"))
        return value;
    if (typeof value === "string" && value.startsWith("rgb"))
        return value;
    return fallback;
}
function num(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function str(value, fallback = "") {
    if (typeof value === "string")
        return value;
    if (value === null || value === undefined)
        return fallback;
    return (0, values_1.toDisplayString)(value);
}
/**
 * Convert a raw drawing into its serialisable form.
 *
 * `resolveTime` maps a bar index onto the time of that bar; drawings that
 * are anchored in time (`xloc = xloc.bar_time`) carry the time already.
 */
function normaliseDrawing(drawing, resolveTime) {
    if (drawing.deleted)
        return null;
    if (drawing.__drawing === "box") {
        const xloc = str(drawing.xloc, "bar_index");
        const left = num(drawing.left);
        const right = num(drawing.right);
        const leftTime = left === null ? null : xloc === "bar_time" ? left : resolveTime(left);
        const rightTime = right === null ? null : xloc === "bar_time" ? right : resolveTime(right);
        return {
            kind: "box",
            id: drawing.id,
            leftTime,
            rightTime,
            top: num(drawing.top),
            bottom: num(drawing.bottom),
            borderColor: drawingColor(drawing.borderColor),
            borderWidth: num(drawing.borderWidth) ?? 1,
            bgcolor: drawingColor(drawing.bgcolor),
            text: str(drawing.text),
            textColor: drawingColor(drawing.textColor, "#ffffff"),
        };
    }
    if (drawing.__drawing === "label") {
        const xloc = str(drawing.xloc, "bar_index");
        const x = num(drawing.x);
        return {
            kind: "label",
            id: drawing.id,
            time: x === null ? null : xloc === "bar_time" ? x : resolveTime(x),
            price: num(drawing.y),
            text: str(drawing.text),
            color: drawingColor(drawing.color),
            textColor: drawingColor(drawing.textcolor, "#ffffff"),
            style: str(drawing.style, "label_down"),
            size: str(drawing.size, "normal"),
        };
    }
    if (drawing.__drawing === "table") {
        const cells = Array.isArray(drawing.cells) ? drawing.cells : [];
        return {
            kind: "table",
            id: drawing.id,
            position: str(drawing.position, "top_right"),
            rows: num(drawing.rows) ?? 1,
            columns: num(drawing.columns) ?? 1,
            cells: cells.map((raw) => {
                const cell = (raw ?? {});
                return {
                    column: num(cell.column) ?? 0,
                    row: num(cell.row) ?? 0,
                    text: str(cell.text),
                    textColor: drawingColor(cell.textColor, "#c7ccd8"),
                    bgcolor: drawingColor(cell.bgcolor, "rgba(0, 0, 0, 0)"),
                    size: str(cell.size, "normal"),
                    halign: str(cell.halign, "left"),
                };
            }),
        };
    }
    return null;
}
