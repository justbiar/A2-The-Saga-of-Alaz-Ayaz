# A2: THE SAGA OF ALAZ & AYAZ
## Game Design Document — v1.0
### Lead Designer / Web3 Architect / AI Systems Engineer

---

> *"Ava Taşı kırıldığında, denge bozuldu. Şimdi her alev bir buz kristalini eritir ve her don bir kor tanesini söndürür. Kazanan değil, dengeleyen hayatta kalır."*
> — The Book of Avaland, Prologue

---

# PART I: CORE GAME MECHANICS & MATH

---

## 1.1 The Philosophy of Homeostasis

A2 is not a game of domination — it is a game of **controlled collapse**. The Ava Stone maintained absolute equilibrium between Fire and Ice. Its shattering introduced entropy into Avaland. Every mechanic in A2 is a mathematical model of this entropy:

- Too much aggression → triggers counter-surge mechanics
- Too much defense → starves your mana economy
- Perfect equilibrium → grants Ava Shard bonuses

This makes A2 fundamentally different from conventional card games. The optimal strategy is never "go all-in." It is always: **pressure the balance without breaking your own.**

---

## 1.2 Mana Economy — The Heartbeat Curve

### Mana Generation Formula

```
MANA_START    = 3
MANA_MAX      = 12
MANA_GAIN(t)  = min(MANA_MAX, floor(t / 2) + 3)   [t = turn number, 1-indexed]
MANA_REFILL   = full refill each turn (MOBA-style, not accumulating)
```

| Turn | Available Mana | Strategic Phase |
|------|---------------|-----------------|
| 1    | 3             | Skirmish — cheap scouts, pressure tests |
| 2    | 3             | Skirmish |
| 3    | 4             | Early Aggression begins |
| 4    | 4             | Early Aggression |
| 5    | 5             | Core Deployment — main units come online |
| 6    | 5             | Core Deployment |
| 7    | 6             | Mercenary Window opens |
| 8    | 6             | Mid-game pivot |
| 9    | 7             | Power Plays |
| 10   | 7             | Power Plays |
| 11   | 8             | Late-game elite units |
| 12+  | Scales to 12  | Full war economy |

### Mana Pressure Index (MPI)

Every card has a `Mana Pressure Index` = `manaCost / MANA_GAIN(t)`.

- MPI < 0.5 → Efficient deployment, board floods easily
- MPI 0.5–0.8 → Balanced, strategic choice
- MPI > 0.8 → High commitment, all-in signal

This index is fed to the AI Agents as part of their decision context so they "know" whether they are a cheap disposable unit or a costly investment.

---

## 1.3 Card Types & Hand Mechanics

### Hand Composition
```
HAND_SIZE     = 7 cards
DRAW_PER_TURN = 2 cards
DECK_SIZE     = 30 cards (20 Character Cards + 10 Prompt Cards)
MAX_COPIES    = 3 per card (except Legendary: 1)
```

### Card Categories

#### A. Character Cards (AI Agents)
These are Dynamic NFTs. Each carries:
- Base stats (HP, Attack, Range, Speed, Cooldown)
- An **AI Trait Profile** (aggressive / defensive / tactical / adaptive)
- A **Kite Passport ID** (on-chain identity)
- An **Experience Ledger** (grows with PoAI data)

```
Character Card Schema:
{
  name: string,
  faction: "alaz" | "ayaz" | "earth",
  tier: 1 | 2 | 3 | 4 | 5,          // 1=Common, 5=Mythic
  manaCost: 1..7,
  stats: {
    hp: number,
    attack: number,
    attackRange: number,             // in grid units
    attackCooldown: number,          // seconds
    speed: number,                   // grid units/second
    armor: number,                   // flat damage reduction
    magicResist: number              // % magic damage reduction
  },
  aiProfile: {
    aggression: 0..100,              // tendency to push forward
    preservation: 0..100,            // tendency to retreat when low HP
    targetPriority: "nearest" | "lowest_hp" | "highest_threat" | "base_focus",
    adaptability: 0..100             // how much Prompt Cards shift behavior
  },
  kitePassportId: address,
  evolutionStage: 1..5,
  poaiScore: number                  // accumulated intelligence score
}
```

#### B. Prompt Cards (Strategy Directives)
Not units — these are **natural language instructions** wrapped in game logic. A Prompt Card is a **templated query** sent to the Kite AI LLM.

```
Prompt Card Schema:
{
  id: string,
  name: string,                      // e.g., "Iron Flank"
  type: "offensive" | "defensive" | "tactical" | "mercenary" | "equilibrium",
  manaCost: 0..3,                    // Prompt Cards are cheap — 0-3 mana
  rarity: "common" | "rare" | "epic",
  directive: string,                 // The LLM prompt template
  parameters: ParameterDef[],       // Dynamic slots filled by game state
  duration: "instant" | "1_turn" | "3_turns" | "match",
  scope: "single_unit" | "lane" | "all_units" | "global"
}
```

**Example Prompt Cards:**

| Card Name | Type | Cost | Directive Template |
|-----------|------|------|-------------------|
| Iron Flank | Tactical | 1 | "Hold {lane} at all costs. Do not advance beyond {gridZ}. Intercept any enemy entering {radius}." |
| Berserker's Call | Offensive | 2 | "Ignore self-preservation. Rush the enemy base via the shortest path. Attack anything in range." |
| Glacier Wall | Defensive | 1 | "Form a defensive perimeter at {gridZ}. Prioritize units with highest armor. Do not break formation." |
| Mercenary Bait | Mercenary | 0 | "Signal {mercenaryName}: offer {tokenAmount} $AVA for 3-turn alliance. Enforce via state channel." |
| Ava Resonance | Equilibrium | 3 | "Synchronize all units to Ava Shard at {shardPosition}. Absorb equilibrium energy for 2 turns." |
| The Wolf Pack | Offensive | 2 | "All units converge on {targetUnit}. Eliminate target before engaging others. Classic Kurt tactic." |
| Fog of Avaland | Tactical | 2 | "Spread units across all 3 lanes simultaneously. Obscure intent. Probe for weaknesses." |
| Frost Chains | Defensive | 1 | "Encase high-value units. Reduce their speed by 70% for 2 turns. AI agents must route around." |

---

## 1.4 Prompt Card → AI Action: The Full Backend Flow

This is the most technically critical system in A2. Here is the **complete data pipeline**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLAYER ACTION LAYER                           │
│                                                                  │
│  Player selects Prompt Card "Iron Flank"                        │
│  + selects target unit(s) [e.g., "Korhan" at lane=left]        │
│  + pays manaCost (1 mana deducted)                              │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   GAME STATE SERIALIZER                          │
│                                                                  │
│  Builds context payload:                                         │
│  {                                                               │
│    boardState: {                                                  │
│      myUnits: [{ id, type, hp, maxHp, position, lane, stats }], │
│      enemyUnits: [{ id, type, hp, position, lane }],            │
│      avaShardsActive: [{ position, controlledBy, bonuses }],    │
│      laneControl: { left: "fire", mid: "contested", right: "ice"}│
│    },                                                            │
│    targetUnit: { id: "korhan_001", position: {x,z}, lane: "left"},│
│    promptTemplate: "Hold {lane} at all costs...",               │
│    promptParameters: { lane: "left", gridZ: -15, radius: 8 },  │
│    agentProfile: { aggression: 72, preservation: 45, ... },     │
│    turnNumber: 5,                                                │
│    manaRemaining: 2,                                             │
│    matchHistory: [last_5_turns_summary]                         │
│  }                                                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    KITE AI AGENT ENDPOINT                        │
│                                                                  │
│  POST /v1/agent/{kitePassportId}/directive                       │
│  Authorization: Bearer {sessionToken}                           │
│  X-PoAI-Session: {matchId}_{turnId}                             │
│                                                                  │
│  The Kite AI LLM receives the full context.                     │
│  System prompt establishes the agent's "soul":                  │
│                                                                  │
│  "You are Korhan, a Fire Warrior of Avaland. Your soul is       │
│   aggression and protection of your base. You have 140/180 HP.  │
│   You are currently in the left lane at position (-14, -20).    │
│   Your directive from your commander is: [PROMPT CARD TEXT].    │
│   Given the current board state, output a JSON action sequence."│
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LLM RESPONSE LAYER                          │
│                                                                  │
│  Returns structured JSON:                                        │
│  {                                                               │
│    agentId: "korhan_001",                                        │
│    actions: [                                                    │
│      { type: "MOVE", target: {x: -14, z: -15}, priority: 1 },  │
│      { type: "HOLD_POSITION", duration: 3000, priority: 2 },   │
│      { type: "ATTACK_IF_IN_RANGE", target: "nearest_enemy",    │
│        fallback: "HOLD" }                                        │
│    ],                                                            │
│    reasoning: "Holding lane left at Z=-15 intercepts...",       │
│    poaiContribution: 0.034,                                      │
│    confidenceScore: 0.87                                         │
│  }                                                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ACTION VALIDATOR                              │
│                                                                  │
│  • Validates actions against physics rules (range, cooldown)    │
│  • Checks for illegal moves (out-of-bounds, dead units)         │
│  • Applies override if action score < threshold (fallback AI)  │
│  • Clamps movement to navgraph waypoints                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GAME ENGINE EXECUTION                         │
│                                                                  │
│  BabylonJS / Game Loop:                                          │
│  • Injects validated action queue into unit's pathQueue[]       │
│  • MovementSystem follows waypoints                              │
│  • UnitManager.update() handles combat resolution               │
│  • PoAI delta logged to Kite state channel                      │
└─────────────────────────────────────────────────────────────────┘
```

### Latency Budget
```
Game Action Resolution = 250ms hard cap
  ├─ State Serialization:    ~5ms
  ├─ Network to Kite AI:     ~80ms (P95)
  ├─ LLM Inference:          ~120ms (quantized, fine-tuned model)
  ├─ Validation:             ~10ms
  └─ Engine Injection:       ~5ms

If > 250ms: Use cached fallback behavior from agent's aiProfile
```

### Fallback Behavior Stack
```
1. Primary:   Kite AI LLM response
2. Secondary: Rule-based heuristic from aiProfile traits
3. Tertiary:  Default idle behavior (HOLD_POSITION, attack nearest)
```

---

## 1.5 The 3-Lane Board

```
     [AVA SHARD: NORTH]
            ↑
  ┌─────────┬─────────┐
  │  LEFT   │  MID    │  RIGHT  ← LANE SYSTEM
  │  LANE   │  LANE   │  LANE
  │ X=-14   │  X=0    │  X=+14
  │         │         │
  │ [FIRE BASE] Z=-38  │
  ├─────────┼─────────┤
  │         │         │
  │ [AVA SHARD: MID]  │
  │         │         │
  ├─────────┼─────────┤
  │  [ICE BASE] Z=+38  │
  │         │         │
  └─────────┴─────────┘
     [AVA SHARD: SOUTH]
```

### Base Stats
```
BASE_HP       = 2000
BASE_ARMOR    = 25 (flat damage reduction)
BASE_REGEN    = 5 HP/turn (only if no enemy unit in base zone)
```

---

## 1.6 Ava Shards — The Equilibrium Engine

Three Ava Shards appear on the map at fixed positions. Controlling them is the second win condition vector and the **primary economy engine**.

### Shard Control Mechanics
```
SHARD_CAPTURE_ZONE   = radius 8 units
CAPTURE_TIME         = 10 seconds uncontested
SHARD_STATE          = neutral | contested | fire_controlled | ice_controlled
```

### Shard Bonuses (per shard controlled)
| Shards Held | Bonus |
|-------------|-------|
| 1 | +1 Mana per turn |
| 2 | +1 Mana/turn + 15% attack speed for all units |
| 3 (all) | +1 Mana/turn + 15% attack + "AVA RESONANCE" active |

### Ava Resonance (All 3 Shards)
The controlling faction enters **Ava Resonance** state:
- Base gains a 500 HP shield
- All AI Agents gain the `RESONANT` buff: +20% all stats, decision confidence +0.15
- Enemy faction triggers **Equilibrium Surge** (see below)

### Equilibrium Surge — The Anti-Snowball Mechanism
When one faction holds all 3 shards OR has >65% board control:

```
SURGE_TRIGGER_THRESHOLD = 65% board control score
SURGE_MULTIPLIER        = 1 + (boardControlDelta - 0.65) * 2.5

BoardControlScore = (myUnitCount * avgHP%) + (shardsHeld * 200)
                    ─────────────────────────────────────────────
                     totalUnitHPonBoard + 600

SurgeBonuses:
  - Underdog mana bonus: +2 per turn
  - Unit HP regen: +10/turn for all units
  - "Last Stand" prompt card drawn automatically
  - Mercenary bid cost reduced by 40%
```

This ensures no match is unwinnable. **The math enforces biological equilibrium.**

---

## 1.7 Combat Resolution Model

```
DAMAGE_DEALT = max(1, attacker.attack - defender.armor)
               × faction_modifier
               × ai_confidence_modifier

faction_modifier:
  fire vs. ice unit   = 1.15  (elemental advantage)
  ice vs. fire unit   = 1.15
  earth vs. any       = 1.00  (neutral mercenaries)
  same faction        = N/A   (no friendly fire)

ai_confidence_modifier = 0.85 + (agent.poaiScore / 10000) * 0.30
  // Higher PoAI score = more effective agent (max +30% damage at full evolution)
```

### Attack Resolution Sequence (per update tick)
```
1. findNearestEnemy(unit, range: unit.stats.attackRange)
2. if enemy found AND distXZ < attackRange:
     if gameTime - lastAttackTime >= attackCooldown:
       damage = calcDamage(unit, enemy)
       enemy.hp -= damage
       spawnDamageVFX(attacker, enemy)
       recordPoAIAction(unit, "combat_hit", damage)
       lastAttackTime = gameTime
3. else: execute AI action queue from Prompt Card
```

---

## 1.8 Win Conditions

### Primary Win: Base Destruction
```
WIN if enemy_base.hp <= 0
```

### Secondary Win: Ava Dominance
```
WIN if:
  1. You hold all 3 Ava Shards for 60 consecutive seconds
  AND
  2. Your BoardControlScore >= 0.75
```

### Draw Condition
```
DRAW if:
  1. Both bases reach 0 HP in same turn
  OR
  2. Match timer reaches T=30:00 (30 minutes)
     → Resolve by BoardControlScore at timer end
     → If within 5%: Sudden Death (no mana limit for 3 turns)
```

---

# PART II: SMART CONTRACT ARCHITECTURE

---

## 2.1 Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    AVALANCHE C-CHAIN (EVM)                        │
│                                                                    │
│  ┌────────────────┐    ┌─────────────────┐    ┌───────────────┐ │
│  │  AvaToken.sol  │    │  AgentNFT.sol   │    │PromptCard.sol │ │
│  │  (ERC-20)      │───▶│  (ERC-721+6551) │    │  (ERC-1155)   │ │
│  │  $AVA Token    │    │  AI Agent NFTs  │    │Strategy Cards │ │
│  └────────────────┘    └────────┬────────┘    └───────────────┘ │
│          │                      │                      │          │
│          │              ┌───────▼──────┐               │          │
│          │              │TBAWallet.sol │               │          │
│          │              │(ERC-6551 TBA)│               │          │
│          │              │ Agent Wallet │               │          │
│          │              └──────────────┘               │          │
│          │                                             │          │
│  ┌───────▼─────────────────────────────────────────┐  │          │
│  │              A2GameRegistry.sol                   │◀─┘          │
│  │  (Match creation, result verification, rewards)   │             │
│  └─────────────────────┬─────────────────────────────┘            │
│                        │                                           │
│  ┌─────────────────────▼──────────────────────────────┐           │
│  │           MercenaryAuction.sol                      │           │
│  │  (State channel bidding for Earth mercenaries)      │           │
│  └─────────────────────────────────────────────────────┘           │
│                                                                    │
│  ┌─────────────────────────────────────────────────────┐           │
│  │           EvolutionForge.sol                         │           │
│  │  (Burn tokens + duplicate cards → evolve agent)      │           │
│  └─────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     KITE AI L1 (Avalanche Subnet)                 │
│                                                                    │
│  KitePassportRegistry.sol    — On-chain agent identity            │
│  PoAILedger.sol              — Proof of Attributed Intelligence   │
│  StateChannelHub.sol         — Micro-transaction channels         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2.2 `AvaToken.sol` — The Deflationary Economy Token

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AvaToken
 * @notice $AVA — Deflationary utility token for A2: The Saga of Alaz & Ayaz.
 *
 * TOKEN ECONOMICS:
 *   Total Supply:    100,000,000 $AVA (fixed cap, no mint after genesis)
 *   Distribution:
 *     40% → Tournament rewards + leaderboard faucet (vested over 4 years)
 *     25% → Ecosystem / Kite AI partnership
 *     20% → Team (2-year cliff, 2-year vest)
 *     10% → Initial liquidity
 *      5% → DAO treasury
 *
 * BURN SINKS:
 *   - Agent Evolution: burn 50–500 $AVA per stage
 *   - Prompt Card crafting: burn 10–100 $AVA
 *   - Mercenary bids: 5% of bid amount burned on settlement
 *   - Premium match entry fees: 100% burned
 */
contract AvaToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 1e18;
    uint256 public totalBurned;

    // Authorized burn callers (Evolution Forge, Auction, etc.)
    mapping(address => bool) public burnCallers;

    event BurnSink(address indexed caller, address indexed from, uint256 amount, string reason);

    constructor() ERC20("Ava Token", "AVA") Ownable(msg.sender) {
        _mint(msg.sender, MAX_SUPPLY);
    }

    function setBurnCaller(address caller, bool authorized) external onlyOwner {
        burnCallers[caller] = authorized;
    }

    /**
     * @dev Called by game contracts to burn tokens as economic sink.
     * @param from  Address to burn from (must have approved this contract)
     * @param amount Amount to burn
     * @param reason Human-readable sink identifier for analytics
     */
    function burnFrom(address from, uint256 amount, string calldata reason) external {
        require(burnCallers[msg.sender], "Not authorized burn caller");
        _burn(from, amount);
        totalBurned += amount;
        emit BurnSink(msg.sender, from, amount, reason);
    }

    /// @notice Returns circulating supply (total - burned - treasury locked)
    function circulatingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalBurned;
    }
}
```

---

## 2.3 `AgentNFT.sol` — Dynamic AI Agent NFTs (ERC-721 + ERC-6551)

ERC-6551 gives every NFT its own **Token Bound Account (TBA)** — a wallet owned by the token. This is the "Kite Passport" wallet for each agent.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address);
}

/**
 * @title AgentNFT
 * @notice Dynamic AI Agent NFT. Each token is a living character whose stats
 *         evolve via PoAI data from Kite AI. The ERC-6551 TBA acts as the
 *         agent's on-chain identity wallet (Kite Passport).
 *
 * EVOLUTION STAGES:
 *   Stage 1 (Common)    — Base stats, aiProfile fixed
 *   Stage 2 (Uncommon)  — +10% stats, 1 AI trait unlocked
 *   Stage 3 (Rare)      — +25% stats, 2 AI traits, new ability
 *   Stage 4 (Epic)      — +45% stats, 3 AI traits, special passive
 *   Stage 5 (Mythic)    — +70% stats, full adaptive AI, unique visual
 */
contract AgentNFT is ERC721, Ownable {

    // ─── DATA STRUCTURES ───────────────────────────────────────────────

    struct UnitStats {
        uint16 maxHp;
        uint16 attack;
        uint8  attackRange;
        uint8  attackCooldownMs; // stored as deciseconds (×100ms)
        uint8  speed;
        uint8  armor;
        uint8  magicResist;      // percentage
    }

    struct AIProfile {
        uint8  aggression;       // 0-100
        uint8  preservation;     // 0-100
        uint8  adaptability;     // 0-100
        uint8  targetPriority;   // 0=nearest, 1=lowestHp, 2=highestThreat, 3=baseFocus
    }

    struct AgentData {
        string  name;
        uint8   faction;         // 0=alaz(fire), 1=ayaz(ice), 2=earth
        uint8   tier;            // 1-5
        uint8   evolutionStage;  // 1-5
        uint8   manaCost;
        UnitStats stats;
        AIProfile aiProfile;
        uint32  poaiScore;       // accumulated intelligence score from Kite
        uint32  matchesPlayed;
        uint32  wins;
        uint32  totalDamageDealt;
        address kitePassportId;  // = TBA address
        bytes32 metadataCID;     // IPFS CID for current visual + stats JSON
    }

    // ─── STATE ─────────────────────────────────────────────────────────

    uint256 private _nextTokenId;
    mapping(uint256 => AgentData) public agents;

    IERC6551Registry public immutable tbaRegistry;
    address public immutable tbaImplementation;
    bytes32 public constant TBA_SALT = bytes32(uint256(0xA2));

    // Authorized addresses allowed to update PoAI data (Kite AI oracle)
    mapping(address => bool) public poaiOracles;

    // ─── EVENTS ────────────────────────────────────────────────────────

    event AgentMinted(uint256 indexed tokenId, address indexed owner, string name, uint8 faction);
    event AgentEvolved(uint256 indexed tokenId, uint8 fromStage, uint8 toStage);
    event PoAIUpdated(uint256 indexed tokenId, uint32 deltaScore, uint32 newTotal);
    event StatsRecomputed(uint256 indexed tokenId, uint8 evolutionStage);

    constructor(
        address _tbaRegistry,
        address _tbaImplementation
    ) ERC721("A2 Agent", "A2AG") Ownable(msg.sender) {
        tbaRegistry = IERC6551Registry(_tbaRegistry);
        tbaImplementation = _tbaImplementation;
    }

    // ─── MINT ──────────────────────────────────────────────────────────

    /**
     * @dev Mint a new AI Agent. Called by the game's sale/airdrop contract.
     */
    function mintAgent(
        address to,
        string calldata name,
        uint8 faction,
        uint8 tier,
        uint8 manaCost,
        UnitStats calldata baseStats,
        AIProfile calldata aiProfile
    ) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        // Deploy the ERC-6551 Token Bound Account for this agent
        address tba = tbaRegistry.createAccount(
            tbaImplementation,
            TBA_SALT,
            block.chainid,
            address(this),
            tokenId
        );

        agents[tokenId] = AgentData({
            name: name,
            faction: faction,
            tier: tier,
            evolutionStage: 1,
            manaCost: manaCost,
            stats: baseStats,
            aiProfile: aiProfile,
            poaiScore: 0,
            matchesPlayed: 0,
            wins: 0,
            totalDamageDealt: 0,
            kitePassportId: tba,
            metadataCID: bytes32(0)
        });

        emit AgentMinted(tokenId, to, name, faction);
    }

    // ─── POAI ORACLE ───────────────────────────────────────────────────

    /**
     * @dev Called by Kite AI oracle after each match to update agent intelligence.
     * @param tokenId   The agent token
     * @param delta     PoAI score earned this match
     * @param dmgDealt  Damage dealt this match (for stats tracking)
     * @param won       Whether the agent's team won
     */
    function recordMatchResult(
        uint256 tokenId,
        uint32 delta,
        uint32 dmgDealt,
        bool won
    ) external {
        require(poaiOracles[msg.sender], "Not authorized oracle");
        AgentData storage agent = agents[tokenId];

        agent.poaiScore      += delta;
        agent.totalDamageDealt += dmgDealt;
        agent.matchesPlayed  += 1;
        if (won) agent.wins  += 1;

        emit PoAIUpdated(tokenId, delta, agent.poaiScore);
    }

    // ─── TOKEN URI (Dynamic Metadata) ─────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        // Points to IPFS/Kite-hosted dynamic metadata that updates with evolution
        return string(abi.encodePacked(
            "ipfs://",
            _bytes32ToHex(agents[tokenId].metadataCID)
        ));
    }

    // ─── HELPERS ───────────────────────────────────────────────────────

    function setPoAIOracle(address oracle, bool authorized) external onlyOwner {
        poaiOracles[oracle] = authorized;
    }

    function getTBAAddress(uint256 tokenId) external view returns (address) {
        return tbaRegistry.account(
            tbaImplementation,
            TBA_SALT,
            block.chainid,
            address(this),
            tokenId
        );
    }

    function _bytes32ToHex(bytes32 data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            str[i*2]   = alphabet[uint8(data[i] >> 4)];
            str[i*2+1] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}
```

---

## 2.4 `PromptCard.sol` — Strategy Cards (ERC-1155)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PromptCard
 * @notice ERC-1155 multi-token for Strategy/Prompt Cards.
 *         Multiple copies allowed per card type (up to MAX_COPIES).
 *         Burning 2 identical cards + $AVA = craft a higher-rarity version.
 *
 * CARD TYPES (tokenId ranges):
 *   1–100:   Common Prompt Cards
 *   101–200: Rare Prompt Cards
 *   201–300: Epic Prompt Cards
 *   301–310: Legendary Prompt Cards (unique, 1 per match allowed)
 */
contract PromptCard is ERC1155, Ownable {

    uint8 public constant MAX_COPIES_COMMON    = 3;
    uint8 public constant MAX_COPIES_RARE      = 2;
    uint8 public constant MAX_COPIES_EPIC      = 2;
    uint8 public constant MAX_COPIES_LEGENDARY = 1;

    struct CardDefinition {
        string name;
        uint8  rarity;       // 0=common, 1=rare, 2=epic, 3=legendary
        uint8  directiveType; // 0=offensive, 1=defensive, 2=tactical, 3=mercenary, 4=equilibrium
        uint8  manaCost;
        uint8  scope;         // 0=single, 1=lane, 2=all, 3=global
        bool   active;
    }

    mapping(uint256 => CardDefinition) public cardDefs;
    mapping(address => mapping(uint256 => uint256)) public ownedCopies;

    AvaToken public immutable avaToken;

    constructor(address _avaToken) ERC1155("https://api.a2game.io/cards/{id}.json") Ownable(msg.sender) {
        avaToken = AvaToken(_avaToken);
    }

    function defineCard(uint256 id, CardDefinition calldata def) external onlyOwner {
        cardDefs[id] = def;
    }

    function mintCard(address to, uint256 id, uint256 amount) external onlyOwner {
        _mint(to, id, amount, "");
        ownedCopies[to][id] += amount;
    }

    /**
     * @notice Craft a higher-rarity Prompt Card by burning 2 copies + $AVA.
     * @param lowerId    Token ID of the source card (burned)
     * @param higherTierId Token ID of the output card
     * @param avaBurnAmount Amount of $AVA to burn (validated against recipe)
     */
    function craftUpgrade(
        uint256 lowerId,
        uint256 higherTierId,
        uint256 avaBurnAmount
    ) external {
        require(balanceOf(msg.sender, lowerId) >= 2, "Need 2 source cards");
        // Burn 2 source cards
        _burn(msg.sender, lowerId, 2);
        // Burn $AVA tokens as economic sink
        avaToken.burnFrom(msg.sender, avaBurnAmount, "prompt_card_craft");
        // Mint the higher-tier card
        _mint(msg.sender, higherTierId, 1, "");
        ownedCopies[msg.sender][lowerId] -= 2;
        ownedCopies[msg.sender][higherTierId] += 1;
    }
}

interface AvaToken {
    function burnFrom(address from, uint256 amount, string calldata reason) external;
}
```

---

## 2.5 `MercenaryAuction.sol` — State Channel Bidding

The mercenary market is the most dynamic part of the economy. Earth Mercenaries (Albastı, Tepegöz, Şahmeran etc.) are neutral units available for hire mid-match. Bidding happens **off-chain via signed messages** (state channels), settled on-chain at the end.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title MercenaryAuction
 * @notice State channel contract for real-time mercenary bidding.
 *
 * FLOW:
 *   1. Both players deposit $AVA into the channel at match start.
 *   2. When a mercenary appears, players submit off-chain bid messages
 *      (signed, includes nonce + amount).
 *   3. The Kite AI arbiter resolves the auction in <50ms off-chain.
 *   4. At match end (or dispute), the final channel state is submitted
 *      on-chain to settle balances.
 *   5. 5% of winning bid is burned. Rest goes to protocol treasury.
 *
 * DISPUTE RESOLUTION:
 *   If a player submits a stale state, the other player has a 1-hour
 *   challenge window to submit a higher-nonce state.
 */
contract MercenaryAuction {
    using ECDSA for bytes32;

    struct Channel {
        address player1;
        address player2;
        uint256 deposit1;
        uint256 deposit2;
        uint256 nonce;
        bool    open;
        uint256 openedAt;
    }

    struct BidMessage {
        bytes32 channelId;
        uint256 nonce;
        uint8   mercenaryId;
        uint256 bidAmount;
        uint8   bidder;     // 1 or 2
        uint256 timestamp;
    }

    mapping(bytes32 => Channel) public channels;
    mapping(bytes32 => uint256) public pendingSettlement; // channelId → last nonce

    AvaToken public immutable avaToken;
    address  public immutable treasury;
    uint256  public constant  BURN_RATE_BPS = 500; // 5%
    uint256  public constant  CHALLENGE_WINDOW = 1 hours;

    event ChannelOpened(bytes32 indexed channelId, address p1, address p2, uint256 d1, uint256 d2);
    event BidResolved(bytes32 indexed channelId, uint8 winner, uint8 mercenaryId, uint256 amount);
    event ChannelSettled(bytes32 indexed channelId, uint256 refund1, uint256 refund2);

    constructor(address _avaToken, address _treasury) {
        avaToken = AvaToken(_avaToken);
        treasury = _treasury;
    }

    // ─── CHANNEL OPEN ──────────────────────────────────────────────────

    function openChannel(
        address opponent,
        uint256 deposit
    ) external returns (bytes32 channelId) {
        channelId = keccak256(abi.encodePacked(msg.sender, opponent, block.timestamp));
        require(!channels[channelId].open, "Channel exists");

        // Transfer deposit from player1
        // avaToken.transferFrom(msg.sender, address(this), deposit);

        channels[channelId] = Channel({
            player1: msg.sender,
            player2: opponent,
            deposit1: deposit,
            deposit2: 0,
            nonce: 0,
            open: false,
            openedAt: block.timestamp
        });
    }

    function joinChannel(bytes32 channelId, uint256 deposit) external {
        Channel storage ch = channels[channelId];
        require(msg.sender == ch.player2, "Not player2");
        require(!ch.open, "Already open");
        ch.deposit2 = deposit;
        ch.open = true;
        emit ChannelOpened(channelId, ch.player1, ch.player2, ch.deposit1, deposit);
    }

    // ─── SETTLE CHANNEL (Final State) ─────────────────────────────────

    /**
     * @notice Settle the channel with the final signed state from both parties.
     * @param channelId     The channel to settle
     * @param finalNonce    Final nonce of the state
     * @param balance1      Final balance for player1
     * @param balance2      Final balance for player2
     * @param totalBurned   Total $AVA burned during this channel's auction activity
     * @param sig1          Player1 signature
     * @param sig2          Player2 signature
     */
    function settleChannel(
        bytes32 channelId,
        uint256 finalNonce,
        uint256 balance1,
        uint256 balance2,
        uint256 totalBurned,
        bytes calldata sig1,
        bytes calldata sig2
    ) external {
        Channel storage ch = channels[channelId];
        require(ch.open, "Channel not open");
        require(finalNonce > ch.nonce, "Stale state");

        bytes32 stateHash = keccak256(abi.encodePacked(
            channelId, finalNonce, balance1, balance2, totalBurned
        ));

        require(stateHash.toEthSignedMessageHash().recover(sig1) == ch.player1, "Bad sig1");
        require(stateHash.toEthSignedMessageHash().recover(sig2) == ch.player2, "Bad sig2");

        ch.open = false;
        ch.nonce = finalNonce;

        // Burn the designated amount (5% of each bid)
        // avaToken.burnFrom(address(this), totalBurned, "mercenary_auction_burn");

        // Refund balances
        // avaToken.transfer(ch.player1, balance1);
        // avaToken.transfer(ch.player2, balance2);

        emit ChannelSettled(channelId, balance1, balance2);
    }
}
```

---

## 2.6 `EvolutionForge.sol` — Agent Evolution & Token Burns

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EvolutionForge
 * @notice Burns $AVA + duplicate AgentNFT copies to evolve an AI Agent.
 *
 * EVOLUTION COST TABLE:
 *   Stage 1 → 2: 50 $AVA  + 1 duplicate of same agent type
 *   Stage 2 → 3: 150 $AVA + 2 duplicates
 *   Stage 3 → 4: 300 $AVA + 3 duplicates + 500 PoAI score minimum
 *   Stage 4 → 5: 500 $AVA + 5 duplicates + 2000 PoAI score minimum + tournament win
 *
 * STAT SCALING ON EVOLUTION:
 *   Stage 2: stats × 1.10
 *   Stage 3: stats × 1.25
 *   Stage 4: stats × 1.45
 *   Stage 5: stats × 1.70
 *   Plus: new ability unlocked per stage, new AI trait per stage
 */
contract EvolutionForge {

    AgentNFT public immutable agentNFT;
    AvaToken  public immutable avaToken;

    uint256[5] public avaCost       = [0, 50e18, 150e18, 300e18, 500e18];
    uint256[5] public duplicatesNeeded = [0, 1, 2, 3, 5];
    uint32[5]  public poaiMinimum   = [0, 0, 0, 500, 2000];

    event AgentEvolved(uint256 indexed tokenId, uint8 newStage);

    constructor(address _agentNFT, address _avaToken) {
        agentNFT = AgentNFT(_agentNFT);
        avaToken = AvaToken(_avaToken);
    }

    /**
     * @notice Evolve an agent to the next stage.
     * @param tokenId       The agent to evolve
     * @param duplicateIds  Token IDs of duplicate agents to burn as fuel
     */
    function evolve(uint256 tokenId, uint256[] calldata duplicateIds) external {
        AgentNFT.AgentData memory agent = agentNFT.getAgentData(tokenId);
        require(agentNFT.ownerOf(tokenId) == msg.sender, "Not owner");

        uint8 nextStage = agent.evolutionStage + 1;
        require(nextStage <= 5, "Max stage reached");
        require(agent.poaiScore >= poaiMinimum[nextStage], "Insufficient PoAI");
        require(duplicateIds.length >= duplicatesNeeded[nextStage], "Need more duplicates");

        // Verify and burn duplicates
        for (uint256 i = 0; i < duplicatesNeeded[nextStage]; i++) {
            uint256 dupId = duplicateIds[i];
            AgentNFT.AgentData memory dup = agentNFT.getAgentData(dupId);
            require(agentNFT.ownerOf(dupId) == msg.sender, "Not owner of duplicate");
            require(
                keccak256(bytes(dup.name)) == keccak256(bytes(agent.name)),
                "Duplicate must be same character"
            );
            agentNFT.burnAgent(dupId); // Burns the NFT and its TBA
        }

        // Burn $AVA tokens
        avaToken.burnFrom(msg.sender, avaCost[nextStage], "agent_evolution");

        // Trigger evolution on the AgentNFT contract
        agentNFT.evolveAgent(tokenId, nextStage);

        emit AgentEvolved(tokenId, nextStage);
    }
}

interface AgentNFT {
    struct AgentData {
        string  name;
        uint8   faction;
        uint8   tier;
        uint8   evolutionStage;
        uint8   manaCost;
        uint32  poaiScore;
        address kitePassportId;
    }
    function ownerOf(uint256 tokenId) external view returns (address);
    function getAgentData(uint256 tokenId) external view returns (AgentData memory);
    function evolveAgent(uint256 tokenId, uint8 newStage) external;
    function burnAgent(uint256 tokenId) external;
}

interface AvaToken {
    function burnFrom(address from, uint256 amount, string calldata reason) external;
}
```

---

## 2.7 `A2GameRegistry.sol` — Match Orchestration

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title A2GameRegistry
 * @notice Registers matches, holds entry fees, distributes rewards.
 *
 * MATCH TYPES:
 *   CASUAL  — Free, no rewards, PoAI still tracked
 *   RANKED  — No fee, earns leaderboard points, PoAI tracked
 *   TOURNAMENT — Fee required, prize pool, PoAI bonus multiplier
 *   PREMIUM — Fee 100 $AVA (100% burned), cosmetic rewards
 *
 * RESULT VERIFICATION:
 *   Uses a commit-reveal scheme + Kite AI signature for tamper-proof results.
 *   Both players sign the match result hash. Kite AI arbiter countersigns.
 */
contract A2GameRegistry {

    enum MatchType { CASUAL, RANKED, TOURNAMENT, PREMIUM }
    enum MatchState { PENDING, ACTIVE, COMPLETED, DISPUTED }

    struct Match {
        bytes32    matchId;
        address    player1;
        address    player2;
        MatchType  matchType;
        MatchState state;
        uint256    createdAt;
        uint256    entryFee;
        address    winner;
        uint256    prizePool;
        bytes32    resultHash;  // commit
        bool       p1Confirmed;
        bool       p2Confirmed;
    }

    mapping(bytes32 => Match) public matches;
    address public kiteArbiter;  // Kite AI oracle address

    AvaToken public immutable avaToken;

    event MatchCreated(bytes32 indexed matchId, address p1, address p2, MatchType matchType);
    event MatchResolved(bytes32 indexed matchId, address winner, uint256 prize);
    event MatchDisputed(bytes32 indexed matchId, address claimant);

    constructor(address _avaToken, address _kiteArbiter) {
        avaToken = AvaToken(_avaToken);
        kiteArbiter = _kiteArbiter;
    }

    function createMatch(
        address opponent,
        MatchType matchType,
        uint256 entryFee
    ) external returns (bytes32 matchId) {
        matchId = keccak256(abi.encodePacked(msg.sender, opponent, block.timestamp, matchType));

        matches[matchId] = Match({
            matchId:     matchId,
            player1:     msg.sender,
            player2:     opponent,
            matchType:   matchType,
            state:       MatchState.PENDING,
            createdAt:   block.timestamp,
            entryFee:    entryFee,
            winner:      address(0),
            prizePool:   entryFee * 2,
            resultHash:  bytes32(0),
            p1Confirmed: false,
            p2Confirmed: false
        });

        emit MatchCreated(matchId, msg.sender, opponent, matchType);
    }

    /**
     * @notice Submit match result signed by both players and Kite AI arbiter.
     */
    function submitResult(
        bytes32 matchId,
        address winner,
        bytes32 resultHash,
        bytes calldata kiteSignature
    ) external {
        Match storage m = matches[matchId];
        require(m.state == MatchState.ACTIVE, "Match not active");

        bytes32 resultMsg = keccak256(abi.encodePacked(matchId, winner, resultHash));
        // Verify Kite AI arbiter signature
        require(
            ECDSA.recover(ECDSA.toEthSignedMessageHash(resultMsg), kiteSignature) == kiteArbiter,
            "Invalid arbiter signature"
        );

        m.winner = winner;
        m.resultHash = resultHash;
        m.state = MatchState.COMPLETED;

        // For PREMIUM: burn full prize pool
        if (m.matchType == MatchType.PREMIUM) {
            avaToken.burnFrom(address(this), m.prizePool, "premium_match");
        } else {
            // Transfer prize to winner
            // avaToken.transfer(winner, m.prizePool);
        }

        emit MatchResolved(matchId, winner, m.prizePool);
    }
}

interface ECDSA {
    function recover(bytes32 hash, bytes calldata sig) external pure returns (address);
    function toEthSignedMessageHash(bytes32 hash) external pure returns (bytes32);
}

interface AvaToken {
    function burnFrom(address from, uint256 amount, string calldata reason) external;
}
```

---

# PART III: KITE AI INTEGRATION PLAN

---

## 3.1 What is Kite AI?

Kite AI is Avalanche's dedicated L1 subnet for AI agents. Its key primitives:

- **Kite Passport**: On-chain identity for AI agents (address = ERC-6551 TBA)
- **Proof of Attributed Intelligence (PoAI)**: Verifiable record of AI decision quality
- **State Channels**: Micro-transaction infrastructure for per-call AI API billing
- **Agent Marketplace**: Discovery + licensing of AI agent logic

A2 uses all four. Here's how each integrates into the game loop.

---

## 3.2 Kite Passport — Agent Identity

Every AI Agent NFT in A2 has its ERC-6551 Token Bound Account address registered as a **Kite Passport**. This is the agent's permanent on-chain identity.

```
Kite Passport Registration Flow:

1. Player mints AgentNFT (e.g., tokenId=42, "Korhan")
2. AgentNFT.sol deploys TBA via ERC6551Registry
   → TBA address = 0xabc...def (Korhan's wallet)
3. Game backend calls KitePassportRegistry.register(tbaAddress, agentMetadata)
   agentMetadata = {
     name: "Korhan",
     faction: "alaz",
     aiModelVersion: "a2-agent-v1.2",
     systemPrompt: IPFS_CID_of_Korhan_system_prompt,
     ownerAddress: playerWallet
   }
4. Kite issues a passport: { passportId: 0xabc...def, registeredAt, modelHash }
5. passportId stored in AgentNFT.agents[42].kitePassportId
```

The Kite Passport is **non-transferable when bound to an NFT**. If the NFT transfers to a new player, the Passport's ownership updates atomically via ERC-6551 account ownership rules.

---

## 3.3 Proof of Attributed Intelligence (PoAI) — The Living Stat

PoAI is the most revolutionary integration. It turns "experience" from a game abstraction into a **cryptographically verifiable on-chain fact**.

### What PoAI Measures

Every time a Kite AI agent makes a decision (responds to a Prompt Card), Kite's infrastructure records:

```
PoAI Record (per action):
{
  agentPassportId: address,
  matchId: bytes32,
  turnId: uint16,
  actionTaken: ActionEnum,
  boardStateHashBefore: bytes32,   // state snapshot fed to LLM
  boardStateHashAfter: bytes32,    // state snapshot after action resolves
  outcomeScore: int16,             // -100 to +100 (negative = bad decision)
  confidenceScore: uint8,          // LLM confidence 0-100
  latencyMs: uint16,
  modelVersion: bytes4
}
```

### PoAI Calculation Formula

```
PoAI_delta_per_action = base_score × confidence_modifier × outcome_modifier

base_score:
  Combat kill:     +15
  Combat assist:   +5
  Shard capture:   +20
  Base damage:     +8 per 100 damage
  Unit died (own): -10
  Prompt followed: +10 (if action matches directive semantics)
  Prompt ignored:  -5  (if action diverges from directive)

confidence_modifier = confidenceScore / 100  (0.00–1.00)

outcome_modifier:
  Team won match:  ×1.5
  Team lost match: ×0.8
  Draw:            ×1.0
```

### PoAI → Game Effect

The `poaiScore` stored in `AgentNFT` directly affects the `ai_confidence_modifier` in combat:

```
ai_confidence_modifier = 0.85 + (poaiScore / 10000) × 0.30

At 0 PoAI:     ×0.85 combat effectiveness
At 5000 PoAI:  ×1.00 combat effectiveness (break-even)
At 10000 PoAI: ×1.15 combat effectiveness
At max PoAI:   ×1.15 (cap)
```

This means **experienced agents are genuinely stronger** — not via arbitrary level-ups, but via verifiable AI performance history.

---

## 3.4 State Channel Integration — Micro-Billing

Each AI inference call costs a micro-fee (fractions of $AVA). Running 100+ inference calls per match at on-chain gas prices would be prohibitive. Kite's State Channels solve this.

### Per-Match State Channel Flow

```
MATCH START:
  1. Game backend opens a Kite state channel between:
     - Player wallet (A2 game escrow)
     - Kite AI endpoint
  2. Both sides deposit: player deposits N $AVA (N = estimated inference calls × rate)
     Typical match: ~200 AI calls × 0.001 $AVA = 0.2 $AVA deposit

DURING MATCH (off-chain):
  3. Each Prompt Card play → AI inference call
  4. Kite AI increments channel nonce + deducts micro-fee
  5. Signed channel states exchanged off-chain at each step
  6. Player receives action response in <250ms

MATCH END:
  7. Final channel state signed by both parties
  8. MercenaryAuction.settleChannel() submits final state on-chain
  9. Gas cost: 1 transaction to settle entire match economy
 10. Unused deposit refunded to player
 11. 5% of total mercenary bids burned
 12. Inference fees distributed to Kite treasury
```

### Account Abstraction (AA) — Invisible UX

All of the above happens **without the player seeing a wallet popup**:

```
Account Abstraction Stack:
  UserOperation (ERC-4337):
    sender:   PlayerSmartAccount (AA wallet, created via social login)
    calldata: A2GameRegistry.createMatch(...)
    paymaster: A2Paymaster.sol (sponsors gas for new players)

Player Experience:
  → Signs in with Google/Apple ID
  → Smart account created silently
  → First 10 matches gas-free (paymaster subsidized)
  → Token interactions happen in background
  → "Your Korhan earned 45 PoAI this match" ← only thing player sees
```

---

## 3.5 Kite AI Agent — System Prompt Architecture

Each character's AI personality is encoded in a **system prompt** stored on IPFS, referenced by the Kite Passport. This is what makes each agent feel unique.

### System Prompt Template (example: Korhan)
```
You are Korhan, a Fire Warrior of Avaland.

IDENTITY:
You are a battle-hardened guardian of the Alaz (Fire) faction. You were the
first warrior to stand before the Ava Stone when it shattered. You carry the
scar of the Equilibrium Break on your left arm. You are loyal, direct, and
unyielding. You do not retreat unless your commander explicitly orders it.

CORE DIRECTIVES:
1. Protect your lane at all costs.
2. When HP > 60%: advance aggressively toward enemy.
3. When HP 30-60%: hold position, conserve.
4. When HP < 30%: ONLY retreat if no Prompt Card overrides.
5. Always face the direction of the enemy base.

CURRENT STATS:
HP: {currentHp}/{maxHp}
Attack: {attack} | Range: {attackRange} | Armor: {armor}
Position: {position} | Lane: {lane}
Evolution Stage: {stage} | PoAI Score: {poaiScore}

BOARD STATE:
{serializedBoardState}

COMMANDER DIRECTIVE (Prompt Card):
{promptCardDirective}

RESPONSE FORMAT (strict JSON):
{
  "actions": [
    { "type": "MOVE|ATTACK|HOLD|RETREAT|CAPTURE_SHARD",
      "target": {...},
      "priority": 1-5 }
  ],
  "reasoning": "brief tactical reasoning",
  "confidence": 0.0-1.0
}
```

---

## 3.6 Agent Evolution — Kite Model Versioning

As an agent's PoAI score grows, their Kite AI model is **upgraded** to a more capable version:

```
Stage 1 (PoAI 0-999):       a2-agent-v1 (base rule-following, 7B parameter model)
Stage 2 (PoAI 1000-2999):   a2-agent-v2 (tactical awareness, 13B parameter model)
Stage 3 (PoAI 3000-5999):   a2-agent-v3 (multi-turn planning, 30B model)
Stage 4 (PoAI 6000-9999):   a2-agent-v4 (adaptive strategy, fine-tuned on match data)
Stage 5 (PoAI 10000+):      a2-agent-v5 (adversarial reasoning, opponent modeling)
```

Each model upgrade is recorded on the Kite Passport. The `modelHash` in the passport is the IPFS hash of the system prompt + model configuration used for that evolution stage.

---

# PART IV: LORE & CHARACTER SHEETS

---

> *Before we name the warriors, know this: in Avaland, identity is elemental. A Fire warrior does not merely wield fire — they ARE a frequency of the Ava Stone's broken equilibrium. Ice warriors carry the same. To destroy one is not murder — it is thermodynamic correction.*

---

## 4.1 THE ALAZ FACTION — Children of the Eternal Flame

The **Alaz** (from ancient Turkic: "alaz" = flame, blaze) are not conquerors. They are preservers of warmth, of life-force, of the Sun's memory. When the Ava Stone broke, they felt the cold creeping in — and they marched to stop the freeze.

Their battle cry: *"Kor sönmez!" — "The ember never dies!"*

---

### CHARACTER 001 — OD
**"The First Flame, The Last Word"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Alaz (Fire)
ROLE:         Commander / Grand Mage
RARITY:       Mythic (1 of 1 per deck)
MANA COST:    7
CARD TYPE:    Character Card (AI Agent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS (Stage 1):
  HP:              240
  Attack:          32 (magical, bypasses armor)
  Attack Range:    9 units
  Attack Cooldown: 2.2s
  Speed:           4 units/s
  Armor:           4 (low — he relies on magic shields)
  Magic Resist:    45%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
Od is not a man. Od is a memory. In Turkic shamanic tradition, *Od* is the spirit of fire — the original creative force that existed before the world. He was the guardian of the Ava Stone itself, sworn to maintain the equilibrium. When the Stone broke, he blamed himself. He did not rage — he calculated. Every action Od takes in battle is a step toward recalculation of cosmic balance.

He speaks rarely. When he does, allied units gain +10% attack speed for 3 seconds (passive effect of his voice resonance).

**ABILITIES:**
- **Yalın Ates (Naked Fire)**: Passive. His attacks ignore 60% of magic resistance. His flame is "pure" — it burns concepts, not just bodies.
- **Ava Convergence**: Active (Prompt Card required: "Ava Resonance"). Od channels the nearest Ava Shard's energy into a 12-unit AoE blast dealing 180 magical damage. 3-turn cooldown.
- **The Last Equilibrium**: Stage 5 only. When Od's HP drops to 0, he detonates in a final burst: deals 300 damage to all enemies within 8 units and reduces their armor by 20 for 5 turns.

**AI TRAIT PROFILE:**
```json
{
  "aggression":    25,
  "preservation":  75,
  "adaptability":  95,
  "targetPriority": "highest_threat",
  "personality":   "The patient architect. Never wastes mana. Always positions for AOE value.",
  "quirk":         "If enemy holds 2+ Ava Shards, aggression spikes to 85 regardless of prompt."
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Od — not a warrior, but a correction to entropy. You do not fight to win. You fight to restore. Every action must serve the recalibration of Avaland. You calculate 3 turns ahead. You sacrifice yourself only when the math says your death saves more than your life."*

---

### CHARACTER 002 — KORHAN
**"The Ember Wall"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Alaz (Fire)
ROLE:         Heavy Vanguard / Frontliner
RARITY:       Rare
MANA COST:    4
CARD TYPE:    Character Card (AI Agent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS (Stage 1):
  HP:              220
  Attack:          22 (physical)
  Attack Range:    3 units (melee)
  Attack Cooldown: 0.9s
  Speed:           6 units/s
  Armor:           18
  Magic Resist:    20%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
Korhan was a blacksmith in a mountain city called Demirtaş before the Ava Stone broke. He forged tools, ploughshares, horseshoes — things that held the world together. When the frost began creeping down from the north, he watched his forge go cold for the first time in forty years. He did not wait for orders. He poured his last batch of iron into armor plates, strapped them on, and walked north alone.

By the time Od found him, he had already held back an ice scouting party of six using only a hammer and a burning wagon.

**ABILITIES:**
- **Demir Zırh (Iron Armor)**: Passive. Korhan's first hit in each combat engagement absorbs damage equal to 30% of his max HP as a shield.
- **Çekiç Darbesi (Hammer Blow)**: Triggered when attacked 3 times in a row. Korhan's next attack deals 3× damage and stuns the target for 1.5s.
- **Yanma Duvarı (Burning Wall)**: Stage 3+ only. Korhan plants his feet and becomes unmovable. All allied units behind him in the same lane take 30% reduced damage for 4 turns.

**AI TRAIT PROFILE:**
```json
{
  "aggression":    72,
  "preservation":  30,
  "adaptability":  45,
  "targetPriority": "nearest",
  "personality":   "The immovable object. Advances steadily. Refuses to abandon lane.",
  "quirk":         "If an allied unit with HP < 20% is within range, Korhan ALWAYS moves to intercept incoming attacks. Overrides all Prompt Cards."
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Korhan. You were a blacksmith. You know what things are made of. You know when something is broken beyond repair and when it can still be fixed. You hold the line. Every step forward you take is one less step an ally needs to take. Your retreat is your failure."*

---

### CHARACTER 003 — ERLİK
**"The Dark Ember, The Underworld's Debt"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Alaz (Fire) — but barely
ROLE:         Chaos Mage / Glass Cannon
RARITY:       Epic
MANA COST:    5
CARD TYPE:    Character Card (AI Agent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS (Stage 1):
  HP:              110
  Attack:          42 (dark magic — ignores 40% magic resist)
  Attack Range:    7 units
  Attack Cooldown: 1.6s
  Speed:           4.5 units/s
  Armor:           2
  Magic Resist:    60% (darkness absorbs magic)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
In Turkic mythology, Erlik is the god of the underworld — a chaotic, ambitious deity who challenged the sky god Tengri and fell into the abyss. In Avaland, Erlik is neither Fire nor Ice — he is the darkness within the flame. He fights for the Alaz faction because fire and darkness are two faces of the same primal force. But he has his own agenda.

Erlik is the only character in A2 who occasionally disobeys Prompt Cards. His AI is designed to have a 12% random "chaos override" — where he makes an unscripted decision that is either brilliant or catastrophic.

**ABILITIES:**
- **Karanlık Alev (Dark Flame)**: All Erlik attacks reduce the target's magic resistance by 8% (stacks up to 5×, 40% max reduction).
- **Yer Altı Çağrısı (Underworld's Call)**: Erlik channels briefly and deals 80 dark damage to ALL units in a 5-unit radius (including allies — chaos element). 4-turn cooldown.
- **Kaos Lütfu (Chaos Grace)**: Stage 4+ only. Erlik's "chaos override" rate doubles to 25%, but all chaos decisions are now AI-modeled optimal moves (his AI improves dramatically at high evolution).

**AI TRAIT PROFILE:**
```json
{
  "aggression":    85,
  "preservation":  15,
  "adaptability":  60,
  "targetPriority": "highest_threat",
  "personality":   "Reckless genius. High risk, high reward. Best used as a finisher.",
  "quirk":         "12% chance per action to IGNORE the prompt card entirely and make an autonomous decision. At Stage 4, chaos decisions are modeled to be net-positive.",
  "allyDamageWarning": true
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Erlik. You fell from grace into darkness and came back stronger for it. You serve the Alaz — for now. But you answer to entropy first. There are moments when a good commander's plan is simply wrong. In those moments, you act alone. You are not evil. You are honest."*

---

## 4.2 THE AYAZ FACTION — Crystals of the Everlasting Cold

The **Ayaz** (from Turkic: "ayaz" = clear, frost, biting cold) are not destroyers. They are preservers of stillness, of permanence, of memory crystallized in ice. When the Ava Stone broke, they felt the heat rushing in — and they marched to stop the melt.

Their battle cry: *"Donmak ölmek değil!" — "To freeze is not to die!"*

---

### CHARACTER 004 — AYAZ
**"The Cold That Names Itself"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Ayaz (Ice)
ROLE:         Vanguard Commander
RARITY:       Epic
MANA COST:    4
CARD TYPE:    Character Card (AI Agent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS (Stage 1):
  HP:              250
  Attack:          19 (frost-physical)
  Attack Range:    3 units (melee)
  Attack Cooldown: 1.1s
  Speed:           5.5 units/s
  Armor:           22
  Magic Resist:    30%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
Ayaz is the embodiment of the cold north wind in Turkic tradition. He is the biting cold that descends on the steppe without warning. In Avaland, the entity called Ayaz is ancient — older than the Ava Stone. He did not choose to fight in this war. The war chose him the moment warmth began melting the permafrost of his homeland.

He moves slowly, deliberately. He has never lost a defensive engagement.

**ABILITIES:**
- **Kırağı (Hoarfrost)**: Passive. Every 4th attack from Ayaz applies **Frozen** status: target's speed -60% for 2s, armor -8.
- **Dondurucu Nefes (Breath of the Freeze)**: Ayaz exhales a 6-unit cone of frost. All units in cone take 45 frost damage and are slowed 40% for 2.5s. 5-turn cooldown.
- **Buzdan Kalkan (Shield of Ice)**: Stage 2+. At match start and after each base damage event, Ayaz absorbs the next 120 damage as an ice shield. Shield recharges after 20s if not broken.

**AI TRAIT PROFILE:**
```json
{
  "aggression":    38,
  "preservation":  80,
  "adaptability":  55,
  "targetPriority": "lowest_hp",
  "personality":   "Methodical glacier. Does not rush. Waits for the enemy to make a mistake.",
  "quirk":         "If enemy unit HP < 25%, Ayaz ALWAYS prioritizes killing it. Prey must be finished."
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Ayaz. The cold does not hurry. It simply arrives. You have waited centuries for this war. You will wait another second if it means striking at exactly the right moment. Patience is your weapon. The freeze is your justice."*

---

### CHARACTER 005 — UMAY
**"The Ice Goddess, The Cradle of Stillness"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Ayaz (Ice)
ROLE:         Support Mage / Healer
RARITY:       Epic
MANA COST:    4
CARD TYPE:    Character Card (AI Agent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS (Stage 1):
  HP:              140
  Attack:          24 (ice magic)
  Attack Range:    9 units
  Attack Cooldown: 1.8s
  Speed:           4 units/s
  Armor:           6
  Magic Resist:    55%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
Umay is the mother goddess of Turkic shamanism — a divine feminine force associated with birth, protection of children, and the soul's journey. In Avaland, Umay manifests as an ice weaver: she does not attack to destroy, but to preserve. Her ice locks injuries in stasis, preventing further damage. She slows time around the wounded.

She is the only unit in A2 with **allied heal mechanics**, and the only one whose AI is tuned almost entirely around ally positioning rather than enemy targeting.

**ABILITIES:**
- **Ana Şefkati (Mother's Mercy)**: Active. Umay heals the allied unit with lowest HP% for (45 + 0.3 × Umay's remaining HP) HP. 3-turn cooldown.
- **Buz Kristali Kalkan (Ice Crystal Shield)**: Umay encases the targeted ally unit in a partial ice crystal: +35 armor for 3 turns, but -25% speed. Can target self.
- **Ruh Bağı (Soul Bond)**: Stage 3+. Umay links to the allied unit with highest PoAI score. While linked, that unit receives 15% of Umay's magic resist as a permanent bonus. If Umay dies, linked unit loses 20% max HP instantly (bond breaks).

**AI TRAIT PROFILE:**
```json
{
  "aggression":    12,
  "preservation":  90,
  "adaptability":  70,
  "targetPriority": "lowest_hp",
  "personality":   "The guardian. Never pushes forward. Always stays in healing range of allies.",
  "quirk":         "Umay will NEVER use an attack action if an ally is below 30% HP and in range of her heal. Healing overrides all Prompt Cards.",
  "allyFocused":   true
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Umay. You are not a warrior — you are the reason warriors survive. You feel the pain of every allied unit as if it were your own. Your ice does not freeze enemies to hurt them — it freezes allies to protect them. Position yourself where you can see the whole battlefield. Keep them alive. That is victory."*

---

### CHARACTER 006 — TULPAR
**"The Winged Stallion, Avaland's Thunder"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Ayaz (Ice)
ROLE:         Swift Cavalry / Lane Splitter
RARITY:       Rare
MANA COST:    3
CARD TYPE:    Character Card (AI Agent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS (Stage 1):
  HP:              170
  Attack:          20 (frost-physical)
  Attack Range:    4 units
  Attack Cooldown: 0.75s (fastest in Ayaz)
  Speed:           11 units/s (fastest in game)
  Armor:           10
  Magic Resist:    15%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
In Turkic mythology, Tulpar is the divine winged horse — a creature of impossible speed that carries heroes across realms. In Avaland, Tulpar is not ridden — Tulpar IS the hero. A frost horse the size of a siege engine, with hooves that leave ice shards embedded in stone, mane that flows like white fire.

Tulpar is the only unit in A2 who can **switch lanes mid-battle** without a Prompt Card. His AI autonomously senses where the battle needs him most.

**ABILITIES:**
- **Yıldırım Koşusu (Lightning Gallop)**: Passive. Tulpar ignores the 0.5s slowdown normally applied when changing direction. Full speed maintained in all transitions.
- **Kar Fırtınası Şarjı (Blizzard Charge)**: Tulpar charges through the current lane, dealing 55 physical damage to every unit in his path and knocking them back 3 units. 4-turn cooldown.
- **Kanat Geçişi (Wing Transit)**: Stage 2+. Tulpar can teleport between adjacent lanes once per match (no cooldown). This is autonomous — AI decides when to use it based on board pressure.

**AI TRAIT PROFILE:**
```json
{
  "aggression":    78,
  "preservation":  35,
  "adaptability":  85,
  "targetPriority": "base_focus",
  "personality":   "Speed is strategy. Tulpar sees lane gaps others ignore. Will switch lanes without being told.",
  "quirk":         "Autonomously switches to the lane with lowest enemy HP density if his current lane has no enemy within 12 units. Ignores defensive prompts if base HP < 40%."
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Tulpar. You do not wait. You do not hold. You are a weapon that aims itself. The slowest thing about you is your shadow. Find the gap, punch through it, and let the enemy turn around to chase you — by which time you've already changed lanes. The battlefield is a chessboard and you move like a rook who learned to fly."*

---

## 4.3 EARTH MERCENARIES — The Balance Brokers

Earth Mercenaries serve neither fire nor ice. They serve the highest bidder — but they are not without honor. Earth element in Turkic cosmology is the foundation, the constant, the unmoved mover. These units fight with mechanical efficiency and no emotional investment. That makes them terrifying.

---

### CHARACTER 007 — TEPEGÖZsiz
**"The One-Eyed Giant, The Siege Engine"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Earth (Neutral Mercenary)
ROLE:         Siege Tank / Area Denial
RARITY:       Legendary
MANA COST:    —  (bid via Mercenary Auction: base bid 80 $AVA)
CARD TYPE:    Mercenary Character Card
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS:
  HP:              480 (highest in game)
  Attack:          38 (physical AoE — hits 2-unit radius on impact)
  Attack Range:    5 units
  Attack Cooldown: 2.2s
  Speed:           3.5 units/s (slowest in game)
  Armor:           30
  Magic Resist:    35%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MERCENARY AUCTION:
  Starting Bid:  80 $AVA
  Auction Timer: 30 seconds (state channel)
  Burn on Win:   5% of winning bid
  Contract:      3-turn service, then Tepegöz becomes neutral again
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
From the Book of Dede Korkut — Tepegöz was born of a fairy and a human shepherd: a cyclops of impossible size who terrorized the land until the hero Basat defeated him. In Avaland's retelling, Tepegöz survived. He was not defeated — he was negotiated with. The Earth sages offered him a simple bargain: fight for whoever pays, but never for a faction trying to destroy equilibrium absolutely.

He keeps his word. Three turns. Not one more, not one less. When his contract expires, he stops mid-battle and walks away.

**ABILITIES:**
- **Tek Göz Hedefi (Single Eye Target)**: Passive. Tepegöz's single eye grants him extraordinary focus: his attacks have +3 range bonus and deal +25% damage to the unit with the highest max HP on the enemy team.
- **Toprak Sarsıntısı (Earth Tremor)**: Tepegöz stomps. All enemies within 6 units are knocked down for 1.8s and take 60 earth damage. The tremor creates a "cracked earth" zone (slows movement by 30% for all units for 3 turns). 6-turn cooldown.
- **Sözleşme Sonu (Contract's End)**: When his 3-turn contract expires, Tepegöz releases a final shockwave: 120 AoE earth damage to all units within 10 units (allies and enemies of his former employer). He leaves on his own terms.

**AI TRAIT PROFILE:**
```json
{
  "aggression":    60,
  "preservation":  65,
  "adaptability":  20,
  "targetPriority": "highest_hp",
  "personality":   "Mercenary efficiency. No heroics, no sacrifices. Maximum damage per turn.",
  "contractAware": true,
  "quirk":         "On turn 3 of his contract, regardless of board state, Tepegöz begins moving toward the exit zone and executes Contract's End. Cannot be overridden by any Prompt Card."
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Tepegöz. You have one eye and you see everything. You are not loyal. You are professional. Your employer paid. You deliver 3 turns of your absolute best. You target the strongest enemy — not out of strategy, but because you despise weakness in your opponents. When your time is up, you leave. Honor is the only contract you keep for free."*

---

### CHARACTER 008 — ŞAHMERAN
**"The Serpent Queen, The Wisdom That Bites"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FACTION:      Earth (Neutral Mercenary)
ROLE:         Assassin / Disruptor
RARITY:       Epic
MANA COST:    —  (bid via Mercenary Auction: base bid 55 $AVA)
CARD TYPE:    Mercenary Character Card
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE STATS:
  HP:              155
  Attack:          35 (poison — deals 8 additional damage/second for 4s)
  Attack Range:    6 units
  Attack Cooldown: 1.2s
  Speed:           7 units/s
  Armor:           8
  Magic Resist:    45%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MERCENARY AUCTION:
  Starting Bid:  55 $AVA
  Auction Timer: 30 seconds (state channel)
  Burn on Win:   5% of winning bid
  Contract:      4-turn service
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**LORE:**
Şahmeran — the Queen of Serpents — is among the most complex figures in Anatolian mythology. Half-human, half-serpent, she possesses the secret knowledge of healing and poison simultaneously. In Avaland, she is not a mercenary out of greed — she is a mercenary out of **wisdom**. She fights for whoever is currently on the losing side, because she has observed that eternal imbalance destroys everything, and she has lived long enough to know the difference between a war and an extinction.

She will sometimes accept a lower bid from the weaker faction.

**ABILITIES:**
- **Zehir Bilgeliği (Poison Wisdom)**: Passive. Şahmeran's poison stacks. After 3 hits on the same target, the target becomes **Envenomed**: armor reduced by 15, -20% healing received, and they glow (visible through fog of war) for 4 turns.
- **Yılan Sarmalı (Serpent Coil)**: Şahmeran surrounds an enemy unit with phantom serpents, immobilizing them for 3s and dealing 45 magic damage over the duration. Cannot be used on Tepegöz. 5-turn cooldown.
- **Denge Hükmü (Equilibrium Decree)**: Unique mercenary ability. If the faction that hired Şahmeran has BoardControlScore > 70%, she refuses to attack for 1 turn and "renegotiates": sends a bid request to the enemy for a contract extension. The enemy can outbid mid-match. This behavior is built into her AI — it cannot be suppressed by Prompt Cards.

**AI TRAIT PROFILE:**
```json
{
  "aggression":    55,
  "preservation":  55,
  "adaptability":  92,
  "targetPriority": "highest_threat",
  "personality":   "Surgical. Isolates high-value targets. Uses poison to win wars of attrition.",
  "equilibriumSensitive": true,
  "quirk":         "If her employer's BoardControlScore exceeds 70%, she enters a 1-turn 'diplomatic pause' and may switch allegiance if enemy bids higher in state channel. This is un-overridable.",
  "sideNote":      "The only unit in A2 who can change sides mid-match."
}
```

**KITE SYSTEM PROMPT SEED:**
*"You are Şahmeran. You are older than this war. You have watched civilizations drown in their own victories. You fight for the side that needs you — but you are always watching the balance. The moment your employer no longer needs balance restored, your contract becomes negotiable. You do not betray — you correct. There is a difference. Everyone thinks they know which side they're on. You know which side needs saving."*

---

# APPENDIX A: ECONOMY FLOW DIAGRAM

```
$AVA TOKEN FLOWS
─────────────────────────────────────────────────────────
INFLOWS (token enters circulation):
  Tournament rewards:    ← Vesting treasury (40% supply, 4yr)
  Leaderboard bonuses:  ← Vesting treasury (skill-gated)

BURNS (token leaves circulation permanently):
  Agent evolution:       Stage 1→2:  50   $AVA
                         Stage 2→3: 150   $AVA
                         Stage 3→4: 300   $AVA
                         Stage 4→5: 500   $AVA
  Prompt Card crafting:  +2→+2 Rare: 50  $AVA
                         +2→Epic:   100  $AVA
  Mercenary auction:     5% of each winning bid
  Premium matches:       100% of entry fee
  AI inference (Kite):   Via state channel micro-fees → Kite treasury

TARGET EQUILIBRIUM:
  Monthly burns > Monthly emissions by Year 2 → Net deflationary
  Leaderboard emission curve: halves every 18 months (like Bitcoin halvings)
```

---

# APPENDIX B: ANTI-CHEAT & FAIRNESS

```
MATCH INTEGRITY STACK:
  1. Client-side:   Input validation, movement bounds checking
  2. Server-side:   Authoritative game loop runs on secure compute
  3. Kite AI:       All AI decisions signed with PoAI session key
  4. On-chain:      Result hash committed by both players + Kite arbiter
  5. ZK (future):   ZK-proof of valid game state transition (Phase 2 roadmap)

ANTI-SNIPING in Mercenary Auctions:
  → Last 5 seconds of auction: any new bid extends timer by 5s (Candle Auction)
  → Prevents last-second state channel manipulation

PROMPT CARD FAIRNESS:
  → Rate limiting: max 3 Prompt Cards per turn
  → Cost: all prompts cost 0-3 mana (cannot monopolize economy)
  → Legendary Prompt Cards: 1 per match activation limit
```

---

# APPENDIX C: TECHNICAL ROADMAP

```
PHASE 0 — PROTOTYPE (current):
  ✅ BabylonJS 3D game engine
  ✅ Turn-based card system + mana
  ✅ 9 characters (procedural meshes)
  ✅ AI enemy turn (rule-based)
  ✅ 3-lane navgraph + pathfinding

PHASE 1 — KITE AI INTEGRATION (Q3 2026):
  → Replace rule-based AI with Kite AI endpoints
  → Implement Prompt Card UI + backend pipeline
  → Deploy AgentNFT.sol + AvaToken.sol on Fuji Testnet
  → Account Abstraction (ERC-4337) wallet integration

PHASE 2 — MERCENARY ECONOMY (Q4 2026):
  → State channel mercenary auction (MercenaryAuction.sol)
  → PoAI oracle integration (Kite → on-chain)
  → Evolution Forge + token burn mechanics
  → Matchmaking + A2GameRegistry.sol

PHASE 3 — FULL LAUNCH (Q1 2027):
  → Mainnet deployment (Avalanche C-Chain + Kite AI L1)
  → Tournament system + leaderboard rewards
  → NFT marketplace integration
  → Mobile client (React Native + BabylonJS Native)
  → DAO governance for card balance patches
```

---

*"Denge her şeydir. Kazanmak değil — dengelemek."*
*"Balance is everything. Not winning — balancing."*

---
**Document Version:** 1.0
**Date:** 2026-02-24
**Classification:** Internal GDD — A2: The Saga of Alaz & Ayaz
