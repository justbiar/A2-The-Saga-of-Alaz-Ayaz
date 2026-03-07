// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentNFT.sol";
import "./AvaToken.sol";

/**
 * @title A2GameRegistry
 * @notice GDD §2.7 — On-chain match registry and result verification.
 *
 * Responsibilities:
 *   - Register match start (both players commit agent token IDs)
 *   - Record match results (winner, PoAI scores, turns played)
 *   - Update agent PoAI scores on AgentNFT after match
 *   - Distribute match rewards (AVA tokens) to winner
 *   - Emit events for The Graph indexing
 *
 * State channels: Off-chain moves are signed by both players.
 * Only the final state is submitted here for settlement.
 */
contract A2GameRegistry is Ownable, ReentrancyGuard {
    AgentNFT public immutable agentNFT;
    AvaToken public immutable avaToken;

    enum MatchStatus { Pending, Active, Completed, Disputed }

    struct Match {
        address playerFire;
        address playerIce;
        uint256[] fireAgents;     // AgentNFT token IDs used by fire player
        uint256[] iceAgents;      // AgentNFT token IDs used by ice player
        uint256 entryFee;         // AVA tokens each player locked
        uint256 startTime;
        uint256 endTime;
        MatchStatus status;
        address winner;
        uint8 turnsPlayed;
        string winCondition;      // "base_destroy" | "shard_timeout" | "equilibrium"
    }

    uint256 private _matchIdCounter;
    mapping(uint256 => Match) public matches;
    mapping(address => uint256[]) public playerMatches;

    uint256 public constant WINNER_SHARE_BPS = 8500;   // 85% to winner
    uint256 public constant PROTOCOL_FEE_BPS = 1000;   // 10% to treasury
    uint256 public constant BURN_BPS = 500;             // 5% burned

    address public treasury;

    event MatchCreated(uint256 indexed matchId, address playerFire, address playerIce, uint256 entryFee);
    event MatchStarted(uint256 indexed matchId);
    event MatchCompleted(
        uint256 indexed matchId,
        address winner,
        uint8 turnsPlayed,
        string winCondition
    );
    event RewardDistributed(uint256 indexed matchId, address winner, uint256 amount);

    constructor(address initialOwner, address _agentNFT, address _avaToken, address _treasury)
        Ownable(initialOwner)
    {
        agentNFT = AgentNFT(_agentNFT);
        avaToken = AvaToken(_avaToken);
        treasury = _treasury;
    }

    /**
     * @dev Register a new match. Both players must approve AVA token transfer.
     */
    function createMatch(
        address playerIce,
        uint256[] calldata fireAgents,
        uint256[] calldata iceAgents,
        uint256 entryFee
    ) external nonReentrant returns (uint256) {
        require(playerIce != msg.sender, "Registry: cannot play against yourself");
        require(fireAgents.length > 0 && iceAgents.length > 0, "Registry: no agents");

        // Lock entry fees
        if (entryFee > 0) {
            avaToken.transferFrom(msg.sender, address(this), entryFee);
            avaToken.transferFrom(playerIce, address(this), entryFee);
        }

        uint256 matchId = ++_matchIdCounter;
        matches[matchId] = Match({
            playerFire: msg.sender,
            playerIce: playerIce,
            fireAgents: fireAgents,
            iceAgents: iceAgents,
            entryFee: entryFee,
            startTime: block.timestamp,
            endTime: 0,
            status: MatchStatus.Active,
            winner: address(0),
            turnsPlayed: 0,
            winCondition: "",
        });

        playerMatches[msg.sender].push(matchId);
        playerMatches[playerIce].push(matchId);

        emit MatchCreated(matchId, msg.sender, playerIce, entryFee);
        emit MatchStarted(matchId);
        return matchId;
    }

    /**
     * @dev Submit match result. Called by trusted game server or via
     *      multi-sig after state channel settlement.
     *
     * @param matchId      The match to settle
     * @param winner       Winner address
     * @param turnsPlayed  Number of turns played
     * @param winCondition How the game ended
     * @param firePoaiDeltas  PoAI score changes for fire agents
     * @param icePoaiDeltas   PoAI score changes for ice agents
     */
    function submitResult(
        uint256 matchId,
        address winner,
        uint8 turnsPlayed,
        string calldata winCondition,
        int32[] calldata firePoaiDeltas,
        int32[] calldata icePoaiDeltas
    ) external onlyOwner nonReentrant {
        Match storage m = matches[matchId];
        require(m.status == MatchStatus.Active, "Registry: match not active");

        m.status = MatchStatus.Completed;
        m.winner = winner;
        m.turnsPlayed = turnsPlayed;
        m.endTime = block.timestamp;
        m.winCondition = winCondition;

        // Update PoAI scores for all agents
        bool fireWon = winner == m.playerFire;
        _updateAgentPoAI(m.fireAgents, firePoaiDeltas, fireWon);
        _updateAgentPoAI(m.iceAgents, icePoaiDeltas, !fireWon);

        // Distribute rewards
        if (m.entryFee > 0) {
            uint256 pool = m.entryFee * 2;
            uint256 winnerAmount = (pool * WINNER_SHARE_BPS) / 10_000;
            uint256 protocolAmount = (pool * PROTOCOL_FEE_BPS) / 10_000;
            uint256 burnAmount = pool - winnerAmount - protocolAmount;

            avaToken.transfer(winner, winnerAmount);
            avaToken.transfer(treasury, protocolAmount);
            avaToken.burn(burnAmount);

            emit RewardDistributed(matchId, winner, winnerAmount);
        }

        emit MatchCompleted(matchId, winner, turnsPlayed, winCondition);
    }

    function _updateAgentPoAI(
        uint256[] storage agents,
        int32[] calldata deltas,
        bool won
    ) internal {
        uint256 len = agents.length < deltas.length ? agents.length : deltas.length;
        for (uint256 i = 0; i < len; i++) {
            (,, uint32 currentPoai,,,) = agentNFT.agents(agents[i]);
            int64 newScore = int64(int32(currentPoai)) + int64(deltas[i]);
            if (newScore < 0) newScore = 0;
            if (newScore > 10000) newScore = 10000;
            agentNFT.updatePoAI(agents[i], uint32(uint64(newScore)), won);
        }
    }

    function getPlayerMatches(address player) external view returns (uint256[] memory) {
        return playerMatches[player];
    }
}
