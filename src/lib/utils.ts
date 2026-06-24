import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// shadcn convention — combine clsx variants + dedupe Tailwind classes.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
