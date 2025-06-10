// public/js/main.js
const socket = io();

const initialContent = document.getElementById('initialContent');
const qrCode = document.getElementById('qrCode');
const startButton = document.getElementById('startButton');
const videoContainer = document.getElementById('videoContainer');
const displayVideo = document.getElementById('displayVideo');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const resetButtonContainer = document.getElementById('resetButtonContainer');
const resetButton = document.getElementById('resetButton');

// Carousel Elements
const carouselOverlay = document.getElementById('carouselOverlay');
const carouselTitle = document.getElementById('carouselTitle');
const carouselSlides = document.getElementById('carouselSlides');
const closeCarouselButton = document.getElementById('closeCarouselButton');

// Post-Milestone Control Elements
const postMilestoneControls = document.getElementById('postMilestoneControls');
const showMilestoneButton = document.getElementById('showMilestoneButton');
const jumpToNextMilestoneButton = document.getElementById('jumpToNextMilestoneButton');

// Celebration Overlay
const celebrationOverlay = document.getElementById('celebrationOverlay');

// ** IMPORTANT: Configure your video paths here **
const videoA_paths = [
    'videos/video_a_1.webm',
    'videos/video_a_2.webm',
    'videos/video_a_3.webm',
];
const videoB_paths = [
    'videos/video_b_1.webm',
    'videos/video_b_2.webm',
    // Add more video_b if desired for random selection
];

// ** IMPORTANT: Configure your milestone image paths here **
const milestoneImages = {
    0: [ // Milestone 1 images (index 0)
        'milestone1/image1.jpg',
        'milestone1/image2.jpg',
        'milestone1/image3.jpg',
    ],
    1: [ // Milestone 2 images (index 1)
        'milestone2/image1.jpg',
        'milestone2/image2.jpg',
        'milestone2/image3.jpg',
    ],
    2: [ // Milestone 3 images (index 2) - final
        'milestone3/image1.jpg',
        'milestone3/image2.jpg',
        'milestone3/image3.jpg'
    ]
};

const milestoneHeadings = [
    "Graduated from somewhere",
    "Went for some roadtrip",
    "Became owner of a big blue building",
];


// --- NEW CONFIGURATION FOR TAP-CONTROLLED PLAYBACK ---
const CAROUSEL_SLIDE_DURATION = 3000; // Time each slide stays on screen in carousel (in ms)
const TAP_TIMEOUT_DURATION = 1000; // 1 seconds: If no taps for this duration, switch to video_a
const VIDEO_B_PLAY_DURATION = 2000; // 2 seconds: This value is no longer used for segment pausing, kept for consistency
// ---------------------------------------------------

let currentVideoA = null; // Currently playing video A path
let currentVideoB = null; // Currently playing video B path (the one intended to be played)
let lastPickedVideoA = null; // Tracks last video A to avoid immediate repetition
let lastPickedVideoB = null; // Tracks last video B to avoid immediate repetition (for when picking a *new* one)

let isEventStarted = false;
let isEventEnded = false; // Track final event state
let isMilestoneDisplaying = false; // Flag to control video advancement during carousel
let currentCarouselSlideIndex = 0;
let carouselInterval;
let lastTriggeredMilestoneIndex = -1; // To know which milestone to show again

let tapTimeout = null; // Timeout for inactivity (switches to video_a)
let isFallbackToVideoA = false; // Flag to indicate if video_a is playing due to inactivity

// Keep track of milestone thresholds on client for button logic
const MILESTONE_THRESHOLDS = [33, 66, 100]; // Must match server.js
let clientMilestonesReachedStatus = [false, false, false]; // To enable/disable jump button

// --- Helper function to pick a random video, avoiding the last one ---
function pickRandomVideo(videoPaths, lastPicked) {
    if (!videoPaths || videoPaths.length === 0) {
        console.warn('No video paths provided.');
        return null;
    }
    if (videoPaths.length === 1) {
        return videoPaths[0]; // If only one option, just return it
    }

    let newVideo;
    let attempts = 0;
    do {
        const randomIndex = Math.floor(Math.random() * videoPaths.length);
        newVideo = videoPaths[randomIndex];
        attempts++;
    } while (newVideo === lastPicked && attempts < 10); // Limit attempts to avoid infinite loop if options are exhausted (though unlikely here)

    if (attempts >= 10) {
        console.warn('Failed to pick a different video after multiple attempts. Picking a random one regardless.');
    }
    return newVideo;
}

// --- Video Playback Functions ---

function playRandomVideoA() {
    if (isEventEnded) {
        console.log("playRandomVideoA: Event ended, not playing A.");
        return;
    }

    const newVideoA = pickRandomVideo(videoA_paths, lastPickedVideoA);
    if (!newVideoA) {
        console.warn("playRandomVideoA: No new video A selected.");
        return;
    }

    if (displayVideo.src !== newVideoA) { // Only change if different
        displayVideo.src = newVideoA;
        displayVideo.load();
        lastPickedVideoA = newVideoA;
        currentVideoA = newVideoA; // Explicitly track current video A
        console.log(`playRandomVideoA: Setting video A src to ${newVideoA}`);
    } else {
        console.log(`playRandomVideoA: Video A src already ${newVideoA}.`);
    }

    displayVideo.loop = true;
    displayVideo.muted = true; // Always muted for A
    displayVideo.play().catch(error => {
        console.warn('Autoplay prevented for video A. User interaction might be required. Error:', error);
    });
    console.log(`Playing Video A: ${newVideoA}`);
    stopTapTimeout(); // No tap timeout needed for video A when A is intentionally playing
}

/**
 * Gets a new random video B path, ensuring it's different from the last one played.
 * Updates lastPickedVideoB.
 * @returns {string|null} The path to the new video B, or null if none available.
 */
function getNewRandomVideoBPath() {
    const newVideoB = pickRandomVideo(videoB_paths, lastPickedVideoB);
    if (newVideoB) {
        lastPickedVideoB = newVideoB; // Update last picked only when a new one is successfully picked
    }
    return newVideoB;
}

/**
 * Plays a specific video B path. This is the unified function for playing/resuming video B.
 * Handles loading, playing, and setting currentVideoB.
 * @param {string} videoPath - The path to the video B file to play.
 */
function playVideoB(videoPath) {
    if (isEventEnded) {
        console.log("playVideoB: Event ended, not playing B.");
        return;
    }
    if (!videoPath) {
        console.warn("playVideoB: No video path provided.");
        return;
    }

    if (displayVideo.src !== videoPath) {
        displayVideo.src = videoPath;
        displayVideo.load();
        currentVideoB = videoPath; // This is now the truly current video B
        console.log(`playVideoB: Setting video B src to ${videoPath}`);
        displayVideo.currentTime = 0; // Always reset to 0 for a new video load
    } else {
        console.log(`playVideoB: Video B src already ${videoPath}.`);
        // If it's the same video and it was paused, just play it from where it left off
        if (displayVideo.paused) {
            console.log('Resuming same Video B.');
        }
    }

    displayVideo.loop = false; // Video B should not loop indefinitely, let it play to end
    displayVideo.muted = false;

    displayVideo.play().catch(error => {
        console.warn('Autoplay prevented for video B. Error:', error);
    });

    console.log(`Playing Video B: ${videoPath}.`);
    startTapTimeout(); // Always reset tap timeout when B is active
}

function startTapTimeout() {
    stopTapTimeout(); // Clear any existing inactivity timeout
    tapTimeout = setTimeout(() => {
        console.log('Tap inactivity detected. Switching to Video A fallback.');
        isFallbackToVideoA = true;
        playRandomVideoA();
    }, TAP_TIMEOUT_DURATION);
    console.log(`Tap timeout started for ${TAP_TIMEOUT_DURATION / 1000} seconds.`);
}

function stopTapTimeout() {
    if (tapTimeout) {
        clearTimeout(tapTimeout);
        tapTimeout = null;
        console.log('Tap timeout stopped.');
    }
}

// Called when a tap event comes from the server
function advanceVideoFrame() {
    if (isEventEnded || isMilestoneDisplaying) {
        console.log('advanceVideoFrame: Event ended or milestone active, not processing.');
        return;
    }

    // Always reset tap timeout on any advance signal
    startTapTimeout();

    let newVideoNeeded = false;
    if (displayVideo.src.includes('video_a')) {
        console.log('Advance signal received while video_a was playing. Picking a new video_b.');
        newVideoNeeded = true;
    } else if (currentVideoB && displayVideo.ended) { // If B was playing and finished
        console.log('Advance signal received after video_b completed. Picking a new video_b.');
        newVideoNeeded = true;
    } else if (!currentVideoB) { // First time playing video B, or currentVideoB not set for some reason
        console.log('First advance signal or currentVideoB not set. Picking a new video_b.');
        newVideoNeeded = true;
    }

    if (newVideoNeeded) {
        const newVideoBPath = getNewRandomVideoBPath();
        if (newVideoBPath) {
            playVideoB(newVideoBPath);
        } else {
            console.warn("No new video B available to switch to on advance signal.");
        }
    } else {
        // If already on video_b and not ended, just ensure it's playing
        console.log(`Advance signal received while video_b (${currentVideoB}) was playing and not ended. Ensuring it continues.`);
        displayVideo.play().catch(error => {
            console.warn('Autoplay prevented for video B on continue. Error:', error);
        });
    }
}

// --- UI and Socket Handlers ---

function updateStatus(isConnected) {
    if (isConnected) {
        statusDot.classList.remove('disconnected', 'connecting');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
    } else {
        statusDot.classList.remove('connected', 'connecting');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
    }
}

socket.on('connect', () => {
    console.log('Connected to server (Main Display)');
    socket.emit('registerMainDisplay');
    updateStatus(true);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server (Main Display)');
    updateStatus(false);
    resetDisplay(); // Reset state on disconnect
});

socket.on('forceDisconnect', (message) => {
    console.warn(`Forced disconnect received: ${message}`);
    alert(`Server message: ${message}\nThis main display connection will be closed.`);
    socket.disconnect(true); // Disconnect fully
    resetDisplay();
});

socket.on('status', (message) => {
    console.log(`Server status: ${message}`);
});

socket.on('eventStatus', (status) => {
    isEventStarted = status.started;
    isEventEnded = status.eventEnded;
    isMilestoneDisplaying = status.milestoneCurrentlyBeingDisplayed;
    clientMilestonesReachedStatus = status.milestonesReachedStatus || [false, false, false];

    console.log('Received eventStatus:', status);

    if (isEventEnded) {
        triggerCelebration();
        return;
    }

    if (isEventStarted) {
        // Transition from initial content to video
        if (initialContent.style.display !== 'none') {
            initialContent.style.opacity = '0';
            qrCode.style.display = 'none';
            startButton.style.display = 'none';
            setTimeout(() => {
                initialContent.style.display = 'none';
                videoContainer.classList.add('active');
            }, 700);
        }

        resetButtonContainer.classList.add('active');

        if (isMilestoneDisplaying) {
            displayVideo.pause(); // Ensure video is paused
            stopTapTimeout(); // Stop tap timeout during carousel

            // Find the highest active milestone to show it if refreshing during celebration
            let highestMilestoneIdx = -1;
            for(let i = clientMilestonesReachedStatus.length - 1; i >= 0; i--) {
                if(clientMilestonesReachedStatus[i]) {
                    highestMilestoneIdx = i;
                    break;
                }
            }
            if (highestMilestoneIdx !== -1) {
                lastTriggeredMilestoneIndex = highestMilestoneIdx;
                showCarousel(lastTriggeredMilestoneIndex); // No auto-emitComplete here
            } else {
                console.warn("Milestone displaying, but no reached milestone found in status. Hiding carousel.");
                hideCarousel(); // Fallback to ensure carousel is hidden
            }
            // Hide post-milestone buttons when carousel is active
            postMilestoneControls.classList.remove('active');
        } else { // No milestone currently displaying
            hideCarousel(); // Ensure carousel is hidden
            videoContainer.classList.remove('zoomed-out'); // Ensure video is not zoomed out

            if (!status.goSent) { // Event started, but 'go' signal not sent yet
                playRandomVideoA();
            } else { // 'go' signal has been sent
                // When eventStatus indicates goSent, ensure Video B is playing
                // If it's the very first time, or A was playing, or B finished, pick new B
                if (!currentVideoB || displayVideo.src.includes('video_a') || displayVideo.ended) {
                    const newVideoBPath = getNewRandomVideoBPath();
                    if (newVideoBPath) {
                        playVideoB(newVideoBPath);
                    } else {
                        console.warn("eventStatus: No new video B available to switch to.");
                    }
                } else {
                    console.log(`eventStatus: Already on Video B (${currentVideoB}). Ensuring it continues.`);
                    displayVideo.play().catch(error => {
                        console.warn('Autoplay prevented for video B on eventStatus continue. Error:', error);
                    });
                    startTapTimeout(); // Keep tap timeout running for inactivity detection
                }
            }
            displayPostMilestoneButtons(lastTriggeredMilestoneIndex);
        }
    } else {
        resetDisplay();
    }
});

socket.on('goSignal', () => {
    console.log('Received goSignal from audience.');
    advanceVideoFrame(); // Delegate to shared logic
});

socket.on('milestoneReached', (milestoneIndex) => {
    console.log(`Milestone ${milestoneIndex + 1} reached!`);
    isMilestoneDisplaying = true; // Block video advancement
    lastTriggeredMilestoneIndex = milestoneIndex; // Store for 'show again' button
    displayVideo.pause(); // Pause video B for celebration
    stopTapTimeout(); // Stop the inactivity timeout

    // Hide post-milestone buttons immediately
    postMilestoneControls.classList.remove('active');

    videoContainer.classList.add('zoomed-out'); // Apply zoom-out animation
    setTimeout(() => { // Short delay to allow zoom out to start before carousel appears
        showCarousel(milestoneIndex); // No auto-emitComplete here
    }, 500); // Adjust delay as needed
});

socket.on('advanceVideoFrame', () => {
    advanceVideoFrame(); // Call the shared function
});

socket.on('endCelebration', () => {
    console.log('Received endCelebration from server.');
    isEventEnded = true;
    triggerCelebration();
});

socket.on('resetEvent', () => {
    console.log('Received direct resetEvent from server.');
    resetDisplay();
});


// --- Button Event Listeners ---

startButton.addEventListener('click', () => {
    startButton.disabled = true;
    socket.emit('startEvent');
});

resetButton.addEventListener('click', () => {
    socket.emit('resetEvent');
});


// --- Carousel Functions ---

function showCarousel(milestoneIndex) {
    const images = milestoneImages[milestoneIndex];
    if (!images || images.length === 0) {
        console.warn(`No images found for milestone ${milestoneIndex}. Hiding carousel.`);
        hideCarousel();
        socket.emit('milestoneDisplayComplete'); // If no images, signal completion
        return;
    }

    carouselSlides.innerHTML = ''; // Clear previous images
    images.forEach((imgPath, idx) => {
        const slideDiv = document.createElement('div');
        slideDiv.classList.add('carousel-slide');
        if (idx === 0) {
            slideDiv.classList.add('active'); // First slide active
        }
        const img = document.createElement('img');
        img.src = imgPath;
        img.alt = `Milestone Image ${idx + 1}`;
        slideDiv.appendChild(img);
        carouselSlides.appendChild(slideDiv); // Append the slideDiv, not just the img
    });


    carouselTitle.textContent = milestoneHeadings[milestoneIndex];

    // carouselTitle.textContent = `Milestone ${milestoneIndex + 1} Achieved!`;
    carouselOverlay.classList.add('active');
    closeCarouselButton.style.display = 'flex'; // Show close button
    currentCarouselSlideIndex = 0;

    clearInterval(carouselInterval);
    if (images.length > 1) {
        carouselInterval = setInterval(nextSlide, CAROUSEL_SLIDE_DURATION); // Change slide every X seconds
    }
    // REMOVED: setTimeout to hide carousel automatically. Now only closes with button click.
}

function nextSlide() {
    const slides = document.querySelectorAll('.carousel-slide');
    if (slides.length === 0) return;

    slides[currentCarouselSlideIndex].classList.remove('active');
    currentCarouselSlideIndex = (currentCarouselSlideIndex + 1) % slides.length;
    slides[currentCarouselSlideIndex].classList.add('active');
}

function hideCarousel() {
    carouselOverlay.classList.remove('active');
    closeCarouselButton.style.display = 'none'; // Hide close button
    videoContainer.classList.remove('zoomed-out');
    clearInterval(carouselInterval);
    // isMilestoneDisplaying will be reset by server after milestoneDisplayComplete emission
    // Video will resume its tap-based playback after server updates isMilestoneDisplaying
}

// --- Functions for post-milestone buttons ---
function displayPostMilestoneButtons(milestoneIdx) {
    if (isEventEnded || isMilestoneDisplaying) { // If event ended or carousel is active, hide these buttons
        postMilestoneControls.classList.remove('active');
        return;
    }

    // Show Milestone Again button
    if (milestoneIdx !== -1) {
        showMilestoneButton.textContent = `Show Milestone ${milestoneIdx + 1} Again`;
        showMilestoneButton.style.display = 'block';
    } else {
        showMilestoneButton.style.display = 'none';
    }

    // Jump to Next Milestone button
    let nextMilestoneIdx = -1;
    for (let i = 0; i < MILESTONE_THRESHOLDS.length; i++) {
        if (!clientMilestonesReachedStatus[i]) { // Find the first untriggered milestone
            nextMilestoneIdx = i;
            break;
        }
    }

    if (nextMilestoneIdx !== -1) {
        jumpToNextMilestoneButton.textContent = `Jump to Milestone ${nextMilestoneIdx + 1}`;
        jumpToNextMilestoneButton.style.display = 'block';
    } else {
        jumpToNextMilestoneButton.style.display = 'none'; // No more milestones to jump to
    }

    // Only activate if there's at least one button to show
    if (showMilestoneButton.style.display === 'block' || jumpToNextMilestoneButton.style.display === 'block') {
        postMilestoneControls.classList.add('active');
    } else {
        postMilestoneControls.classList.remove('active');
    }
}

// Event Listeners for post-milestone buttons and close button
closeCarouselButton.addEventListener('click', () => {
    hideCarousel();
    socket.emit('milestoneDisplayComplete'); // Inform server that carousel is closed
    // Server will update isMilestoneDisplaying to false, then eventStatus will be sent,
    // which will then call displayPostMilestoneButtons
});

showMilestoneButton.addEventListener('click', () => {
    if (lastTriggeredMilestoneIndex !== -1) {
        // We only show it again, so don't emit 'milestoneDisplayComplete' automatically
        showCarousel(lastTriggeredMilestoneIndex);
        postMilestoneControls.classList.remove('active'); // Hide buttons when carousel is opened
    }
});

jumpToNextMilestoneButton.addEventListener('click', () => {
    console.log('Attempting to jump to next milestone...');
    if (!isMilestoneDisplaying && !isEventEnded) { // Cannot jump if a celebration is already active or event ended
        socket.emit('jumpToNextMilestone');
        postMilestoneControls.classList.remove('active'); // Hide buttons once jump is initiated
    } else {
        console.warn('Cannot jump to next milestone: milestone active or event ended.');
    }
});


// --- Final Celebration Function ---
function triggerCelebration() {
    console.log('Triggering final celebration.');
    displayVideo.pause();
    displayVideo.src = ''; // Clear video
    videoContainer.classList.remove('active', 'zoomed-out');
    initialContent.style.display = 'none';
    resetButtonContainer.classList.remove('active');
    postMilestoneControls.classList.remove('active'); // Ensure these are hidden
    hideCarousel(); // Ensure carousel is hidden

    celebrationOverlay.classList.add('active'); // Show celebration overlay
    statusText.textContent = 'Event Ended!'; // Update status
    statusDot.classList.remove('connected', 'connecting', 'disconnected');
    statusDot.classList.add('success'); // Green dot for celebration

    stopTapTimeout(); // Ensure no lingering timeouts
}


// --- Reset Function ---
function resetDisplay() {
    console.log('Resetting display.');
    displayVideo.pause();
    displayVideo.currentTime = 0;
    displayVideo.src = '';
    displayVideo.muted = true;
    displayVideo.loop = false;
    displayVideo.onended = null;

    isEventStarted = false;
    isEventEnded = false;
    isMilestoneDisplaying = false;
    lastTriggeredMilestoneIndex = -1;
    clientMilestonesReachedStatus = [false, false, false];
    currentVideoA = null;
    currentVideoB = null;
    lastPickedVideoA = null;
    lastPickedVideoB = null;
    isFallbackToVideoA = false;

    hideCarousel();
    celebrationOverlay.classList.remove('active');

    videoContainer.classList.remove('active', 'zoomed-out');
    initialContent.style.display = 'flex';
    initialContent.style.opacity = '1';
    qrCode.style.display = 'block';
    startButton.style.display = 'block';
    startButton.disabled = false;
    resetButtonContainer.classList.remove('active');
    postMilestoneControls.classList.remove('active');
    statusText.textContent = 'Connected';

    stopTapTimeout(); // Clear any existing tap timeout
}

// Initial state
updateStatus(false);
resetDisplay(); // Call reset to ensure initial state is clean