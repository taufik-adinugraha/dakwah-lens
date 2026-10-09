import { notFound } from "next/navigation";

// Any unknown /belajar/<locale>/… path renders the module's own (branded,
// localized) not-found page instead of Next's bare default.
export default function CatchAll() {
  notFound();
}
