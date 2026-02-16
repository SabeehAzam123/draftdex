import "./globals.css";

export const metadata = {
    title: "Mini Admin Panel",
    description: "Testing-first reference app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <body style={{ fontFamily: "system-ui, Arial", margin: 0 }}>{children}</body>
        </html>
    );
}
