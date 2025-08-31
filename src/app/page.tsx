import React from 'react';
import '@/app/globals.css';

export default function Page(): JSX.Element {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans, Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial)',
      background: 'var(--color-background, #f7fafc)',
      color: 'var(--color-foreground, #111827)',
      padding: '2rem'
    }}>
      <h1 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', margin: 0 }}>Hallo Welt</h1>
    </main>
  );
}