import { expect } from "chai";
import { ethers } from "hardhat";
import { AvaToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AvaToken", function () {
    let ava: AvaToken;
    let owner: HardhatEthersSigner;
    let alice: HardhatEthersSigner;
    let bob: HardhatEthersSigner;

    const INITIAL_SUPPLY = ethers.parseEther("10000000"); // 10M

    beforeEach(async () => {
        [owner, alice, bob] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("AvaToken");
        ava = await Factory.deploy(owner.address);
        await ava.waitForDeployment();
    });

    describe("Deployment", () => {
        it("should set correct name and symbol", async () => {
            expect(await ava.name()).to.equal("AvaToken");
            expect(await ava.symbol()).to.equal("AVA");
        });

        it("should mint initial supply to owner", async () => {
            expect(await ava.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
        });

        it("should have correct max supply", async () => {
            const maxSupply = await ava.MAX_SUPPLY();
            expect(maxSupply).to.equal(ethers.parseEther("100000000")); // 100M
        });
    });

    describe("Mint", () => {
        it("should allow owner to mint", async () => {
            const amount = ethers.parseEther("1000");
            await ava.mint(alice.address, amount);
            expect(await ava.balanceOf(alice.address)).to.equal(amount);
        });

        it("should reject mint beyond max supply", async () => {
            const overmint = ethers.parseEther("91000001"); // would exceed 100M
            await expect(ava.mint(alice.address, overmint))
                .to.be.revertedWith("AvaToken: exceeds max supply");
        });

        it("should reject mint from non-owner", async () => {
            await expect(ava.connect(alice).mint(alice.address, ethers.parseEther("100")))
                .to.be.reverted;
        });
    });

    describe("Burn on Transfer", () => {
        beforeEach(async () => {
            // Give alice some tokens
            await ava.mint(alice.address, ethers.parseEther("10000"));
        });

        it("should burn 2% on transfer", async () => {
            const sendAmount = ethers.parseEther("1000");
            const expectedReceive = ethers.parseEther("980"); // 98%
            const expectedBurn = ethers.parseEther("20");     // 2%

            const supplyBefore = await ava.totalSupply();
            await ava.connect(alice).transfer(bob.address, sendAmount);

            expect(await ava.balanceOf(bob.address)).to.equal(expectedReceive);
            const supplyAfter = await ava.totalSupply();
            expect(supplyBefore - supplyAfter).to.equal(expectedBurn);
        });

        it("should NOT burn on mint (from == address(0))", async () => {
            const mintAmount = ethers.parseEther("100");
            const supplyBefore = await ava.totalSupply();
            await ava.mint(bob.address, mintAmount);
            expect(await ava.totalSupply()).to.equal(supplyBefore + mintAmount);
            expect(await ava.balanceOf(bob.address)).to.equal(mintAmount);
        });

        it("should emit BurnOnTransfer event", async () => {
            const sendAmount = ethers.parseEther("100");
            await expect(ava.connect(alice).transfer(bob.address, sendAmount))
                .to.emit(ava, "BurnOnTransfer")
                .withArgs(alice.address, ethers.parseEther("2")); // 2% of 100
        });
    });

    describe("Burn", () => {
        it("should allow token holder to burn their tokens", async () => {
            await ava.mint(alice.address, ethers.parseEther("500"));
            const burnAmount = ethers.parseEther("100");
            const supplyBefore = await ava.totalSupply();

            await ava.connect(alice).burn(burnAmount);
            expect(await ava.totalSupply()).to.equal(supplyBefore - burnAmount);
        });
    });
});
