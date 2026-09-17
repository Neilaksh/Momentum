import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // The toaster is fixed to the viewport top, so in the installed PWA (where we
  // opt into `viewport-fit=cover` + `black-translucent`) its default 16px offset
  // sits it under the status bar / notch. Safe-area-aware offsets lift it clear
  // and collapse to the previous spacing whenever the inset is 0. Both are
  // declared before `{...props}` so callers can still override them.
  return (
    <Sonner
      className="toaster group"
      offset={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      mobileOffset={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
