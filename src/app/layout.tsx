import type { Metadata, Viewport } from 'next';
import '@fontsource/permanent-marker';
import '@fontsource/patrick-hand';
import '@/styles/notebook.css';
import { AppShell } from '@/components/shell/AppShell';
import {
  DEFAULT_THEME,
  DEFAULT_THEME_VARIANT,
  THEME_STORAGE_KEY,
  THEME_VARIANT_STORAGE_KEY,
} from '@/lib/theme';

const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var v=localStorage.getItem('${THEME_VARIANT_STORAGE_KEY}');if(t!=='notebook'&&t!=='cutecore'&&t!=='analog-horror'&&t!=='brazilian-phonk'&&t!=='future-funk'&&t!=='lofi-art'&&t!=='frutiger-aero')t='${DEFAULT_THEME}';if(v!=='light'&&v!=='dark')v='${DEFAULT_THEME_VARIANT}';var d=document.documentElement;d.dataset.theme=t;d.dataset.variant=t==='notebook'?v:'default';var c=t==='cutecore'?'#ffeaf2':t==='analog-horror'?'#0a0b0d':t==='brazilian-phonk'?'#09090d':t==='future-funk'?'#170b2b':t==='lofi-art'?'#1c1f33':t==='frutiger-aero'?'#cfeef7':(v==='dark'?'#171512':'#ece2c6');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',c);}catch(e){}})();`;

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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased selection:bg-[var(--selection-bg)] selection:text-[var(--selection-fg)]">
        <script
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
