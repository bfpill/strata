import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { CuspBranchTracking } from '@/components/patterning/simulation/CuspBranchTracking'

export function SimulationPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 px-6 py-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors mb-3">
          <ArrowLeft size={14} />
          Back
        </Link>
        <h1 className="text-xl font-semibold text-zinc-900">Cusp Branch Tracking</h1>
        <p className="text-sm text-zinc-500 mt-1">Interactive cusp catastrophe simulation with covariance-based data controller</p>
      </header>
      <div className="p-6">
        <CuspBranchTracking />
      </div>
    </div>
  )
}
