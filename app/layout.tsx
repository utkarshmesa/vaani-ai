import type { ReactNode } from 'react';

export const metadata = {
  title: 'Aangan Leads',
  description: 'Vaani enquiry handling for Aangan Studio',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '0 auto', maxWidth: 960, padding: 16 }}>
        {children}
      </body>
    </html>
  );
}
