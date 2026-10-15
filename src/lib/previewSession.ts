/** Opt-in sandbox fallback: signed, short-lived session, NEVER the password.
 * Memory works even when an embedded browser denies all storage. sessionStorage
 * is best-effort, tab-scoped only; never localStorage, URLs or external requests.
 */
const KEY = 'tc_preview_session';
let memory: string | null = null;
export function previewSession(): string | null {
  if (typeof window === 'undefined') return null;
  if (memory) return memory;
  try { memory = window.sessionStorage.getItem(KEY); } catch { /* sandbox denies storage */ }
  return memory;
}
export function setPreviewSession(token: string | null): void {
  memory = token;
  if (typeof window === 'undefined') return;
  try {
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch { /* memory-only fallback */ }
}
