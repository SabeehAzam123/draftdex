"use client";

import { useState } from "react";
import { dex } from "@/lib/client/format";

/** A Pokémon's sprite (from PokéAPI's sprite repo), with a fallback when it can't load. */
export function Sprite({ id, name, size = 48 }: { id: number; name: string; size?: number }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (
            <span
                className="inline-flex items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-400"
                style={{ width: size, height: size }}
                aria-label={name}
            >
                ?
            </span>
        );
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`}
            alt={name}
            width={size}
            height={size}
            loading="lazy"
            className="sprite shrink-0"
            onError={() => setFailed(true)}
        />
    );
}

export function PokemonLabel({ id, name, size = 40 }: { id: number; name: string; size?: number }) {
    return (
        <span className="inline-flex items-center gap-2">
            <Sprite id={id} name={name} size={size} />
            <span>
                <span className="block font-medium text-slate-900">{name}</span>
                <span className="block text-xs text-slate-400">{dex(id)}</span>
            </span>
        </span>
    );
}
