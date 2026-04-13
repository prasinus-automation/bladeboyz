# BladeBoyz

Browser-based multiplayer melee combat game built with Three.js. Ultra-low-poly BattleBit-style aesthetic with Mordhau/Chivalry directional combat mechanics.

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
- **Click** — Lock mouse pointer (required for mouse look)

## Testing

```bash
npm test             # Run test suite
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type checking
```

## Tech Stack

- TypeScript (strict mode)
- Three.js (renderer)
- Rapier3D (physics)
- bitECS (entity component system)
- Vite (build tool)
- Vitest (testing)
