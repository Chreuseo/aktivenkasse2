// File: `src/app/providers.tsx`
"use client";
import React from "react";
import { SessionProvider } from "next-auth/react";

type Props = { children: React.ReactNode; session?: any };

export default function Providers({ children, session }: Props) {
    // SessionProvider muss in einer Client-Komponente sein
    return <SessionProvider session={session}>{children}</SessionProvider>;
}