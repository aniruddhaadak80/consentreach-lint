import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { PRODUCT } from '@/lib/product'
import './globals.css'

export const metadata: Metadata = {
  title: `${PRODUCT.name} — consent reach for AI systems`,
  description: PRODUCT.tagline,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/review', label: 'Review queue' },
  { href: '/plan', label: 'Re-consent plan' },
  { href: '/surfaces', label: 'Declarations' },
  { href: '/health', label: 'Health' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <div className="shell">
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                {PRODUCT.name}
              </Link>
              <nav className="site-nav" aria-label="Main">
                {NAV.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main>
            <div className="container">{children}</div>
          </main>

          <footer className="site-footer">
            <div className="container">
              <span>
                {PRODUCT.name} v{PRODUCT.version} — {PRODUCT.license}. Deterministic core, git-backed
                declarations.
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
