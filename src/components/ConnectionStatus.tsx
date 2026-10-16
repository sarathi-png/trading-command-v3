/** Configuration presence only, deliberately not provider health or verified access. */
export default function ConnectionStatus({ configured, label = "Connection", detail }: { configured: boolean | null | undefined; label?: string; detail?: string }) {
  const known = typeof configured === "boolean";
  return <span className="inline-flex items-center gap-2 text-[11px]" title={detail ?? "Configuration presence does not verify connectivity, free quota or execution permission."}>
    <span aria-hidden="true" className={`connection-glow ${known ? configured ? "is-configured" : "is-missing" : "is-checking"}`} />
    <span>{label} · {known ? configured ? "Configured" : "Not configured" : "Checking"}</span>
  </span>;
}
