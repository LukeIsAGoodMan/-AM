"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  CreditCard,
  Receipt,
  FileText,
  Gift,
  Megaphone,
  Store,
  Calculator,
  LineChart,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, ready: false },
  { href: "/cards", label: "Cards", icon: CreditCard, ready: true },
  { href: "/rules", label: "Rules", icon: Receipt, ready: true },
  { href: "/sources", label: "Sources", icon: FileText, ready: true },
  { href: "/welcome-offers", label: "Welcome Offers", icon: Gift, ready: false },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, ready: false },
  { href: "/merchants", label: "Merchants", icon: Store, ready: false },
  { href: "/calculator-test", label: "Calculator", icon: Calculator, ready: true },
  { href: "/projection-test", label: "Projection", icon: LineChart, ready: false },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 px-3 py-4">
      <div className="px-2 pb-4 text-sm font-semibold text-neutral-900">
        Ask Mike
        <div className="text-xs font-normal text-neutral-500">
          HK Card Rewards — admin
        </div>
      </div>
      <nav className="space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          const baseClass =
            "flex items-center gap-2 rounded px-2 py-1.5 text-sm transition"
          if (!item.ready) {
            return (
              <div
                key={item.href}
                className={cn(
                  baseClass,
                  "cursor-not-allowed text-neutral-400",
                )}
                title="Not implemented yet (see roadmap)"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </div>
            )
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                baseClass,
                active
                  ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200"
                  : "text-neutral-700 hover:bg-white hover:text-neutral-900",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
