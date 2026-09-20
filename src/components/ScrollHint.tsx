import { useState, useRef, useEffect, type ReactNode, type UIEvent } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScrollHintProps {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  hintText?: string;
}

export function ScrollHint({
  children,
  className,
  containerClassName,
  hintText = "Swipe for more",
}: ScrollHintProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);

  const checkScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const canScroll = el.scrollWidth - el.clientWidth - el.scrollLeft > 15;
    setCanScrollRight(canScroll);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, []);

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollLeft > 30 && !hasScrolled) {
      setHasScrolled(true);
    }
    const canScroll = el.scrollWidth - el.clientWidth - el.scrollLeft > 15;
    setCanScrollRight(canScroll);
  };

  return (
    <div className={cn("relative w-full", className)}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={cn(
          "w-full overflow-x-auto [overscroll-behavior-x:contain] [scrollbar-width:thin]",
          containerClassName,
        )}
      >
        {children}
      </div>

      {/* Right edge fade gradient */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background/90 to-transparent transition-opacity duration-300",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Floating swipe hint pill on mobile */}
      {canScrollRight && !hasScrolled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full border border-border/80 bg-card/95 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur transition-opacity duration-300 sm:hidden"
        >
          <span>{hintText}</span>
          <ChevronRight className="h-3 w-3 text-primary animate-pulse" />
        </div>
      )}
    </div>
  );
}
