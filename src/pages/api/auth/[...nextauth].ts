typescript
import NextAuth from "next-auth"
import KeycloakProvider from "next-auth/providers/keycloak"
import { JWT } from "next-auth/jwt"
import { Session, User, SessionStrategy } from "next-auth"

export const authOptions = {
    providers: [
        KeycloakProvider({
            clientId: process.env.KEYCLOAK_CLIENT_ID!,
            clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
            issuer: process.env.KEYCLOAK_ISSUER!
        }),
    ],
    session: {
        strategy: "jwt" as SessionStrategy
    },
    callbacks: {
        async jwt({ token, user }: { token: JWT; user?: User }) {
            if (user) token.id = user.id
            return token
        },
        async session({ session, token }: { session: Session; token: JWT }) {
            if (session.user) {
                (session.user as User & { id?: string }).id = token.id
            }
            return session
        }
    }
}

export default NextAuth(authOptions)