import type { Metadata } from 'next'
import { Space_Grotesk, Atkinson_Hyperlegible } from 'next/font/google'
import './globals.css'

// Display face: confident, geometric, used sparingly for headings.
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-display',
})

// Body face: Atkinson Hyperlegible was designed by the Braille Institute
// specifically to maximize character distinction for low-vision readers.
// Using it as the *entire app's* body font (not just an accessibility
// mode) is the deliberate choice here — Atlas's internal tools should
// hold themselves to the same bar as the product they ship.
// If this font name isn't available in your next/font/google version,
// swap for another next/font/google entry and update tailwind.config.ts's
// --font-body accordingly.
const body = Atkinson_Hyperlegible({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'Atlas Dashboard',
  description: 'Tenant dashboard for the Atlas accessibility platform.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-body text-ink bg-paper min-h-screen antialiased">
        {children}
      </body>
    </html>
  )
}
