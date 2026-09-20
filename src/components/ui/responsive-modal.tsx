import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

interface ResponsiveModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveModal({ open, onOpenChange, children }: ResponsiveModalProps) {
  const isMobile = useIsMobile();

  const props: { open?: boolean; onOpenChange?: (open: boolean) => void } = {};
  if (open !== undefined) props.open = open;
  if (onOpenChange !== undefined) props.onOpenChange = onOpenChange;

  if (isMobile) {
    return <Drawer {...props}>{children}</Drawer>;
  }

  return <Dialog {...props}>{children}</Dialog>;
}

export function ResponsiveModalTrigger({
  children,
  asChild,
  className,
}: {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const props: { asChild?: boolean; className?: string } = {};
  if (asChild !== undefined) props.asChild = asChild;
  if (className !== undefined) props.className = className;

  if (isMobile) {
    return <DrawerTrigger {...props}>{children}</DrawerTrigger>;
  }
  return <DialogTrigger {...props}>{children}</DialogTrigger>;
}

export function ResponsiveModalContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerContent
        className={cn(
          "max-h-[90dvh] flex flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto",
          className,
        )}
      >
        {children}
      </DrawerContent>
    );
  }

  return (
    <DialogContent className={cn("max-h-[90dvh] overflow-y-auto sm:max-w-lg", className)}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveModalHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerHeader className={cn("text-left p-0 pb-3 pt-2", className)}>{children}</DrawerHeader>
    );
  }
  return <DialogHeader className={cn("text-left pb-2", className)}>{children}</DialogHeader>;
}

export function ResponsiveModalTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerTitle className={cn("text-lg font-bold", className)}>{children}</DrawerTitle>;
  }
  return <DialogTitle className={cn("text-lg font-bold", className)}>{children}</DialogTitle>;
}

export function ResponsiveModalDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerDescription className={cn("text-xs text-muted-foreground", className)}>
        {children}
      </DrawerDescription>
    );
  }
  return (
    <DialogDescription className={cn("text-xs text-muted-foreground", className)}>
      {children}
    </DialogDescription>
  );
}

export function ResponsiveModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerFooter className={cn("p-0 pt-3 flex flex-col gap-2", className)}>
        {children}
      </DrawerFooter>
    );
  }
  return <DialogFooter className={cn("pt-3 sm:space-x-2", className)}>{children}</DialogFooter>;
}

export function ResponsiveModalClose({
  children,
  className,
  asChild,
}: {
  children: React.ReactNode;
  className?: string;
  asChild?: boolean;
}) {
  const isMobile = useIsMobile();
  const props: { asChild?: boolean; className?: string } = {};
  if (asChild !== undefined) props.asChild = asChild;
  if (className !== undefined) props.className = className;

  if (isMobile) {
    return <DrawerClose {...props}>{children}</DrawerClose>;
  }
  return <DialogClose {...props}>{children}</DialogClose>;
}
