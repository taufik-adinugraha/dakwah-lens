import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// In-module links only (basePath "/belajar" is applied by next/link).
// Links back to the main site must be plain <a href="/…"> — next/link would
// prefix them with /belajar and soft-navigate across apps (Next multi-zones).
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
