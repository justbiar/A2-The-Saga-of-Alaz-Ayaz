// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

/**
 * @title PromptCard
 * @notice GDD §2.4 — ERC-1155 multi-token for Prompt Cards.
 *
 * Each token ID represents a unique Prompt Card type.
 * Cards are consumed on use (burned) and have a max supply per type.
 *
 * Token IDs:
 *   0 = Alaz Dalgası (fire berserker)
 *   1 = Buz Noktası  (freeze area)
 *   2 = Ruh Çağrısı  (summon spirit)
 *   3 = Mana Akışı   (mana surge)
 *   4 = Toprak Ateşi (damage aoe)
 *   5 = Umay'ın Nimeti (heal)
 *   6 = Buz Kalkanı  (shield)
 *   7 = Rüzgar Adımı (speed boost)
 */
contract PromptCard is ERC1155, ERC1155Supply, Ownable {
    uint256 public constant NUM_CARD_TYPES = 8;
    uint256 public constant MAX_SUPPLY_PER_TYPE = 10_000;

    string[] public cardNames = [
        "Alaz Dalgasi",
        "Buz Noktasi",
        "Ruh Cagirisi",
        "Mana Akisi",
        "Toprak Atesi",
        "Umay Nimeti",
        "Buz Kalkani",
        "Ruzgar Adimi"
    ];

    // Authorized burner (GameRegistry contract)
    address public burner;

    event CardBurned(address indexed user, uint256 cardType, uint256 amount);

    modifier onlyBurner() {
        require(msg.sender == burner || msg.sender == owner(), "PromptCard: unauthorized");
        _;
    }

    constructor(address initialOwner, string memory baseUri)
        ERC1155(baseUri)
        Ownable(initialOwner)
    {}

    function setBurner(address _burner) external onlyOwner {
        burner = _burner;
    }

    /**
     * @dev Mint Prompt Cards. Called by game treasury when players earn cards.
     */
    function mint(address to, uint256 cardType, uint256 amount) external onlyOwner {
        require(cardType < NUM_CARD_TYPES, "PromptCard: invalid card type");
        require(
            totalSupply(cardType) + amount <= MAX_SUPPLY_PER_TYPE,
            "PromptCard: exceeds max supply"
        );
        _mint(to, cardType, amount, "");
    }

    /**
     * @dev Burn a card on use. Called by GameRegistry after a match confirms use.
     */
    function burnOnUse(address user, uint256 cardType, uint256 amount) external onlyBurner {
        _burn(user, cardType, amount);
        emit CardBurned(user, cardType, amount);
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }
}
