import type { Metadata, Viewport } from 'next';
import '@fontsource/permanent-marker';
import '@fontsource/patrick-hand';
import '@/styles/notebook.css';
import { AppShell } from '@/components/shell/AppShell';

export const metadata: Metadata = {
  title: 'LiftItUp — Workout & Rotation Tracker',
  description:
    'Minimal notebook workout tracker with rotation-queue scheduling, custom exercise library, progress charts, and AI plan import.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'LiftItUp',
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#ece2c6',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-[#f2b632] selection:text-[#1d1a16]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
