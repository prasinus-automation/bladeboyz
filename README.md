# BladeBoyz

Browser-based multiplayer melee combat game with ultra-low-poly BattleBit-style aesthetic and Mordhau/Chivalry directional combat mechanics. Built with Three.js, Rapier3D, and bitECS.

## Getting Started

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server with HMR (http://localhost:3000)
npm run build        # Production build
npm run preview      # Preview production build locally
```

## Testing & Checks

```bash
npm run test         # Run unit tests (vitest)
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
```

## Controls

- **Click** to capture pointer lock
- **F3** to toggle hitbox debug wireframes

## Tech Stack

- TypeScript (strict mode)
- Three.js (renderer)
- Rapier3D WASM (physics)
- bitECS (entity component system)
- Vite (build tool)
