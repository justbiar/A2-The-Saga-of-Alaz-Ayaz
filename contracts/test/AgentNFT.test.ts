import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentNFT } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentNFT", function () {
    let agentNFT: AgentNFT;
    let owner: HardhatEthersSigner;
    let alice: HardhatEthersSigner;
    let registry: HardhatEthersSigner;

    beforeEach(async () => {
        [owner, alice, registry] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("AgentNFT");
        agentNFT = await Factory.deploy(owner.address);
        await agentNFT.waitForDeployment();
    });

    describe("Deployment", () => {
        it("should have correct name and symbol", async () => {
            expect(await agentNFT.name()).to.equal("A2 Agent");
            expect(await agentNFT.symbol()).to.equal("A2AGT");
        });
    });

    describe("Mint", () => {
        it("should mint a new agent NFT", async () => {
            const tx = await agentNFT.mint(
                alice.address,
                "korhan",
                1,
                "ipfs://QmTestCorhan",
            );
            await tx.wait();

            expect(await agentNFT.ownerOf(1)).to.equal(alice.address);
            const data = await agentNFT.agents(1);
            expect(data.characterType).to.equal("korhan");
            expect(data.tier).to.equal(1);
            expect(data.poaiScore).to.equal(0);
        });

        it("should emit AgentMinted event", async () => {
            await expect(agentNFT.mint(alice.address, "erlik", 2, "ipfs://QmErlik"))
                .to.emit(agentNFT, "AgentMinted")
                .withArgs(1, alice.address, "erlik");
        });

        it("should reject mint from non-owner", async () => {
            await expect(
                agentNFT.connect(alice).mint(alice.address, "ayaz", 1, "ipfs://QmAyaz"),
            ).to.be.reverted;
        });
    });

    describe("PoAI Update", () => {
        beforeEach(async () => {
            await agentNFT.mint(alice.address, "korhan", 1, "ipfs://QmKorhan");
            await agentNFT.setGameRegistry(registry.address);
        });

        it("should allow registry to update PoAI score", async () => {
            await agentNFT.connect(registry).updatePoAI(1, 250, true);
            const data = await agentNFT.agents(1);
            expect(data.poaiScore).to.equal(250);
            expect(data.wins).to.equal(1);
            expect(data.matchesPlayed).to.equal(1);
        });

        it("should cap PoAI at 10000", async () => {
            await agentNFT.connect(registry).updatePoAI(1, 99999, false);
            const data = await agentNFT.agents(1);
            expect(data.poaiScore).to.equal(10000);
        });

        it("should reject PoAI update from non-registry", async () => {
            await expect(
                agentNFT.connect(alice).updatePoAI(1, 100, false),
            ).to.be.revertedWith("AgentNFT: unauthorized");
        });

        it("should emit PoAIUpdated event", async () => {
            await expect(agentNFT.connect(registry).updatePoAI(1, 500, true))
                .to.emit(agentNFT, "PoAIUpdated")
                .withArgs(1, 500, 1);
        });
    });

    describe("TBA (Token Bound Account)", () => {
        beforeEach(async () => {
            await agentNFT.mint(alice.address, "tulpar", 1, "ipfs://QmTulpar");
            await agentNFT.setGameRegistry(registry.address);
        });

        it("should allow registry to set TBA address", async () => {
            const tba = ethers.Wallet.createRandom().address;
            await agentNFT.connect(registry).setTBA(1, tba);
            const data = await agentNFT.agents(1);
            expect(data.tbaAddress).to.equal(tba);
        });

        it("should emit TBASet event", async () => {
            const tba = ethers.Wallet.createRandom().address;
            await expect(agentNFT.connect(registry).setTBA(1, tba))
                .to.emit(agentNFT, "TBASet")
                .withArgs(1, tba);
        });
    });
});
