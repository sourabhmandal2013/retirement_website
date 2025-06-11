// public/js/audience.js
const socket = io();

const tapButton = document.getElementById('tapButton');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const audienceInfo = document.getElementById('audienceInfo');
const mainDisplayStatusText = document.getElementById('mainDisplayStatusText');
const eventStatusText = document.getElementById('eventStatusText');
const sliderContainer = document.getElementById('slider-container')

// NEW: Slider Elements
const sliderTrack = document.querySelector('.slider-track');
const greenWindow = document.getElementById('greenWindow');
const sliderBar = document.getElementById('sliderBar');
const redSliderIndicator = document.getElementById('redSliderIndicator'); // Added for the fixed red indicator

// NEW: Celebration Overlay for Audience
const celebrationOverlay = document.createElement('div');
celebrationOverlay.classList.add('celebration-overlay');
celebrationOverlay.innerHTML = `
    <h1 class="celebration-title">🎉 Congratulations! 🎉</h1>
    <p class="celebration-message">Thank you for participating!</p>
`;
document.body.appendChild(celebrationOverlay);


let isMainDisplayOnline = false;
let isEventStarted = false;
let isGoSignalSent = false;
let isMilestoneReached = false; // This flag now comes from server to control audience button during milestone celebrations
let isEventEnded = false; // NEW: Track final event state

// NEW: Slider Variables
let sliderAnimationId = null;
let sliderDirection = 1; // 1 for right, -1 for left
let sliderPosition = 0; // 0 to 1 (representing 0% to 100%)
const sliderSpeed = 0.003; // Adjust for faster/slower oscillation
const greenWindowWidth = 0.3; // 30%
let greenWindowStart = 0; // Start position of the green window (0 to 1 - greenWindowWidth)

function setRandomGreenWindow() {
    greenWindowStart = Math.random() * (1 - greenWindowWidth);
    greenWindow.style.left = `${greenWindowStart * 100}%`;
    greenWindow.style.width = `${greenWindowWidth * 100}%`;
}

function animateSlider() {
    sliderPosition += sliderDirection * sliderSpeed;

    if (sliderPosition > 1) {
        sliderPosition = 1;
        sliderDirection = -1;
    } else if (sliderPosition < 0) {
        sliderPosition = 0;
        sliderDirection = 1;
    }

    sliderBar.style.left = `${sliderPosition * 100}%`;
    sliderAnimationId = requestAnimationFrame(animateSlider);
}

function stopSliderAnimation() {
    if (sliderAnimationId) {
        cancelAnimationFrame(sliderAnimationId);
        sliderAnimationId = null;
    }
}

function startSliderAnimation() {
    if (!sliderAnimationId && !isEventEnded) {
        setRandomGreenWindow(); // Set new green window on start/reset
        sliderAnimationId = requestAnimationFrame(animateSlider);
    }
}

function resetSlider() {
    stopSliderAnimation();
    sliderPosition = 0;
    sliderDirection = 1;
    sliderBar.style.left = '0%';
    startSliderAnimation(); // Restart animation
}

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

function updateMainDisplayStatus(isConnected) {
    isMainDisplayOnline = isConnected;
    if (isConnected) {
        mainDisplayStatusText.textContent = 'Main Display: Online';
        mainDisplayStatusText.style.color = 'var(--success-dot)';
    } else {
        mainDisplayStatusText.textContent = 'Main Display: Offline';
        mainDisplayStatusText.style.color = 'var(--error-dot)';
    }
    updateButtonStates();
}

function updateEventStatus(status) {
    isEventStarted = status.started;
    isGoSignalSent = status.goSent;
    isMilestoneReached = status.milestoneReached; // Audience button will be disabled if true
    isEventEnded = status.eventEnded; // NEW: Update local flag

    if (isEventEnded) { // If event has ended, trigger celebration
        triggerCelebration();
        return;
    }

    // Only update text if event is not ended
    if (isEventStarted) {
        eventStatusText.textContent = 'Event Status: Live!';
        eventStatusText.style.color = 'var(--success-dot)';
    } else {
        eventStatusText.textContent = 'Event Status: Waiting for Start';
        eventStatusText.style.color = 'var(--warning-dot)';
    }
    updateButtonStates();
}

function updateButtonStates() {
    if (isEventEnded) { // NEW: If event has ended, disable all buttons and show end message
        tapButton.disabled = true;
        sliderBar.disabled = true
        tapButton.querySelector('span').textContent = 'Event Ended!';
        audienceInfo.textContent = 'The celebration is complete. Thank you for participating!';
        stopSliderAnimation(); // Stop slider
        // Hide slider container
        document.querySelector('.slider-container').style.display = 'none';
        return;
    }

    // Show slider container if not ended
    document.querySelector('.slider-container').style.display = 'block';

    if (!isMainDisplayOnline) {
        tapButton.disabled = true;
        
        tapButton.querySelector('span').textContent = 'Main Display Offline';
        audienceInfo.textContent = 'Waiting for the main display to come online...';
        stopSliderAnimation();
    } else if (!isEventStarted) {
        tapButton.disabled = true;
        tapButton.querySelector('span').textContent = 'please wait...';
        audienceInfo.textContent = 'Waiting for the send-off to begin...';
        stopSliderAnimation();
    } else { // Event Started and Main Display Online
        if (!isGoSignalSent) {
            tapButton.disabled = false;
            tapButton.querySelector('span').textContent = 'TAP!';
            audienceInfo.textContent = 'Be the first to TAP!';
            stopSliderAnimation(); // Slider doesn't run before 'Go'
        } else {
            // Slider logic is active when event is live and go signal sent
            startSliderAnimation();
            tapButton.disabled = isMilestoneReached;
            if (isMilestoneReached) {
                tapButton.querySelector('span').textContent = 'Milestone!';
                audienceInfo.textContent = 'Milestone being celebrated! Please wait...';
                stopSliderAnimation(); // Stop slider during milestone celebration
            } else {
                tapButton.querySelector('span').textContent = 'TAP!';
                audienceInfo.textContent = 'TAP when the bar is in the green window!';
            }
        }
    }
}

socket.on('connect', () => {
    console.log('Connected to server (Audience)');
    socket.emit('registerAudience');
    updateStatus(true);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server (Audience)');
    updateStatus(false);
    updateMainDisplayStatus(false);
    updateEventStatus({ started: false, goSent: false, eventEnded: false, milestoneReached: false });
    audienceInfo.textContent = 'Disconnected. Please refresh.';
    stopSliderAnimation(); // Stop slider on disconnect
});

socket.on('status', (message) => {
    console.log(`Server status: ${message}`);
});

socket.on('error', (message) => {
    console.error(`Server error: ${message}`);
    audienceInfo.textContent = `Error: ${message}`;
    updateButtonStates();
});

socket.on('mainDisplayStatus', (isConnected) => {
    updateMainDisplayStatus(isConnected);
});

socket.on('eventStatus', (status) => {
    updateEventStatus(status);
});

socket.on('info', (message) => {
    console.log(`Server info: ${message}`);
    audienceInfo.textContent = message;
    // Removed the setTimeout here as updateButtonStates will be called by eventStatus for accurate slider control
});

// NEW: End Celebration Listener for Audience
socket.on('endCelebration', () => {
    console.log('Received endCelebration from server for audience.');
    isEventEnded = true; // Set local flag
    triggerCelebration();
});


// Listener for the single tap button
tapButton.addEventListener('click', () => {
    if (!tapButton.disabled && !isEventEnded) { // Prevent taps if event ended
        if (isEventStarted && !isGoSignalSent) {
            socket.emit('goSignal');
            tapButton.disabled = true;
            tapButton.querySelector('span').textContent = 'Sending Go...';
            stopSliderAnimation(); // No slider before go signal
        } else if (isEventStarted && isGoSignalSent && !isMilestoneReached) {
            // NEW: Tap logic with slider validation
            const isWithinGreenWindow = (sliderPosition >= greenWindowStart && sliderPosition <= (greenWindowStart + greenWindowWidth));

            if (isWithinGreenWindow) {
                console.log('TAP successful! Within green window.');
                audienceInfo.textContent = 'Going Great!';
                socket.emit('tapEvent');
                setRandomGreenWindow(); // Set a new green window after successful tap
            } else {
                console.log('TAP missed! Not within green window. Resetting slider.');
                audienceInfo.textContent = 'Missed! Try again when the bar is in the green.';
                resetSlider(); // Reset slider position and direction
            }
        }
        tapButton.classList.add('tapped-feedback');
        setTimeout(() => {
            tapButton.classList.remove('tapped-feedback');
        }, 100);
    }
});

// NEW: Final Celebration Function for Audience
function triggerCelebration() {
    // Hide standard controls
    tapButton.style.display = 'none';
    audienceInfo.style.display = 'none';
    mainDisplayStatusText.style.display = 'none';
    eventStatusText.style.display = 'none';
    statusDot.style.display = 'none';
    statusText.style.display = 'none';
    document.querySelector('.slider-container').style.display = 'none'; // Hide slider

    // Show celebration overlay
    celebrationOverlay.classList.add('active');
    console.log('Audience celebration triggered!');
    stopSliderAnimation(); // Ensure slider stops
}

// Initial state on page load
updateStatus(false);
updateMainDisplayStatus(false);
updateEventStatus({ started: false, goSent: false, eventEnded: false, milestoneReached: false }); // Initialize with eventEnded: false
updateButtonStates();