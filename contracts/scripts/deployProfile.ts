import { ethers } from "hardhat";

async function main() {
    const Profile = await ethers.getContractFactory("A2PlayerProfile");
    const profile = await Profile.deploy();
    await profile.waitForDeployment();
    const addr = await profile.getAddress();
    console.log("A2PlayerProfile deployed to:", addr);
    console.log("\nAdd this to your .env:");
    console.log(`VITE_PROFILE_CONTRACT=${addr}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
