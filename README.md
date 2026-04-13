# BladeBoyz

Browser-based multiplayer melee combat game with ultra-low-poly BattleBit-style aesthetic and Mordhau/Chivalry directional combat mechanics. Built with Three.js, Rapier3D, and bitECS.

## Getting Started

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server with HMR (http://localhost:3000)
npm run build        # Production build
npm run preview      # Preview production build locally
```

## Controls

- **WASD** — Move
- **Mouse** — Look around (requires pointer lock)
- **Shift** — Sprint
- **Ctrl** — Crouch
- **Space** — Jump
- **F5** — Toggle first-person / third-person camera
- **F3** — Toggle hitbox debug wireframes
- **Click** — Lock mouse pointer (required for mouse look)

## Testing & Checks

```bash
npm test             # Run test suite
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
```

## Tech Stack

- TypeScript (strict mode)
- Three.js (renderer)
- Rapier3D WASM (physics)
- bitECS (entity component system)
- Vite (build tool)
- Vitest (testing)
