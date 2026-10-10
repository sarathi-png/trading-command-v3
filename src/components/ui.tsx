"use client";
import { MoreHorizontal, X } from "lucide-react";
import {
  useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { cx, pnlTone } from "@/lib/format";

/* ---------------- primitives ---------------- */

export function Panel({
  title, right, children, className, onHide, badge,
}: {
  title?: ReactNode; right?: ReactNode; children: ReactNode;
  className?: string; onHide?: () => void; badge?: ReactNode;
}) {
  return (
    <section className={cx("panel flex flex-col min-h-0", className)}>
      {(title || right || onHide) && (
        <header className="flex items-center gap-2 border-b border-edge px-3 h-9 flex-none">
          {title && <h3 className="microlabel">{title}</h3>}
          {badge}
          <div className="ml-auto flex items-center gap-1.5">{right}</div>
          {onHide && (
            <button
              onClick={onHide}
              title="Hide module"
              aria-label="Hide module"
              className="text-dim hover:text-ink p-1 rounded"
            >
              <MoreHorizontal size={13} />
            </button>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatusDot({
  tone, pulse, label,
}: { tone: "ok" | "warn" | "err" | "off" | "accent"; pulse?: boolean; label?: string }) {
  const color =
    tone === "ok" ? "text-up" : tone === "warn" ? "text-warn" : tone === "err" ? "text-dn"
    : tone === "accent" ? "text-accent" : "text-dim";
  return (
    <span className={cx("inline-flex items-center gap-1.5", color)} aria-label={label}>
      <span className={cx("dot bg-current", (pulse ?? tone === "ok") && "dot-live", pulse && "pulse-soft")} />
    </span>
  );
}

export function Chip({
  children, tone = "default", className,
}: { children: ReactNode; tone?: "default" | "up" | "dn" | "warn" | "accent" | "danger"; className?: string }) {
  const tones = {
    default: "bg-panel2 text-mut border-edge",
    up: "bg-up/10 text-up border-up/25",
    dn: "bg-dn/10 text-dn border-dn/25",
    warn: "bg-warn/10 text-warn border-warn/25",
    accent: "bg-accent-dim text-accent border-accent/25",
    danger: "bg-dn/15 text-dn border-dn/40",
  } as const;
  return (
    <span className={cx("inline-flex items-center gap-1.5 border rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline" | "up";
  size?: "sm" | "md";
};
export function Btn({ variant = "outline", size = "sm", className, ...rest }: BtnProps) {
  const variants = {
    primary: "bg-accent text-bg font-semibold hover:brightness-110 border border-accent",
    ghost: "bg-transparent text-mut hover:text-ink hover:bg-panel2 border border-transparent",
    outline: "bg-panel2 text-ink hover:border-edge2 border border-edge",
    danger: "bg-dn/15 text-dn border border-dn/35 hover:bg-dn/25",
    up: "bg-up/15 text-up border border-up/35 hover:bg-up/25",
  } as const;
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded transition-colors disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-8.5 px-4 text-[12px]",
        variants[variant],
        className
      )}
      {...rest}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "bg-bg2 border border-edge rounded px-2 h-7.5 text-[12px] text-ink placeholder:text-dim w-full focus:border-accent/50 outline-none",
        props.className
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "bg-bg2 border border-edge rounded px-1.5 h-7.5 text-[12px] text-ink outline-none focus:border-accent/50",
        props.className
      )}
    />
  );
}

export function Toggle({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative w-8 h-4.5 rounded-full transition-colors flex-none border",
        checked ? "bg-accent/25 border-accent/50" : "bg-bg2 border-edge",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 w-3 h-3 rounded-full transition-all",
          checked ? "left-4 bg-accent" : "left-0.5 bg-dim"
        )}
      />
    </button>
  );
}

export function Modal({
  open, onClose, title, children, width = "max-w-lg",
}: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx("relative panel w-full slide-in max-h-[88vh] flex flex-col", width)}>
        <header className="flex items-center justify-between border-b border-edge px-4 h-11 flex-none">
          <h2 className="text-[12px] font-semibold tracking-wide uppercase text-mut">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-dim hover:text-ink p-1">
            <X size={14} />
          </button>
        </header>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon, title, hint, action,
}: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
      {icon && <div className="text-dim">{icon}</div>}
      <p className="text-[12px] text-mut">{title}</p>
      {hint && <p className="text-[11px] text-dim max-w-70">{hint}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse bg-panel2 rounded", className)} />;
}

export function PnlValue({ v, className, signed = true }: { v: number | null | undefined; className?: string; signed?: boolean }) {
  if (v === null || v === undefined || Number.isNaN(v)) return <span className={cx("num text-dim", className)}>—</span>;
  const tone = pnlTone(v);
  return (
    <span className={cx("num", tone === "pos" ? "text-up" : tone === "neg" ? "text-dn" : "text-ink", className)}>
      {signed && v > 0 ? "+" : ""}{v < 0 ? "-" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
    </span>
  );
}

export function MetricCard({
  label, value, sub, tone = "flat", onHide, tooltip,
}: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: "flat" | "up" | "dn" | "accent"; onHide?: () => void; tooltip?: string;
}) {
  return (
    <div className="panel px-3 py-2.5 relative group min-w-0 metric-card-hover" title={tooltip}>
      <div className="flex items-center justify-between gap-2">
        <p className="microlabel truncate">{label}</p>
        {onHide && (
          <button
            onClick={onHide}
            aria-label={`Hide ${label}`}
            className="opacity-0 group-hover:opacity-100 text-dim hover:text-ink transition-opacity"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <div className={cx("num text-lg leading-6 mt-1 truncate",
        tone === "up" ? "text-up" : tone === "dn" ? "text-dn" : tone === "accent" ? "text-accent" : "text-ink")}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-dim mt-0.5 num truncate">{sub}</div>}
    </div>
  );
}

export function Spark({ data, tone = "accent", width = 96, height = 26 }: {
  data: number[]; tone?: "accent" | "up" | "dn"; width?: number; height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / span) * (height - 3) - 1.5}`).join(" ");
  const color = tone === "up" ? "var(--up)" : tone === "dn" ? "var(--dn)" : "var(--accent)";
  return (
    <svg width={width} height={height} className="block" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

export function KV({ k, v, mono = true }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px] text-dim">{k}</span>
      <span className={cx("text-[11px] text-ink text-right", mono && "num")}>{v}</span>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-edge px-2 flex-none" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "px-2.5 h-8 text-[11px] tracking-wide border-b-2 -mb-px transition-colors",
            active === t.id ? "border-accent text-ink" : "border-transparent text-dim hover:text-mut"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Confirmation modal helper used for destructive / live actions. */
export function useConfirm(): [
  (opts: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>,
  ReactNode,
] {
  const [state, setState] = useState<{
    title: string; body: ReactNode; confirmLabel: string; danger: boolean;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = (opts: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => {
      setState({
        title: opts.title,
        body: opts.body,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        danger: opts.danger ?? false,
        resolve,
      });
    });

  const node = (
    <Modal open={state !== null} onClose={() => { state?.resolve(false); setState(null); }} title={state?.title ?? ""}>
      <div className="text-[12px] text-mut leading-relaxed">{state?.body}</div>
      <div className="flex justify-end gap-2 mt-5">
        <Btn variant="ghost" onClick={() => { state?.resolve(false); setState(null); }}>Cancel</Btn>
        <Btn
          variant={state?.danger ? "danger" : "primary"}
          onClick={() => { state?.resolve(true); setState(null); }}
        >
          {state?.confirmLabel}
        </Btn>
      </div>
    </Modal>
  );
  return [confirm, node];
}
