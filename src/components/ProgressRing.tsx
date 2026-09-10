type Props = {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
};

export function ProgressRing({ value, size = 88, stroke = 8, label, className }: Props) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className={`relative inline-flex shrink-0 items-center justify-center ${className ?? ""}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-secondary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="num absolute text-sm font-semibold text-foreground">
        {label ?? `${Math.round(clamped)}%`}
      </span>
    </div>
  );
}
