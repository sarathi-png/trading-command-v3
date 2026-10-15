/** Public edits are annotations only; execution facts and provenance are immutable. */
export function annotationPatch(body: unknown): { id: string; notes?: string; emotion?: string; tags?: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Expected annotation object");
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some(k => !["id", "notes", "emotion", "tags"].includes(k))) throw Error("Only notes, emotion and tags can be edited; financial facts and provenance are read-only");
  if (typeof b.id !== "string" || !b.id || b.id.length > 128) throw Error("Invalid record ID");
  const patch: ReturnType<typeof annotationPatch> = { id: b.id };
  if (b.notes !== undefined) { if (typeof b.notes !== "string" || b.notes.length > 4000) throw Error("Invalid notes"); patch.notes = b.notes; }
  if (b.emotion !== undefined) { if (typeof b.emotion !== "string" || b.emotion.length > 80) throw Error("Invalid emotion"); patch.emotion = b.emotion; }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > 40 || b.tags.some(v => typeof v !== "string" || v.length > 80)) throw Error("Invalid tags");
    patch.tags = b.tags as string[];
  }
  if (Object.keys(patch).length === 1) throw Error("No annotation changes");
  return patch;
}
export function reservedJournalTag(tag: string): boolean {
  return ["paper", "partial", "automatic", "fifo-estimate", "sl", "tp"].includes(tag) || tag.startsWith("margin:") || tag.startsWith("market-source:");
}
