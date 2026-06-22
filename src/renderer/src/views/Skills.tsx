import { RefreshCw, Search, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, IconButton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAsync } from "@/lib/useAsync";

export default function Skills() {
  const { data, loading, error, reload } = useAsync(() =>
    window.omp.listSkills(),
  );
  const [query, setQuery] = useState("");

  const skills = useMemo(() => {
    const list = data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Skills</h1>
          <p className="truncate text-sm text-ink-muted">
            Specialized knowledge bundles discovered on disk
          </p>
        </div>
        <IconButton label="Reload skills" onClick={reload}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </IconButton>
      </div>

      <div className="shrink-0 px-6 pt-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter skills"
            className="w-full rounded-md border border-border bg-bg-raised py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : error ? (
          <EmptyState
            icon={<TriangleAlert className="h-6 w-6" />}
            title="Failed to load skills"
            hint={error}
          />
        ) : skills.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title={query ? "No matching skills" : "No skills found"}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {skills.map((skill) => (
              <Card key={skill.path} className="flex flex-col gap-2 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate font-mono text-sm text-ink">
                    {skill.name}
                  </span>
                  <Badge
                    variant={
                      skill.source === "project"
                        ? "accent"
                        : skill.source === "user"
                          ? "success"
                          : "muted"
                    }
                    className="ml-auto"
                  >
                    {skill.source}
                  </Badge>
                </div>
                <p className="line-clamp-4 text-xs text-ink-muted">
                  {skill.description}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
