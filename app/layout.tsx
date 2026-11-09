import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
    title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
    description: "Run a Pokémon draft league: points-budget snake draft, tier lists, rosters and Showdown export.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen font-sans antialiased">
                <ToastProvider>{children}</ToastProvider>
            </body>
        </html>
    );
}
