import { Sidebar } from "@/components/admin/sidebar"
import { EditLockControl } from "@/components/admin/edit-lock-control"
import { isEditUnlocked } from "@/lib/auth/edit-gate"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const unlocked = await isEditUnlocked()
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-x-auto">
        <div className="flex items-center justify-end border-b border-neutral-200 bg-white px-4 py-2">
          <EditLockControl unlocked={unlocked} />
        </div>
        {children}
      </main>
    </div>
  )
}
