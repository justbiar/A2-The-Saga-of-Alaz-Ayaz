// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentNFT
 * @notice GDD §2.3 — ERC-721 Dynamic NFT for AI Agents.
 *
 * Each token represents a unique AI Agent character (Korhan, Erlik, etc.)
 * with an on-chain PoAI (Proof of AI) score that grows with gameplay.
 *
 * ERC-6551 Token Bound Account (TBA) address is stored per token,
 * allowing the NFT to own assets (equipment, experience, history).
 */
contract AgentNFT is ERC721, ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;

    struct AgentData {
        string characterType;   // "korhan", "erlik", etc.
        uint8 tier;             // 1-5 (Common → Mythic)
        uint32 poaiScore;       // Proof of AI score (0-10000)
        uint32 matchesPlayed;
        uint32 wins;
        address tbaAddress;     // ERC-6551 Token Bound Account
    }

    mapping(uint256 => AgentData) public agents;

    // Only authorized game registry can update PoAI scores
    address public gameRegistry;

    event AgentMinted(uint256 indexed tokenId, address indexed owner, string characterType);
    event PoAIUpdated(uint256 indexed tokenId, uint32 newScore, uint32 matchesPlayed);
    event TBASet(uint256 indexed tokenId, address tbaAddress);

    modifier onlyRegistry() {
        require(msg.sender == gameRegistry || msg.sender == owner(), "AgentNFT: unauthorized");
        _;
    }

    constructor(address initialOwner)
        ERC721("A2 Agent", "A2AGT")
        Ownable(initialOwner)
    {}

    function setGameRegistry(address _registry) external onlyOwner {
        gameRegistry = _registry;
    }

    /**
     * @dev Mint a new Agent NFT.
     * @param to           Recipient address
     * @param characterType Character type identifier
     * @param tier         Starting tier (1-5)
     * @param uri          Initial metadata URI (IPFS)
     */
    function mint(
        address to,
        string calldata characterType,
        uint8 tier,
        string calldata uri
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = ++_tokenIdCounter;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        agents[tokenId] = AgentData({
            characterType: characterType,
            tier: tier,
            poaiScore: 0,
            matchesPlayed: 0,
            wins: 0,
            tbaAddress: address(0),
        });

        emit AgentMinted(tokenId, to, characterType);
        return tokenId;
    }

    /**
     * @dev Update PoAI score after a match. Called by GameRegistry.
     */
    function updatePoAI(
        uint256 tokenId,
        uint32 newPoaiScore,
        bool won
    ) external onlyRegistry {
        require(_ownerOf(tokenId) != address(0), "AgentNFT: token does not exist");
        AgentData storage agent = agents[tokenId];
        agent.poaiScore = uint32(newPoaiScore > 10000 ? 10000 : newPoaiScore);
        agent.matchesPlayed++;
        if (won) agent.wins++;

        emit PoAIUpdated(tokenId, agent.poaiScore, agent.matchesPlayed);
    }

    /**
     * @dev Register ERC-6551 Token Bound Account address for a token.
     */
    function setTBA(uint256 tokenId, address tba) external onlyRegistry {
        require(_ownerOf(tokenId) != address(0), "AgentNFT: token does not exist");
        agents[tokenId].tbaAddress = tba;
        emit TBASet(tokenId, tba);
    }

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
