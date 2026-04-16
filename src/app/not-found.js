import Link from 'next/link'
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#090b11] text-white">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-semibold mb-2">Página no encontrada</h1>
        <p className="text-gray-400 text-sm mb-6">La dirección que buscas no existe o fue movida.</p>
        <Link href="/" className="px-5 py-3 rounded-lg bg-[#3dffa0] text-black font-medium inline-block">
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}
