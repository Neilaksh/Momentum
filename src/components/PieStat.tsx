import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

type Props = {
  done: number;
  total: number;
  label: string;
  caption?: string;
  size?: number;
};

export function PieStat({ done, total, label, caption, size = 160 }: Props) {
  const safeTotal = Math.max(total, 0);
  const completed = Math.min(done, safeTotal);
  const remaining = Math.max(safeTotal - completed, 0);
  const pct = safeTotal ? Math.round((completed / safeTotal) * 100) : 0;
  const data =
    safeTotal === 0
      ? [{ name: "empty", value: 1 }]
      : [
          { name: "done", value: completed },
          { name: "left", value: remaining },
        ];

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={size * 0.32}
              outerRadius={size * 0.48}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              paddingAngle={safeTotal === 0 ? 0 : 2}
            >
              {data.map((entry, i) => (
                <Cell
                  key={entry.name}
                  fill={
                    safeTotal === 0
                      ? "var(--secondary)"
                      : i === 0
                        ? "var(--primary)"
                        : "var(--secondary)"
                  }
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-xl font-semibold">{pct}%</span>
          <span className="num text-[11px] text-muted-foreground">
            {completed}/{safeTotal}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground">
        {label}
      </p>
      {caption && <p className="num mt-0.5 text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}
