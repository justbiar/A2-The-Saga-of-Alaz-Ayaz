// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AvaToken
 * @notice GDD Part II §2.2 — Deflationary ERC-20 utility token for A2.
 *
 * Features:
 *   - 2% of every transfer is burned (deflation mechanic)
 *   - Owner can mint up to MAX_SUPPLY
 *   - Used for: match entry fees, card upgrades, mercenary auctions
 */
contract AvaToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 1e18;  // 100M AVA
    uint256 public constant BURN_RATE_BPS = 200;               // 2% = 200 basis points

    event BurnOnTransfer(address indexed from, uint256 amount);

    constructor(address initialOwner)
        ERC20("AvaToken", "AVA")
        Ownable(initialOwner)
    {
        // Mint 10M initial supply to owner (treasury)
        _mint(initialOwner, 10_000_000 * 1e18);
    }

    /**
     * @dev Mint new tokens. Cannot exceed MAX_SUPPLY.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "AvaToken: exceeds max supply");
        _mint(to, amount);
    }

    /**
     * @dev Override transfer to apply 2% burn on every transfer.
     * The recipient receives 98% of the sent amount.
     */
    function _update(address from, address to, uint256 value)
        internal
        override
    {
        if (from == address(0) || to == address(0)) {
            // Mint / burn — no fee
            super._update(from, to, value);
            return;
        }

        uint256 burnAmount = (value * BURN_RATE_BPS) / 10_000;
        uint256 transferAmount = value - burnAmount;

        super._update(from, to, transferAmount);
        super._update(from, address(0), burnAmount);  // burn

        emit BurnOnTransfer(from, burnAmount);
    }
}
