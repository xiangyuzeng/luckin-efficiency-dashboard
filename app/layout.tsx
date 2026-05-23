import type { Metadata } from 'next';
import './globals.css';
import { cssVars } from '@/lib/tokens';
import { labels } from '@/lib/labels';

export const metadata: Metadata = {
  title: `${labels.brand} · ${labels.appTitle}`,
  description: labels.appSubtitle,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root { ${cssVars} }` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
