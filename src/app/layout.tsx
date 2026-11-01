import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Leyde Braga · Administração', template: '%s · Leyde Braga' }, description: 'Administração do catálogo Leyde Braga', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
