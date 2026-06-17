import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Ask Mike — HK Card Rewards",
  description: "Internal admin for HK credit card reward rules",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
