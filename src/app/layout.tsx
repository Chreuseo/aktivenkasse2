import './globals.css';
import { ReactNode } from 'react';
import ClientHeader from './ClientHeader';

export const metadata = {
    title: 'Aktivenkasse',
    description: 'Aktivenkasse Webanwendung',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="de">
        <body className="font-sans">
            <ClientHeader />
            <main>{children}</main>
        </body>
        </html>
    );
}