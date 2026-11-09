import { APP_NAME } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-gradient-to-br from-brand-900 via-brand-700 to-indigo-600">
            <main className="flex flex-1 items-center justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <div className="mb-6 text-center text-white">
                        <p className="text-4xl font-black tracking-tight">{APP_NAME}</p>
                        <p className="mt-1 text-sm text-brand-100">Run your Pokémon draft league in one place.</p>
                    </div>
                    {children}
                </div>
            </main>
            <footer className="pb-6 text-center text-xs text-brand-100/80">
                Pokémon data from PokéAPI. Not affiliated with Nintendo, Game Freak or The Pokémon Company.
            </footer>
        </div>
    );
}
