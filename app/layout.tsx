import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Aangan Leads',
  description: 'Every call to Aangan Studio answered by Vaani, turned into a lead and chased to a designer.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
