import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Drop source sheets / Tiled leftovers / extract sidecars from dist (BootScene never loads them). */
function stripUnpublishedPublic(): Plugin {
  const relativeKill = [
    'assets/eric-warrior.png',
    'assets/prim-priestess.png',
    'assets/raizen-ninja.png',
    'assets/paste.png',
    'assets/captain-gully.png',
    'assets/maps/dungeon-room.json',
    'assets/maps/dungeon-room.tmj',
    'assets/generated/frame-map.json',
    'assets/generated/prim-frame-map.json',
    'assets/generated/raizen-frame-map.json',
    'assets/generated/paste-frame-map.json',
    'assets/generated/gully-frame-map.json',
    'assets/generated/slime.png',
    'assets/README.txt',
    'assets/audio/README.txt',
    'assets/.gitkeep',
  ];
  return {
    name: 'strip-unpublished-public',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist');
      for (const rel of relativeKill) {
        const full = path.join(dist, rel);
        try {
          fs.unlinkSync(full);
        } catch {
          /* missing is fine */
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // Off in prod: GitHub Pages would otherwise serve the ~11MB .js.map.
    sourcemap: false,
  },
  plugins: [stripUnpublishedPublic()],
});
