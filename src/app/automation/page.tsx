"use client";
import { Bot, Webhook, Send, ShieldCheck } from "lucide-react";
import { Chip, Panel } from "@/components/ui";
import { useApp } from "@/stores";

export default function AutomationPage() {
  const { system } = useApp();
  return (
    <div className="p-3 space-y-3 max-w-[900px] mx-auto">
      <div>
        <h1 className="text-[15px] font-semibold">Automation</h1>
        <p className="text-[11px] text-dim max-w-xl leading-relaxed">
          Automation modules are <span className="text-ink">optional and disabled by default</span>. Nothing on this page
          executes trades today — each module is a clearly-gated extension point. This is deliberate: the dashboard is
          analysis, monitoring and journal first; execution is an explicit upgrade.
        </p>
      </div>

      <Panel title="AUTOMATED EXECUTION" badge={<Chip>DISABLED</Chip>}>
        <div className="p-4 flex items-start gap-3">
          <Bot size={18} className="text-dim flex-none mt-0.5" />
          <div className="text-[11px] text-mut leading-relaxed space-y-2">
            <p>
              Future rule engine: <span className="num text-dim">IF</span> strategy signal + risk checks pass{" "}
              <span className="num text-dim">THEN</span> propose order → require confirmation (or auto-execute when armed).
            </p>
            <p>
              Even when built, automated execution will require <span className="text-warn">LIVE_EXECUTION_ENABLED=true</span>,
              LIVE mode, and the master switch — three independent gates.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="TRADINGVIEW WEBHOOK RECEIVER" badge={
        system?.webhook ? <Chip tone="warn">ENABLED</Chip> : <Chip>DISABLED BY DEFAULT</Chip>
      }>
        <div className="p-4 flex items-start gap-3">
          <Webhook size={18} className="text-dim flex-none mt-0.5" />
          <div className="text-[11px] text-mut leading-relaxed space-y-2">
            <p>
              Endpoint <span className="num text-ink">POST /api/integrations/tradingview/webhook</span> exists but rejects
              requests unless <span className="num text-warn">TRADINGVIEW_WEBHOOK_ENABLED=true</span> and the shared secret matches.
            </p>
            <p>
              Pipeline: validate → normalize into an internal Signal → strategy/risk review → your confirmation.
              Webhooks <span className="text-ink">never place orders directly</span>. Note: TradingView can only send webhooks
              if your TradingView plan supports alert webhooks — this system does not depend on that at all.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="TELEGRAM / EMAIL ALERTS" badge={<Chip>DISABLED</Chip>}>
        <div className="p-4 flex items-start gap-3">
          <Send size={18} className="text-dim flex-none mt-0.5" />
          <p className="text-[11px] text-mut leading-relaxed">
            External delivery channels are planned. Dashboard, sound and browser notifications are available now
            under <span className="text-ink">Alerts</span>.
          </p>
        </div>
      </Panel>

      <Panel title="SAFETY MODEL">
        <div className="p-4 flex items-start gap-3">
          <ShieldCheck size={18} className="text-accent flex-none mt-0.5" />
          <ul className="text-[11px] text-mut leading-relaxed space-y-1 list-disc pl-4">
            <li>READ ONLY is the default; paper trading is a separate explicit mode.</li>
            <li>Live execution needs env flag + LIVE mode + master switch + CoinDCX API credentials.</li>
            <li>Risk limits (daily loss, order value, leverage, positions) block orders before submission.</li>
            <li>Every mode change, arming event and order request is written to the audit log.</li>
          </ul>
        </div>
      </Panel>
    </div>
  );
}
