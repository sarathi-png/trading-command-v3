"use client";
/**
 * Password gate shown when the API rejects the session (401).
 *
 * Why this exists: every /api route is auth-protected (see middleware.ts), so a
 * browser with no session cookie can read nothing — and the settings fetch
 * silently falling back to defaults used to make the onboarding wizard reappear
 * on every navigation. Surfacing a real login form makes the auth layer visible
 * instead of confusing it with app state.
 */
import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { setPreviewSession } from "@/lib/previewSession";
import { api, ApiError } from "@/lib/api";
import { Logo } from "./Onboarding";
import { Btn, Input } from "./ui";

export default function LoginGate({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    let passwordAccepted = false;
    try {
      const login = await api.post<{ previewToken?: string }>("/api/auth/login", { password, embeddedSession: true });
      passwordAccepted = true;
      setPreviewSession(login.previewToken ?? null);
      // Verify via the same authenticated client used throughout the app. This
      // works even when the sandbox blocks both cookies and browser storage.
      try {
        await api.get("/api/settings");
      } catch (err) {
        setPreviewSession(null);
        throw err;
      }
      setPassword("");
      onLoggedIn();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? passwordAccepted ? "Password accepted, but the sandbox rejected the session. Please report this message; repeating the password will not help." : "Wrong password."
          : err instanceof Error
            ? err.message
            : "Login failed — is the server running?"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-120 bg-bg grid-bg flex items-center justify-center p-4">
      <div className="panel w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-6">
          <Logo />
          <div>
            <p className="text-[13px] font-semibold tracking-[0.18em]">TRADING COMMAND</p>
            <p className="text-[10px] text-dim tracking-wide">PERSONAL TRADING INTELLIGENCE</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <p className="microlabel flex items-center gap-1.5">
              <KeyRound size={11} className="text-accent" /> DASHBOARD PASSWORD
            </p>
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="API_PASSWORD"
              className="w-full mt-1.5"
            />
          </div>

          {error && <p role="alert" className="text-[11px] text-dn">{error}</p>}

          <Btn
            type="submit"
            variant="primary"
            disabled={busy || !password}
            className="w-full justify-center"
          >
            {busy ? "CHECKING…" : "UNLOCK DASHBOARD"}
          </Btn>

          <p className="text-[10.5px] text-dim leading-relaxed flex gap-1.5">
            <ShieldCheck size={12} className="text-accent mt-0.5 shrink-0" />
            This is the password set as <span className="num text-mut">API_PASSWORD</span> on the
            server. All data routes require it; the session lasts 12 hours.
          </p>
        </form>
      </div>
    </div>
  );
}
