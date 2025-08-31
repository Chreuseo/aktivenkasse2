"use client"
import React, { useEffect, useState } from "react";
import { getProviders, signIn, ClientSafeProvider } from "next-auth/react";
import "@/app/css/forms.css";

export default function LoginPage() {
  const [providers, setProviders] = useState<Record<string, ClientSafeProvider> | null>(null);

  useEffect(() => {
    let mounted = true;
    getProviders()
      .then((p) => {
        if (mounted) setProviders(p || null);
      })
      .catch(() => {
        if (mounted) setProviders(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const hasKeycloak = Boolean(providers?.keycloak);

  return (
    <div className="form-container">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          signIn("keycloak", { callbackUrl: "/" });
        }}
      >
        <h2>Login</h2>
        <label>
          <span>Mit Keycloak anmelden</span>
        </label>

        <button className="button" type="submit">Anmelden mit Keycloak</button>

        {!hasKeycloak && (
          <div className="message">Keycloak-Provider nicht gefunden — versuche es später erneut.</div>
        )}
      </form>
    </div>
  );
}