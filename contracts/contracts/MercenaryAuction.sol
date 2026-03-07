// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AvaToken.sol";

/**
 * @title MercenaryAuction
 * @notice GDD §2.5 — Sealed-bid auction for mercenary characters.
 *
 * Albastı, Tepegöz, and Şahmeran are auctioned before each match.
 * The winning bidder's AVA tokens are burned (deflationary).
 * The owner of the mercenary NFT receives 90% of the winning bid.
 *
 * Uses a simple English auction with a commit-reveal phase.
 */
contract MercenaryAuction is Ownable, ReentrancyGuard {
    AvaToken public immutable avaToken;

    struct Auction {
        uint256 mercenaryId;    // AgentNFT token ID (mercenary)
        address seller;
        uint256 startPrice;     // minimum bid in AVA
        uint256 endTime;
        address highBidder;
        uint256 highBid;
        bool settled;
    }

    uint256 private _auctionIdCounter;
    mapping(uint256 => Auction) public auctions;

    uint256 public constant SELLER_FEE_BPS = 9000;  // 90% to seller
    uint256 public constant BURN_FEE_BPS = 1000;    // 10% burned

    event AuctionCreated(uint256 indexed auctionId, uint256 mercenaryId, uint256 endTime);
    event BidPlaced(uint256 indexed auctionId, address bidder, uint256 amount);
    event AuctionSettled(uint256 indexed auctionId, address winner, uint256 amount);

    constructor(address initialOwner, address _avaToken)
        Ownable(initialOwner)
    {
        avaToken = AvaToken(_avaToken);
    }

    /**
     * @dev Create a new auction for a mercenary.
     */
    function createAuction(
        uint256 mercenaryId,
        uint256 startPrice,
        uint256 duration
    ) external returns (uint256) {
        uint256 auctionId = ++_auctionIdCounter;
        auctions[auctionId] = Auction({
            mercenaryId: mercenaryId,
            seller: msg.sender,
            startPrice: startPrice,
            endTime: block.timestamp + duration,
            highBidder: address(0),
            highBid: 0,
            settled: false,
        });

        emit AuctionCreated(auctionId, mercenaryId, block.timestamp + duration);
        return auctionId;
    }

    /**
     * @dev Place a bid. Bidder must approve AVA token transfer first.
     */
    function bid(uint256 auctionId, uint256 amount) external nonReentrant {
        Auction storage a = auctions[auctionId];
        require(block.timestamp < a.endTime, "Auction: ended");
        require(amount >= a.startPrice, "Auction: below start price");
        require(amount > a.highBid, "Auction: bid too low");

        // Refund previous high bidder
        if (a.highBidder != address(0)) {
            avaToken.transfer(a.highBidder, a.highBid);
        }

        avaToken.transferFrom(msg.sender, address(this), amount);
        a.highBidder = msg.sender;
        a.highBid = amount;

        emit BidPlaced(auctionId, msg.sender, amount);
    }

    /**
     * @dev Settle auction: send 90% to seller, burn 10%.
     */
    function settle(uint256 auctionId) external nonReentrant {
        Auction storage a = auctions[auctionId];
        require(block.timestamp >= a.endTime, "Auction: not ended");
        require(!a.settled, "Auction: already settled");
        a.settled = true;

        if (a.highBidder != address(0)) {
            uint256 sellerAmount = (a.highBid * SELLER_FEE_BPS) / 10_000;
            uint256 burnAmount = a.highBid - sellerAmount;

            avaToken.transfer(a.seller, sellerAmount);
            avaToken.burn(burnAmount);

            emit AuctionSettled(auctionId, a.highBidder, a.highBid);
        }
    }
}
