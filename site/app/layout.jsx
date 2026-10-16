import './globals.css';

export const metadata = {
  title: 'Sphinx — outsource your thinking, not your understanding',
  description: 'A Git checkpoint for agent-assisted development. Before your agent’s code ships, Sphinx asks you a few questions about what it actually does.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
