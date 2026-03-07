// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentNFT.sol";
import "./AvaToken.sol";

/**
 * @title EvolutionForge
 * @notice GDD §2.6 — Burn two NFTs of the same tier to evolve one to the next tier.
 *
 * Evolution path: Tier 1 + Tier 1 → Tier 2, etc. (up to Tier 5 Mythic)
 * AVA tokens are also burned as the forge fee.
 * The evolved NFT inherits the higher PoAI score of the two burned NFTs.
 */
contract EvolutionForge is Ownable, ReentrancyGuard {
    AgentNFT public immutable agentNFT;
    AvaToken public immutable avaToken;

    // Forge fee in AVA tokens per tier upgrade
    uint256[5] public forgeFees = [
        50 * 1e18,    // Tier 1 → 2:  50 AVA
        200 * 1e18,   // Tier 2 → 3: 200 AVA
        500 * 1e18,   // Tier 3 → 4: 500 AVA
        1500 * 1e18,  // Tier 4 → 5: 1500 AVA
        0             // Tier 5 is max
    ];

    event Evolved(
        uint256 indexed newTokenId,
        uint256 burnedToken1,
        uint256 burnedToken2,
        uint8 newTier,
        address indexed owner
    );

    constructor(address initialOwner, address _agentNFT, address _avaToken)
        Ownable(initialOwner)
    {
        agentNFT = AgentNFT(_agentNFT);
        avaToken = AvaToken(_avaToken);
    }

    /**
     * @dev Evolve two same-tier NFTs of the same character type into one higher-tier NFT.
     * Both source NFTs are burned. Caller pays the AVA forge fee.
     *
     * @param tokenId1  First NFT to sacrifice
     * @param tokenId2  Second NFT to sacrifice
     * @param newUri    IPFS metadata URI for the evolved NFT
     */
    function evolve(
        uint256 tokenId1,
        uint256 tokenId2,
        string calldata newUri
    ) external nonReentrant returns (uint256) {
        require(tokenId1 != tokenId2, "EvolutionForge: same token");
        require(agentNFT.ownerOf(tokenId1) == msg.sender, "EvolutionForge: not owner of token1");
        require(agentNFT.ownerOf(tokenId2) == msg.sender, "EvolutionForge: not owner of token2");

        (
            string memory type1,
            uint8 tier1,
            uint32 poai1,
            ,,
        ) = agentNFT.agents(tokenId1);
        (
            string memory type2,
            uint8 tier2,
            uint32 poai2,
            ,,
        ) = agentNFT.agents(tokenId2);

        require(
            keccak256(bytes(type1)) == keccak256(bytes(type2)),
            "EvolutionForge: different character types"
        );
        require(tier1 == tier2, "EvolutionForge: tiers must match");
        require(tier1 < 5, "EvolutionForge: already at max tier");

        uint8 newTier = tier1 + 1;
        uint256 fee = forgeFees[tier1 - 1];

        // Collect and burn AVA forge fee
        if (fee > 0) {
            avaToken.transferFrom(msg.sender, address(this), fee);
            avaToken.burn(fee);
        }

        // Burn both source NFTs
        agentNFT.transferFrom(msg.sender, address(0xdead), tokenId1);
        agentNFT.transferFrom(msg.sender, address(0xdead), tokenId2);

        // Mint evolved NFT — inherit higher PoAI
        uint32 inheritedPoai = poai1 > poai2 ? poai1 : poai2;
        uint256 newTokenId = agentNFT.mint(msg.sender, type1, newTier, newUri);
        agentNFT.updatePoAI(newTokenId, inheritedPoai, false);

        emit Evolved(newTokenId, tokenId1, tokenId2, newTier, msg.sender);
        return newTokenId;
    }
}
