// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PodcastDiscoverFHE is SepoliaConfig {
    struct EncryptedListeningData {
        uint256 id;
        euint32 encryptedPodcastId;
        euint32 encryptedDuration;
        euint32 encryptedUserId;
        uint256 timestamp;
    }
    
    struct DecryptedListeningData {
        string podcastId;
        uint256 duration;
        string userId;
        bool isProcessed;
    }

    uint256 public dataCount;
    mapping(uint256 => EncryptedListeningData) public encryptedData;
    mapping(uint256 => DecryptedListeningData) public decryptedData;
    
    mapping(string => euint32) private encryptedPodcastStats;
    string[] private podcastList;
    
    mapping(uint256 => uint256) private requestToDataId;
    
    event DataSubmitted(uint256 indexed id, uint256 timestamp);
    event DiscoveryRequested(uint256 indexed id);
    event DataProcessed(uint256 indexed id);
    
    modifier onlyUser(uint256 dataId) {
        _;
    }
    
    function submitEncryptedListeningData(
        euint32 encryptedPodcastId,
        euint32 encryptedDuration,
        euint32 encryptedUserId
    ) public {
        dataCount += 1;
        uint256 newId = dataCount;
        
        encryptedData[newId] = EncryptedListeningData({
            id: newId,
            encryptedPodcastId: encryptedPodcastId,
            encryptedDuration: encryptedDuration,
            encryptedUserId: encryptedUserId,
            timestamp: block.timestamp
        });
        
        decryptedData[newId] = DecryptedListeningData({
            podcastId: "",
            duration: 0,
            userId: "",
            isProcessed: false
        });
        
        emit DataSubmitted(newId, block.timestamp);
    }
    
    function requestPodcastDiscovery(uint256 dataId) public onlyUser(dataId) {
        EncryptedListeningData storage data = encryptedData[dataId];
        require(!decryptedData[dataId].isProcessed, "Already processed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(data.encryptedPodcastId);
        ciphertexts[1] = FHE.toBytes32(data.encryptedDuration);
        ciphertexts[2] = FHE.toBytes32(data.encryptedUserId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processDiscovery.selector);
        requestToDataId[reqId] = dataId;
        
        emit DiscoveryRequested(dataId);
    }
    
    function processDiscovery(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");
        
        EncryptedListeningData storage eData = encryptedData[dataId];
        DecryptedListeningData storage dData = decryptedData[dataId];
        require(!dData.isProcessed, "Already processed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory podcastId, uint256 duration, string memory userId) = 
            abi.decode(cleartexts, (string, uint256, string));
        
        dData.podcastId = podcastId;
        dData.duration = duration;
        dData.userId = userId;
        dData.isProcessed = true;
        
        if (FHE.isInitialized(encryptedPodcastStats[dData.podcastId]) == false) {
            encryptedPodcastStats[dData.podcastId] = FHE.asEuint32(0);
            podcastList.push(dData.podcastId);
        }
        encryptedPodcastStats[dData.podcastId] = FHE.add(
            encryptedPodcastStats[dData.podcastId], 
            FHE.asEuint32(1)
        );
        
        emit DataProcessed(dataId);
    }
    
    function getDecryptedListeningData(uint256 dataId) public view returns (
        string memory podcastId,
        uint256 duration,
        string memory userId,
        bool isProcessed
    ) {
        DecryptedListeningData storage d = decryptedData[dataId];
        return (d.podcastId, d.duration, d.userId, d.isProcessed);
    }
    
    function getEncryptedPodcastStats(string memory podcastId) public view returns (euint32) {
        return encryptedPodcastStats[podcastId];
    }
    
    function requestPodcastStatsDecryption(string memory podcastId) public {
        euint32 stats = encryptedPodcastStats[podcastId];
        require(FHE.isInitialized(stats), "Podcast not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPodcastStats.selector);
        requestToDataId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(podcastId)));
    }
    
    function decryptPodcastStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 podcastHash = requestToDataId[requestId];
        string memory podcastId = getPodcastFromHash(podcastHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getPodcastFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < podcastList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(podcastList[i]))) == hash) {
                return podcastList[i];
            }
        }
        revert("Podcast not found");
    }
    
    function recommendPodcasts(
        string memory userId,
        string[] memory availablePodcasts
    ) public view returns (string[] memory recommendedPodcasts) {
        uint256 count = 0;
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedData[i].isProcessed && 
                keccak256(abi.encodePacked(decryptedData[i].userId)) == keccak256(abi.encodePacked(userId))) {
                for (uint256 j = 0; j < availablePodcasts.length; j++) {
                    if (isPodcastRelevant(decryptedData[i].podcastId, availablePodcasts[j])) {
                        count++;
                    }
                }
            }
        }
        
        recommendedPodcasts = new string[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedData[i].isProcessed && 
                keccak256(abi.encodePacked(decryptedData[i].userId)) == keccak256(abi.encodePacked(userId))) {
                for (uint256 j = 0; j < availablePodcasts.length; j++) {
                    if (isPodcastRelevant(decryptedData[i].podcastId, availablePodcasts[j])) {
                        recommendedPodcasts[index] = availablePodcasts[j];
                        index++;
                    }
                }
            }
        }
        return recommendedPodcasts;
    }
    
    function isPodcastRelevant(
        string memory listenedPodcast,
        string memory candidatePodcast
    ) private pure returns (bool) {
        // Simplified relevance check
        // In real implementation, this would analyze podcast genome
        return true;
    }
    
    function calculateListeningPatterns(
        string memory userId
    ) public view returns (string[] memory patterns) {
        uint256 count = 0;
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedData[i].isProcessed && 
                keccak256(abi.encodePacked(decryptedData[i].userId)) == keccak256(abi.encodePacked(userId))) {
                count++;
            }
        }
        
        patterns = new string[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedData[i].isProcessed && 
                keccak256(abi.encodePacked(decryptedData[i].userId)) == keccak256(abi.encodePacked(userId))) {
                patterns[index] = extractPattern(decryptedData[i].podcastId);
                index++;
            }
        }
        return patterns;
    }
    
    function extractPattern(
        string memory podcastId
    ) private pure returns (string memory) {
        // Simplified pattern extraction
        return "ListeningPattern";
    }
    
    function identifyNichePodcasts(
        string memory userId,
        uint256 popularityThreshold
    ) public view returns (string[] memory nichePodcasts) {
        uint256 count = 0;
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedData[i].isProcessed && 
                keccak256(abi.encodePacked(decryptedData[i].userId)) == keccak256(abi.encodePacked(userId)) &&
                isPodcastNiche(decryptedData[i].podcastId, popularityThreshold)) {
                count++;
            }
        }
        
        nichePodcasts = new string[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedData[i].isProcessed && 
                keccak256(abi.encodePacked(decryptedData[i].userId)) == keccak256(abi.encodePacked(userId)) &&
                isPodcastNiche(decryptedData[i].podcastId, popularityThreshold)) {
                nichePodcasts[index] = decryptedData[i].podcastId;
                index++;
            }
        }
        return nichePodcasts;
    }
    
    function isPodcastNiche(
        string memory podcastId,
        uint256 popularityThreshold
    ) private pure returns (bool) {
        // Simplified niche detection
        // In real implementation, this would check actual popularity data
        return true;
    }
    
    function generatePersonalizedFeed(
        string memory userId,
        string[] memory newReleases
    ) public view returns (string[] memory feed) {
        uint256 count = 0;
        for (uint256 i = 0; i < newReleases.length; i++) {
            if (isPodcastRelevantForUser(userId, newReleases[i])) {
                count++;
            }
        }
        
        feed = new string[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < newReleases.length; i++) {
            if (isPodcastRelevantForUser(userId, newReleases[i])) {
                feed[index] = newReleases[i];
                index++;
            }
        }
        return feed;
    }
    
    function isPodcastRelevantForUser(
        string memory userId,
        string memory podcastId
    ) private view returns (bool) {
        // Simplified relevance check
        // In real implementation, this would analyze user preferences
        return true;
    }
}