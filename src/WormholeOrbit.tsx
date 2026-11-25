import type { RefObject } from 'react';

export function WormholeOrbit({ anchor }: { anchor: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={anchor} className="orbit-art" aria-hidden="true">
      <img className="hero-orbit" src="/wormhole-orbit.svg" width="620" height="420" alt="" />
    </div>
  );
}
