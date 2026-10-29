import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import './page-header.css'

export function PageHeader({
  title,
  backTo,
  backLabel,
  backState,
}: {
  title: string
  backTo: string
  backLabel: string
  backState?: unknown
}) {
  return (
    <header className="subpage-header">
      <Link to={backTo} state={backState} aria-label={backLabel}>
        <ArrowLeft size={20} aria-hidden="true" />
      </Link>
      <h1>{title}</h1>
    </header>
  )
}
