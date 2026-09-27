import type { Metadata } from 'next';
import { Forum } from 'next/font/google';

import { LenisProvider } from '@/components/LenisProvider';

import './globals.css';

/** Forum everywhere. It ships a single weight (400) and no italic, so any bold
 *  on the page is synthesized by the browser; that is kept to display sizes. */
const forum = Forum({ weight: '400', subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Application Workspace',
  description: 'Accessible, human-approved job application intelligence.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={forum.variable}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <LenisProvider />
        {children}
      </body>
    </html>
  );
}
