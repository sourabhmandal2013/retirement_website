// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Adjust for production security, e.g., 'http://yourdomain.com'
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// State variables for the event
let mainDisplaySocketId = null;
let audienceSockets = new Set();
const MAX_AUDIENCE_CONNECTIONS = 100;

// Event state
let eventStarted = false;
let goSignalSent = false; // True when video_b has been triggered
let eventEnded = false; // New flag for final celebration state

// MVP2 & Milestone related
const TOTAL_TAPS_REQUIRED = 100; // Total taps to complete video_b
const MILESTONE_THRESHOLDS = [
    Math.floor(TOTAL_TAPS_REQUIRED / 3),  // ~33 taps for M1
    Math.floor(TOTAL_TAPS_REQUIRED * 2 / 3), // ~66 taps for M2
    TOTAL_TAPS_REQUIRED // 100 taps for M3 (video_b complete)
];
let currentTapCount = 0; // Total taps received for video_b advancement
let milestonesReachedStatus = [false, false, false]; // Tracks which milestone has been celebrated
let isMilestoneCelebrationActive = false; // True when main display is showing a milestone carousel

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- Main Display Registration ---
    socket.on('registerMainDisplay', () => {
        if (mainDisplaySocketId && mainDisplaySocketId !== socket.id) {
            console.warn(`Attempted to register new main display while one is active. Disconnecting old: ${mainDisplaySocketId}`);
            io.to(mainDisplaySocketId).emit('forceDisconnect', 'Another main display connected. This connection will be closed.');
            mainDisplaySocketId = null; // Clear old one if it exists
        }
        mainDisplaySocketId = socket.id;
        console.log(`Main display registered: ${mainDisplaySocketId}`);
        socket.emit('status', 'Main display connected.');

        // Send current event state to main display
        socket.emit('eventStatus', {
            started: eventStarted,
            goSent: goSignalSent,
            eventEnded: eventEnded, // New: inform about end state
            milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive,
            currentTapCount: currentTapCount,
            milestonesReachedStatus: milestonesReachedStatus // New: Send full milestone status
        });

        // Update audience about main display status
        audienceSockets.forEach(audSocket => {
            io.to(audSocket.id).emit('mainDisplayStatus', true);
        });
    });

    // --- Audience Registration ---
    socket.on('registerAudience', () => {
        if (audienceSockets.size < MAX_AUDIENCE_CONNECTIONS) {
            audienceSockets.add(socket);
            console.log(`Audience member registered: ${socket.id}. Total active: ${audienceSockets.size}`);
            socket.emit('status', 'Audience connection established.');
            socket.emit('mainDisplayStatus', !!mainDisplaySocketId); // Send current main display status
            socket.emit('eventStatus', {
                started: eventStarted,
                goSent: goSignalSent,
                eventEnded: eventEnded, // New: inform about end state
                milestoneReached: isMilestoneCelebrationActive // For audience, this implies button disabled
            });
        } else {
            console.log(`Audience limit reached. Disconnecting: ${socket.id}`);
            socket.emit('status', 'Server busy. Please try again later.');
            socket.disconnect(true);
        }
    });

    // --- Event Control Signals (from Main Display) ---
    socket.on('startEvent', () => {
        if (socket.id !== mainDisplaySocketId) {
            socket.emit('error', 'Unauthorized: Only the main display can start the event.');
            return;
        }
        if (!eventStarted) {
            eventStarted = true;
            goSignalSent = false;
            eventEnded = false; // Reset on start
            currentTapCount = 0;
            milestonesReachedStatus = [false, false, false];
            isMilestoneCelebrationActive = false;

            io.emit('eventStatus', {
                started: eventStarted,
                goSent: goSignalSent,
                eventEnded: eventEnded,
                milestoneReached: isMilestoneCelebrationActive,
                milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive,
                currentTapCount: currentTapCount,
                milestonesReachedStatus: milestonesReachedStatus
            });
            console.log('Start event signal broadcasted.');
        } else {
            socket.emit('error', 'Event already started.');
        }
    });

    socket.on('resetEvent', () => {
        if (socket.id !== mainDisplaySocketId) {
            socket.emit('error', 'Unauthorized: Only the main display can reset the event.');
            return;
        }
        console.log('Reset event received from main display.');
        eventStarted = false;
        goSignalSent = false;
        eventEnded = false; // Reset on reset
        currentTapCount = 0;
        milestonesReachedStatus = [false, false, false];
        isMilestoneCelebrationActive = false;

        io.emit('eventStatus', {
            started: eventStarted,
            goSent: goSignalSent,
            eventEnded: eventEnded,
            milestoneReached: isMilestoneCelebrationActive,
            milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive,
            currentTapCount: currentTapCount,
            milestonesReachedStatus: milestonesReachedStatus
        });
        console.log('Reset event broadcasted to all clients.');
    });

    // --- Audience Interaction (from Audience) ---
    socket.on('goSignal', () => {
        if (!audienceSockets.has(socket)) {
            socket.emit('error', 'Unauthorized: Not an audience connection.');
            return;
        }
        if (eventEnded) {
            socket.emit('info', 'The event has ended.');
            return;
        }
        if (eventStarted && !goSignalSent) {
            goSignalSent = true;
            io.to(mainDisplaySocketId).emit('goSignal');
            console.log('Go signal sent to main display from audience.');
            audienceSockets.forEach(audSocket => {
                io.to(audSocket.id).emit('eventStatus', {
                    started: eventStarted,
                    goSent: goSignalSent,
                    eventEnded: eventEnded,
                    milestoneReached: isMilestoneCelebrationActive // Audience button state
                });
            });
        } else if (!eventStarted) {
            socket.emit('info', 'The event has not started yet.');
        } else if (goSignalSent) {
            socket.emit('info', 'The "Go" signal has already been sent.');
        }
    });

    socket.on('tapEvent', () => {
        if (!audienceSockets.has(socket)) {
            socket.emit('error', 'Unauthorized: Not an audience connection.');
            return;
        }
        if (!eventStarted) {
            socket.emit('info', 'The event has not started yet.');
            return;
        }
        if (!goSignalSent) {
            socket.emit('info', 'Tap to trigger the next video first!');
            return;
        }
        if (eventEnded) {
            socket.emit('info', 'The event has ended. Please wait for the next event.');
            return;
        }
        if (currentTapCount >= TOTAL_TAPS_REQUIRED) {
            socket.emit('info', 'Video complete! Waiting for next event phase.');
            return;
        }

        currentTapCount++; // Always count taps even if milestone is active
        console.log(`Tap received from ${socket.id}. Current count: ${currentTapCount}`);

        // If a milestone celebration is NOT active, advance the video frame
        if (!isMilestoneCelebrationActive) {
            if (mainDisplaySocketId) {
                io.to(mainDisplaySocketId).emit('advanceVideoFrame');
            }
        } else {
             socket.emit('info', 'A milestone is being celebrated! Taps are counted but video paused.');
        }

        // Check for milestones
        for (let i = 0; i < MILESTONE_THRESHOLDS.length; i++) {
            if (currentTapCount >= MILESTONE_THRESHOLDS[i] && !milestonesReachedStatus[i]) {
                milestonesReachedStatus[i] = true;
                isMilestoneCelebrationActive = true; // Set flag to block further video advancement and audience taps
                console.log(`Milestone ${i + 1} reached! Taps: ${currentTapCount}`);

                if (mainDisplaySocketId) {
                    io.to(mainDisplaySocketId).emit('milestoneReached', i); // Send index of milestone
                }
                // Inform all clients to update their state (audience to disable button)
                io.emit('eventStatus', {
                    started: eventStarted,
                    goSent: goSignalSent,
                    eventEnded: eventEnded,
                    milestoneReached: isMilestoneCelebrationActive, // Audience button state
                    milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive, // Main display state
                    currentTapCount: currentTapCount,
                    milestonesReachedStatus: milestonesReachedStatus
                });
                break; // Only trigger one milestone at a time
            }
        }

        // Check for final completion
        if (currentTapCount >= TOTAL_TAPS_REQUIRED && !eventEnded) {
            eventEnded = true; // Mark event as ended
            console.log('Total taps reached. Triggering end celebration across all screens.');
            io.emit('endCelebration');
            // Update all clients on event end status
            io.emit('eventStatus', {
                started: eventStarted, // Could be false if eventEnded means no more taps
                goSent: goSignalSent,
                eventEnded: eventEnded,
                milestoneReached: isMilestoneCelebrationActive,
                milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive,
                currentTapCount: currentTapCount,
                milestonesReachedStatus: milestonesReachedStatus
            });
        }
    });

    // --- Main Display notifies server that milestone celebration is complete ---
    socket.on('milestoneDisplayComplete', () => {
        if (socket.id !== mainDisplaySocketId) {
            socket.emit('error', 'Unauthorized: Only the main display can send milestoneDisplayComplete.');
            return;
        }
        isMilestoneCelebrationActive = false; // Allow video advancement and audience taps again
        console.log('Milestone display complete signal received. Resuming taps.');
        // Re-enable audience buttons and update main display
        io.emit('eventStatus', {
            started: eventStarted,
            goSent: goSignalSent,
            eventEnded: eventEnded,
            milestoneReached: isMilestoneCelebrationActive, // Audience button state
            milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive, // Main display state
            currentTapCount: currentTapCount,
            milestonesReachedStatus: milestonesReachedStatus
        });
    });

    // --- Main Display requests to jump to next milestone ---
    socket.on('jumpToNextMilestone', () => {
        if (socket.id !== mainDisplaySocketId) {
            socket.emit('error', 'Unauthorized: Only the main display can trigger this.');
            return;
        }
        if (eventEnded) {
             socket.emit('info', 'Event has ended. No more jumps possible.');
             return;
        }
        if (isMilestoneCelebrationActive) {
            socket.emit('info', 'Cannot jump during active milestone celebration. Please close the carousel first.');
            return;
        }

        let nextMilestoneIndex = -1;
        for (let i = 0; i < MILESTONE_THRESHOLDS.length; i++) {
            if (!milestonesReachedStatus[i]) { // Find the first untriggered milestone
                nextMilestoneIndex = i;
                break;
            }
        }

        if (nextMilestoneIndex !== -1) {
            currentTapCount = MILESTONE_THRESHOLDS[nextMilestoneIndex]; // Set tap count to next milestone threshold
            console.log(`Main display forcing jump to Milestone ${nextMilestoneIndex + 1}. New tap count: ${currentTapCount}`);

            milestonesReachedStatus[nextMilestoneIndex] = true;
            isMilestoneCelebrationActive = true;

            io.to(mainDisplaySocketId).emit('milestoneReached', nextMilestoneIndex); // Trigger milestone display
            io.emit('eventStatus', {
                started: eventStarted,
                goSent: goSignalSent,
                eventEnded: eventEnded,
                milestoneReached: isMilestoneCelebrationActive,
                milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive,
                currentTapCount: currentTapCount,
                milestonesReachedStatus: milestonesReachedStatus
            });

            // If this jump completed the last milestone, trigger end celebration
            if (currentTapCount >= TOTAL_TAPS_REQUIRED && !eventEnded) {
                eventEnded = true;
                console.log('Total taps reached via jump. Triggering end celebration.');
                io.emit('endCelebration');
                io.emit('eventStatus', {
                    started: eventStarted, goSent: goSignalSent, eventEnded: eventEnded,
                    milestoneReached: isMilestoneCelebrationActive, milestoneCurrentlyBeingDisplayed: isMilestoneCelebrationActive,
                    currentTapCount: currentTapCount, milestonesReachedStatus: milestonesReachedStatus
                });
            }

        } else {
            socket.emit('info', 'No more milestones to jump to.');
        }
    });


    // --- Disconnection Handling ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (socket.id === mainDisplaySocketId) {
            mainDisplaySocketId = null;
            eventStarted = false;
            goSignalSent = false;
            eventEnded = false;
            currentTapCount = 0;
            milestonesReachedStatus = [false, false, false];
            isMilestoneCelebrationActive = false;
            console.log('Main display disconnected. Event state reset.');
            audienceSockets.forEach(audSocket => {
                io.to(audSocket.id).emit('mainDisplayStatus', false);
                io.to(audSocket.id).emit('eventStatus', {
                    started: false,
                    goSent: false,
                    eventEnded: false,
                    milestoneReached: false
                });
            });
        }
        if (audienceSockets.has(socket)) {
            audienceSockets.delete(socket);
            console.log(`Audience member disconnected: ${socket.id}. Total active: ${audienceSockets.size}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Basic error handling for server stability
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});