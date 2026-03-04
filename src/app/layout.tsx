// File: `src/app/layout.tsx` (einfach: RootLayout bleibt Server-Komponente und verwendet Providers)
import "./globals.css";
import "./css/layout.css";
import "./css/typography.css";
import "./css/states.css";
import "./css/tables.css";
import "./css/infobox.css";
import "./css/overview.css";
import "./css/forms.css";
import "./css/forms-extra.css";
import "./css/components.css";
import "./css/lists.css";
import "./css/popovers.css";
import "./css/cards.css";
import "./css/processes.css";
import { ReactNode } from "react";
import type { Metadata } from "next";
import ClientHeader from "./ClientHeader";
import Providers from "./providers";

export const metadata: Metadata = {
    title: "Vereinskasse",
    description: "Vereinskasse",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="de">
        <body className="font-sans min-h-screen flex flex-col">
        <Providers>{/* SessionProvider umschließt die gesamte App */}
            <ClientHeader />
            <main className="flex-1">{children}</main>
        </Providers>
        </body>
        </html>
    );
}