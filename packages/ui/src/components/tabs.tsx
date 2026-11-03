import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

type ClassNameless<T> = Omit<T, "className"> & { readonly className?: string };

export const Tabs = BaseTabs.Root;

export function TabList({ className, ...props }: ClassNameless<ComponentProps<typeof BaseTabs.List>>) {
  return (
    <BaseTabs.List
      {...props}
      className={cn("flex items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]", className)}
    />
  );
}

/** A noun-labelled section switch. The active tab carries weight and a raised tone, never a coloured underline. */
export function Tab({ className, ...props }: ClassNameless<ComponentProps<typeof BaseTabs.Tab>>) {
  return (
    <BaseTabs.Tab
      {...props}
      className={cn(
        "-mb-px inline-flex h-(--control) shrink-0 items-center gap-1.5 rounded-t-sm px-3 text-sm text-muted-foreground outline-none",
        "hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        "data-active:bg-raised data-active:font-medium data-active:text-foreground",
        className,
      )}
    />
  );
}

export function TabPanel({ className, ...props }: ClassNameless<ComponentProps<typeof BaseTabs.Panel>>) {
  return <BaseTabs.Panel {...props} className={cn("outline-none", className)} />;
}
