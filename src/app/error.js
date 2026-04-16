'use client'
export default function Error({ error, reset }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#090b11] text-white">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold mb-2">Algo salió mal</h1>
        <p className="text-gray-400 text-sm mb-6">{error?.message || 'Error inesperado.'}</p>
        <button onClick={() => reset()}
          className="px-5 py-3 rounded-lg bg-[#3dffa0] text-black font-medium">
          Reintentar
        </button>
      </div>
    </div>
  )
}
