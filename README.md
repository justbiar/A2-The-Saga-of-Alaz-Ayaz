# A2: The Saga of Alaz & Ayaz

A Web3 strategy game built on the Avalanche Fuji Testnet. Two elemental factions — Fire and Ice — battle across a floating island in a card-based, lane-pushing format inspired by MOBA and auto-battler mechanics. The game features AI-driven agents, on-chain player profiles, peer-to-peer multiplayer with AVAX betting, and a mana economy designed around strategic equilibrium rather than pure aggression.

Live at [a2saga.me](https://a2saga.me)


## Table of Contents

- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Game Overview](#game-overview)
- [Characters](#characters)
- [Skill Cards](#skill-cards)
- [Project Structure](#project-structure)
- [Smart Contracts](#smart-contracts)
- [Backend API](#backend-api)
- [Deployment](#deployment)
- [License](#license)


## Tech Stack

| Layer | Technology |
|-------|------------|
| Game Engine | BabylonJS 7 |
| Language | TypeScript |
| Bundler | Vite 5 |
| Blockchain | Avalanche Fuji Testnet (C-Chain, chainId 43113) |
| Web3 | ethers.js (loaded via CDN) |
| Smart Contracts | Solidity 0.8.24, Hardhat |
| Multiplayer | PeerJS (WebRTC P2P) |
| Backend | Express.js (bet settlement, escrow) |
| Hosting | GCP VM, nginx, certbot SSL |
| Internationalization | Custom i18n (TR / EN / ES) |


## Prerequisites

- Node.js 18+
- A browser wallet (MetaMask, Rabby, Phantom, etc.)
- Test AVAX from the [Avalanche Faucet](https://faucet.avax.network/)


## Getting Started

```bash
# Clone the repository
git clone https://github.com/justbiar/A2-The-Saga-of-Alaz-Ayaz.git
cd A2-The-Saga-of-Alaz-Ayaz

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open `http://localhost:5173` in your browser. The game will automatically prompt wallet connection and switch to Avalanche Fuji Testnet if needed.

### Build for Production

```bash
npm run build
```

Output is written to `dist/`.


## Game Overview

### Flow

1. **Main Menu** — Play, Characters, Story
2. **Team Select** — Fire or Ice faction
3. **Mode Select** — VS AI (single player) or 2-Player (P2P multiplayer)
4. **Difficulty Select** (VS AI only) — 7 layers of increasing difficulty, themed after Turkish mythological underworld tiers
5. **Battle** — Deploy cards onto a 3-lane battlefield, destroy the enemy base (1000 HP) to win

### Mana Economy

Mana refills each turn (MOBA-style, non-accumulating). Starting at 3 mana on turn 1, scaling up to a maximum of 12. Every card has a Mana Pressure Index that the AI agents factor into their deployment decisions.

### AVX Coins

Defeating enemy units drops collectible AVX coins on the battlefield. These are used to purchase mercenary units (neutral faction). AVX coins disappear after 8 seconds if not collected.

### Controls

- Left Click: Select a unit or collect AVX coins
- Right Click: Move the selected unit
- ESC: Deselect


## Characters

### Fire Faction

| Character | Mana | Armor | Ability |
|-----------|------|-------|---------|
| Korhan | 4 | 8 | Iron Armor — every 3rd hit reduces damage by 40% |
| Erlik | 5 | 1 | Dark Flame — 30% chance to burn on attack |
| Od | 7 | 2 | Blazing Fire — 20% chance to deal 50% bonus damage |

### Ice Faction

| Character | Mana | Armor | Ability |
|-----------|------|-------|---------|
| Ayaz | 3 | 10 | Hoarfrost — 4th attack freezes the target for 2s |
| Tulpar | 3 | 1 | Charge — first attack deals 2x damage |
| Umay | 4 | 2 | Mercy — heals nearest ally for 15 HP every 5s |

### Mercenaries (purchased with AVX coins)

| Character | AVX Cost | Armor | Ability |
|-----------|----------|-------|---------|
| Albasti | 3 | 2 | None |
| Sahmeran | 4 | 1 | Serpent Venom — poisons on every attack |
| Tepegoz | 5 | 12 | Earth Tremor — AoE stun every 8s |


## Skill Cards

Three consumable prompt cards available during battle:

| Card | Effect |
|------|--------|
| Mana Fill | Instantly refills mana to maximum |
| Mana Freeze | Prevents mana spending for 5 seconds |
| Ouroboros | Converts an enemy unit to your side |


## Project Structure

```
/
├── index.html                          # Single HTML entry (all CSS + markup)
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── src/
│   ├── main.ts                         # Boot, screen routing, UI rendering, game loop
│   ├── i18n.ts                         # Internationalization (TR / EN / ES)
│   │
│   ├── ai/
│   │   ├── MockKiteAI.ts              # Rule-based AI opponent
│   │   ├── KiteAIClient.ts            # AI service client
│   │   ├── KiteChainService.ts        # On-chain AI integration
│   │   └── KiteService.ts             # AI service interface
│   │
│   ├── audio/
│   │   └── SoundManager.ts            # BGM switching, volume/mute controls
│   │
│   ├── chain/
│   │   ├── BetService.ts              # AVAX bet escrow (deposit / settle / refund)
│   │   ├── LeaderboardService.ts      # Local leaderboard + weekly prize pool
│   │   └── ProfileService.ts          # On-chain profile (A2PlayerProfile) + localStorage fallback
│   │
│   ├── ecs/
│   │   ├── Unit.ts                    # Card definitions, stats, AI profiles
│   │   ├── UnitManager.ts            # Spawn, combat, preloading, animations
│   │   ├── PromptCard.ts             # Skill card definitions
│   │   ├── types.ts                   # StatusEffect, AIProfile, PromptCardDef
│   │   └── abilities/
│   │       ├── AbilitySystem.ts       # Ability registry, passive/status ticks
│   │       └── characterAbilities.ts  # 8 character abilities + mapping
│   │
│   ├── engine/
│   │   └── createEngine.ts            # BabylonJS engine initialization
│   │
│   ├── game/
│   │   └── GameState.ts               # Mana calculation, board control, equilibrium surge
│   │
│   ├── multiplayer/
│   │   └── MultiplayerService.ts      # PeerJS P2P (host/guest, bet messaging)
│   │
│   ├── pathfinding/
│   │   └── SimpleNavGraph.ts          # Navigation graph for unit movement
│   │
│   ├── scene/
│   │   ├── createScene.ts             # Scene setup, lights, shadows
│   │   ├── map/
│   │   │   ├── createAvaxMap.ts       # AVAX diamond-shaped floating island
│   │   │   ├── AvaShard.ts            # 3 capturable crystals
│   │   │   ├── BaseBuilding.ts        # Base buildings (1000 HP, dt-based attack)
│   │   │   ├── createAvaxMapFromGLB.ts
│   │   │   └── exportMapGLB.ts
│   │   ├── systems/
│   │   │   ├── cameraSystem.ts        # ArcRotateCamera setup
│   │   │   ├── inputSystem.ts         # Mouse/keyboard input handling
│   │   │   ├── movementSystem.ts      # Unit movement logic
│   │   │   └── winConditionSystem.ts  # Win/loss condition checks
│   │   └── units/
│   │       └── createHero.ts          # GLB hero model loader
│   │
│   └── utils/
│       └── wallet.js                  # Wallet connection utilities
│
├── server/
│   ├── index.js                       # Express API (settle, refund, distribute)
│   └── package.json
│
├── contracts/                          # Hardhat project (separate npm install)
│   ├── hardhat.config.ts
│   ├── contracts/
│   │   ├── A2PlayerProfile.sol        # Player profile registry (deployed)
│   │   ├── A2GameRegistry.sol         # Match recording (not deployed)
│   │   ├── AgentNFT.sol               # ERC-721 dynamic NFT for AI agents (not deployed)
│   │   ├── AvaToken.sol               # ERC-20 game token (not deployed)
│   │   ├── EvolutionForge.sol         # Agent evolution system (not deployed)
│   │   ├── MercenaryAuction.sol       # Mercenary marketplace (not deployed)
│   │   └── PromptCard.sol             # On-chain prompt cards (not deployed)
│   ├── scripts/
│   │   └── deployProfile.ts           # Deployment script for A2PlayerProfile
│   ├── test/
│   │   ├── AgentNFT.test.ts
│   │   └── AvaToken.test.ts
│   └── typechain-types/               # Auto-generated contract typings
│
├── assets/
│   ├── images/
│   │   ├── characters/                # Character portrait PNGs
│   │   ├── skills/                    # Skill card artwork
│   │   ├── textures/                  # Lava/ice terrain textures
│   │   └── gameplay/                  # 3D models (korhan.glb)
│   ├── sound/                         # BGM tracks (war, character select, story)
│   ├── sfx/                           # Sound effects
│   └── character animation/           # GLB animation files
│
└── deploy.sh                          # Production deployment script
```


## Smart Contracts

Built with Solidity 0.8.24 and Hardhat. Located in the `contracts/` directory with its own `package.json`.

| Contract | Purpose | Status |
|----------|---------|--------|
| A2PlayerProfile | Player registration, profile updates, score tracking | Deployed at `0xE5e7...720f` |
| A2GameRegistry | Match result recording | Not deployed (requires AgentNFT + AvaToken) |
| AgentNFT | ERC-721 dynamic NFTs with Proof-of-AI scoring and ERC-6551 TBA support | Not deployed |
| AvaToken | ERC-20 in-game token | Not deployed |
| EvolutionForge | Agent tier evolution system | Not deployed |
| MercenaryAuction | Mercenary unit marketplace | Not deployed |
| PromptCard | On-chain prompt/skill cards | Not deployed |

### Contract Development

```bash
cd contracts
npm install

# Compile
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Fuji
npx hardhat run scripts/deployProfile.ts --network fuji
```


## Backend API

An Express server that handles secure bet settlement using a house wallet. The private key never leaves the server. Runs on port 3001 behind an nginx reverse proxy.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Returns house wallet address and balance |
| `/api/settle` | POST | Sends prize to the match winner (2% house fee) |
| `/api/refund` | POST | Refunds the host if the guest never deposited |
| `/api/distribute` | POST | Admin-only: distributes weekly leaderboard prizes |

### Running the API Locally

```bash
cd server
npm install
# Create a .env file with HOUSE_WALLET_PK, ADMIN_KEY, and PORT
node index.js
```


## Deployment

The production site runs on a GCP VM with nginx and certbot SSL.

```bash
# 1. Build
npm run build

# 2. Upload to VM
gcloud compute scp dist/index.html a2saga:/tmp/ --zone=us-central1-c
gcloud compute scp dist/assets/*.js a2saga:/tmp/dist-js/ --zone=us-central1-c

# 3. Deploy on VM
gcloud compute ssh a2saga --zone=us-central1-c --command="
  sudo cp /tmp/index.html /var/www/html/
  sudo cp /tmp/dist-js/*.js /var/www/html/assets/
  sudo chmod -R 755 /var/www/html/assets/
"
```


## License

MIT
