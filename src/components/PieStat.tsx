import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Props = {
  done: number;
  total: number;
  label: string;
  caption?: string;
  size?: number;
  color?: string;
  showTooltip?: boolean;
};

export function PieStat({
  done,
  total,
  label,
  caption,
  size = 160,
  color = "var(--primary)",
  showTooltip = false,
}: Props) {
  const safeTotal = Math.max(total, 0);
  const completed = Math.min(done, safeTotal);
  const remaining = Math.max(safeTotal - completed, 0);
  const pct = safeTotal ? Math.round((completed / safeTotal) * 100) : 0;
  const isComplete = safeTotal > 0 && completed >= safeTotal;

  const data =
    safeTotal === 0
      ? [{ name: "No target", value: 1 }]
      : [
          { name: "Completed", value: completed },
          { name: "Remaining", value: remaining },
        ];

  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative transition-all duration-300 ${
          isComplete ? "drop-shadow-[0_0_12px_rgba(200,255,100,0.25)]" : ""
        }`}
        style={{ width: size, height: size }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {showTooltip && safeTotal > 0 && (
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0];
                    return (
                      <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                        <span className="font-medium text-foreground">{item?.name}:</span>{" "}
                        <span className="num font-semibold text-primary">{item?.value}</span>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            )}
            <Pie
              data={data}
              dataKey="value"
              innerRadius={size * 0.32}
              outerRadius={size * 0.47}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              paddingAngle={safeTotal === 0 ? 0 : 3}
              cornerRadius={safeTotal === 0 ? 0 : 4}
            >
              {data.map((entry, i) => (
                <Cell
                  key={entry.name}
                  fill={
                    safeTotal === 0
                      ? "var(--secondary)"
                      : i === 0
                        ? color
                        : "var(--secondary)"
                  }
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`num font-bold tracking-tight transition-colors ${
              size < 120 ? "text-base" : size < 160 ? "text-lg" : "text-2xl"
            } ${isComplete ? "text-primary" : "text-foreground"}`}
          >
            {pct}%
          </span>
          <span className="num text-[11px] font-medium text-muted-foreground">
            {completed}/{safeTotal}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold tracking-wider uppercase text-muted-foreground text-center">
        {label}
      </p>
      {caption && <p className="num mt-0.5 text-xs text-muted-foreground text-center max-w-[200px]">{caption}</p>}
    </div>
  );
}

