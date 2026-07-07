import type { MemoryUsageSnapshot } from "@shared/domain";
import { useEffect, useState } from "react";
import { Popover } from "@/components/ui/Popover";
import { formatBytes } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const REFRESH_MS = 5_000;

function MemoryBreakdown({ data }: { data: MemoryUsageSnapshot }) {
  return (
    <dl className="space-y-1 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-ink">
      <div className="flex items-center justify-between gap-4">
        <dt className="text-ink-muted">App</dt>
        <dd className="tabular-nums text-ink">{formatBytes(data.appBytes)}</dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-ink-muted">
          OMP{data.ompInstanceCount > 0 ? ` (${data.ompInstanceCount})` : ""}
        </dt>
        <dd className="tabular-nums text-ink">{formatBytes(data.ompBytes)}</dd>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-1">
        <dt className="font-medium text-ink-muted">Total</dt>
        <dd className="font-medium tabular-nums text-ink">
          {formatBytes(data.totalBytes)}
        </dd>
      </div>
    </dl>
  );
}

export function TitlebarMemoryUsage() {
  const { data, reload } = useAsync(() => window.omp.getMemoryUsage(), []);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(reload, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  const label = data
    ? `Memory usage ${formatBytes(data.totalBytes)}`
    : "Memory usage";

  return (
    <div
      role="group"
      className="flex h-5 items-center self-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <Popover
        portal
        align="end"
        placement="bottom"
        open={open}
        onOpenChange={setOpen}
        className="h-5 items-center"
        contentClassName="min-w-[11rem]"
        trigger={({ triggerRef }) => (
          <button
            ref={triggerRef}
            type="button"
            aria-label={label}
            className="flex h-5 items-center rounded-full border border-border px-2 font-mono text-[11px] leading-none tabular-nums text-ink-muted transition-colors hover:border-border-strong hover:bg-bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {data ? formatBytes(data.totalBytes) : "—"}
          </button>
        )}
      >
        {data ? (
          <div
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <MemoryBreakdown data={data} />
          </div>
        ) : (
          <p className="px-2.5 py-1.5 text-[11px] text-ink-muted">Loading…</p>
        )}
      </Popover>
    </div>
  );
}
