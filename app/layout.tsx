import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { TsdCapacitorRedirect } from '@/components/tsd-capacitor-redirect'
import { AppUpdateNotifier } from '@/components/app-update-notifier'
import { WmsUpdateProvider } from '@/components/wms-update-provider'

export const metadata: Metadata = {
  title: 'SCADA System | WMS',
  description: 'Warehouse Management System - SCADA System',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className="bg-background">
      <body className="font-sans antialiased">
        <TsdCapacitorRedirect />
        <WmsUpdateProvider>
          <AppUpdateNotifier />
          {children}
        </WmsUpdateProvider>
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
