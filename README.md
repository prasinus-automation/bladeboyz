# BladeBoyz

Browser-based multiplayer melee combat game with ultra-low-poly aesthetics and directional combat mechanics. Built with Three.js, Rapier3D physics, and bitECS.

## Prerequisites

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Development

```bash
npm run dev        # Start Vite dev server with HMR (port 3000)
```

## Build

```bash
npm run build      # Type-check + production build → dist/
npm run preview    # Preview production build locally
```

## Type Checking & Linting

```bash
npm run typecheck  # Run tsc --noEmit
npm run lint       # Run ESLint
```

## Docker

```bash
docker build -t bladeboyz .
docker run -p 3000:3000 bladeboyz
```

## Tech Stack

- **TypeScript** (strict mode)
- **Three.js** — 3D rendering
- **Rapier3D** — WASM physics engine
- **bitECS** — Entity Component System
- **Vite** — Build tool with HMR
