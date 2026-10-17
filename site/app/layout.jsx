import './globals.css';
import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: 'Sphinx — your agent wrote it. Can you explain it?',
  description: 'A comprehension checkpoint for AI-assisted code. Sphinx asks you to reason about your code changes before a commit or push continues.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
