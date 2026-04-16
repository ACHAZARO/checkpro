export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#090b11] text-white">
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-600 border-t-[#3dffa0] rounded-full animate-spin" />
        Cargando…
      </div>
    </div>
  )
}
