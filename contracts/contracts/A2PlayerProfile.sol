// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title A2PlayerProfile
 * @notice On-chain player profiles, game scores, and leaderboard for A2 Saga.
 *         No dependencies — standalone contract for Avalanche Fuji testnet.
 */
contract A2PlayerProfile {
    struct Profile {
        string username;
        string avatarURI;
        uint32 gamesPlayed;
        uint32 wins;
        uint32 losses;
        uint32 draws;
        uint64 registeredAt;
        bool exists;
    }

    mapping(address => Profile) public profiles;
    address[] public allPlayers;

    event ProfileRegistered(address indexed player, string username);
    event ProfileUpdated(address indexed player, string username, string avatarURI);
    event GameResultRecorded(address indexed player, uint8 result); // 0=loss, 1=win, 2=draw

    function registerProfile(string calldata username, string calldata avatarURI) external {
        require(!profiles[msg.sender].exists, "Already registered");
        require(bytes(username).length > 0 && bytes(username).length <= 32, "Invalid username");

        profiles[msg.sender] = Profile({
            username: username,
            avatarURI: avatarURI,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            registeredAt: uint64(block.timestamp),
            exists: true
        });

        allPlayers.push(msg.sender);
        emit ProfileRegistered(msg.sender, username);
    }

    function updateProfile(string calldata username, string calldata avatarURI) external {
        require(profiles[msg.sender].exists, "Not registered");
        if (bytes(username).length > 0) profiles[msg.sender].username = username;
        if (bytes(avatarURI).length > 0) profiles[msg.sender].avatarURI = avatarURI;
        emit ProfileUpdated(msg.sender, username, avatarURI);
    }

    function submitGameResult(uint8 result) external {
        require(profiles[msg.sender].exists, "Not registered");
        require(result <= 2, "Invalid result");

        profiles[msg.sender].gamesPlayed++;
        if (result == 1) profiles[msg.sender].wins++;
        else if (result == 0) profiles[msg.sender].losses++;
        else profiles[msg.sender].draws++;

        emit GameResultRecorded(msg.sender, result);
    }

    function getProfile(address player) external view returns (Profile memory) {
        return profiles[player];
    }

    function getAllPlayers() external view returns (address[] memory) {
        return allPlayers;
    }

    function getPlayerCount() external view returns (uint256) {
        return allPlayers.length;
    }
}
