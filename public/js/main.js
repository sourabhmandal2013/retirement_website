// public/js/main.js
const socket = io();

// --- HTML Element References ---
const initialContent = document.getElementById("initialContent");
const qrCode = document.getElementById("qrCode");
const startButton = document.getElementById("startButton");
const videoContainer = document.getElementById("videoContainer");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const resetButtonContainer = document.getElementById("resetButtonContainer");
const resetButton = document.getElementById("resetButton");
const carouselOverlay = document.getElementById("carouselOverlay");
const carouselTitle = document.getElementById("carouselTitle");
const carouselSlides = document.getElementById("carouselSlides");
const closeCarouselButton = document.getElementById("closeCarouselButton");
const postMilestoneControls = document.getElementById("postMilestoneControls");
const showMilestoneButton = document.getElementById("showMilestoneButton");
const jumpToNextMilestoneButton = document.getElementById(
  "jumpToNextMilestoneButton"
);
const celebrationOverlay = document.getElementById("celebrationOverlay");
// Removed fadeOverlay as it's no longer needed in this strategy

// --- Configuration ---

// ** IMPORTANT: Configure your YouTube Video IDs here **
const videoA_paths = [
  "y1zjk20NP4I", // Example: YouTube Video ID a1
  "FyW2q0oxbwY", // Example: YouTube Video ID a2
  "XHHMsFFBZok", // Example: YouTube Video ID a3
];
const videoB_paths = [
  "dSJucwwoQe4", // Example: YouTube Video ID b1
  "U-53V1aEzxM", // Example: YouTube Video ID b2
];

// ** IMPORTANT: Configure your milestone image paths here **
const milestoneImages = {
  0: [
    "milestone1/image1.jpg",
    "milestone1/image2.jpg",
    "milestone1/image3.jpg",
  ],
  1: [
    "milestone2/image1.jpg",
    "milestone2/image2.jpg",
    "milestone2/image3.jpg",
  ],
  2: [
    "milestone3/image1.jpg",
    "milestone3/image2.jpg",
    "milestone3/image3.jpg",
  ],
};

const milestoneHeadings = [
  "Graduated from somewhere",
  "Went for some roadtrip",
  "Became owner of a big blue building",
];

// Timings and behavior
const CAROUSEL_SLIDE_DURATION = 3000; // ms for each carousel slide
const TAP_TIMEOUT_DURATION = 3000; // 3 seconds of inactivity before switching to Video A
// FADE_TRANSITION_DURATION is no longer relevant

// --- State Variables ---
let currentVideoA_Id = null;
let currentVideoB_Id = null;
let lastPickedVideoA_Id = null;
let lastPickedVideoB_Id = null;

let isEventStarted = false;
let isEventEnded = false;
let isMilestoneDisplaying = false;
let lastTriggeredMilestoneIndex = -1;
let carouselInterval;
let tapTimeout = null;

let clientMilestonesReachedStatus = [false, false, false];
const MILESTONE_THRESHOLDS = [25, 50, 75]; // Must match server.js

// --- YouTube Player Variables ---
const players = new Map(); // Stores all YT.Player instances keyed by videoId
let activeVideoId = null; // Tracks the currently visible video ID

/**
 * Initializes all YouTube players for seamless switching.
 * This is called once when the YouTube Iframe API is ready.
 */
function initializeAllPlayers() {
  console.log("Initializing all YouTube players...");
  // Combine all unique video IDs from both A and B lists
  const uniqueVideoIds = [...new Set([...videoA_paths, ...videoB_paths])];

  uniqueVideoIds.forEach((videoId) => {
    const playerDivId = `player-${videoId}`;
    const playerDiv = document.getElementById(playerDivId);

    if (!playerDiv) {
      console.error(
        `Player div with ID ${playerDivId} not found. Please ensure all video IDs from videoA_paths and videoB_paths have corresponding player divs in main.html.`
      );
      return;
    }

    const player = new YT.Player(playerDivId, {
      height: "100%",
      width: "100%",
      videoId: videoId,
      playerVars: {
        playsinline: 1,
        autoplay: 1, // Autoplay to keep videos playing in background
        controls: 0, // No controls
        disablekb: 1,
        fs: 0,
        rel: 0, // Do not show related videos
        modestbranding: 1, // Hide YouTube logo
        iv_load_policy: 3, // Hide video annotations
        showinfo: 0, // Hide video title and uploader info
        origin: "choreoapps.dev",//window.location.origin,
        vq: "hd1080", // Suggest 1080p
      },
      events: {
        onReady: (event) => {
          console.log(`Player for ${videoId} is ready.`);
          event.target.mute(); // Mute all players initially
          // Start playing to buffer and keep them ready in the background
          event.target.setPlaybackQuality("hd1080");
          event.target.playVideo();
          //.catch(err => {
          // Autoplay might be prevented on some browsers initially, which is fine
          // as we only unmute the active one.
          //  console.warn(`Autoplay prevented for ${videoId} (initial buffer):`, err);
          //  });
        },
        onStateChange: (event) => {
          // Loop videos when they end
          if (event.data !== "hd1080") {
            event.target.setPlaybackQuality("hd1080");
          }
          if (event.data === YT.PlayerState.ENDED) {
            event.target.playVideo();
          }
        },
        onError: (event) => {
          console.error(`Youtubeer Error for ${videoId}:`, event.data);
          // Implement error handling, e.g., try next video or show a message
        },
      },
    });
    players.set(videoId, player); // Store the player instance
  });

  // After all players are initialized, play the initial idle video (Video A)
  // This is delayed slightly to ensure all iframes have had a chance to render.
  setTimeout(() => {
    if (!isEventStarted) {
      playRandomVideoA(); // Play initial random A video
    }
  }, 700); // Give a bit more time for all players to load and buffer
}

/**
 * This function is the entry point, called automatically by the YouTube Iframe API script
 * when it finishes loading. It's responsible for creating the video player.
 */
function onYouTubeIframeAPIReady() {
  console.log("YouTube Iframe API is ready. Initializing player pool.");
  initializeAllPlayers();
}

/**
 * Manages the visibility and audio of the players for seamless switching.
 * @param {string} newVideoId - The video ID to make active.
 * @param {boolean} shouldUnmute - True if the new video should be unmuted.
 */
function switchVideoVisibility(newVideoId, shouldUnmute) {
  if (activeVideoId === newVideoId) {
    // If trying to switch to the same video, just ensure it's playing and mute/unmute
    const activePlayer = players.get(activeVideoId);
    if (activePlayer) {
      activePlayer.playVideo();
      //.catch(err => console.warn("Autoplay was prevented:", err));
      if (shouldUnmute) activePlayer.unMute();
      else activePlayer.mute();
    }
    return;
  }

  // Hide current active video
  if (activeVideoId) {
    const currentActivePlayerDiv = document.getElementById(
      `player-${activeVideoId}`
    );
    if (currentActivePlayerDiv) {
      currentActivePlayerDiv.classList.remove("active");
    }
    const currentActivePlayer = players.get(activeVideoId);
    if (currentActivePlayer) {
      currentActivePlayer.mute(); // Mute the video being hidden
    }
  }

  // Show and unmute new video
  const newPlayerDiv = document.getElementById(`player-${newVideoId}`);
  if (newPlayerDiv) {
    newPlayerDiv.classList.add("active");
  }
  const newPlayer = players.get(newVideoId);
  if (newPlayer) {
    // if (shouldUnmute) newPlayer.unMute();
    // else newPlayer.mute(); // Ensure it's muted if requested
    newPlayer.playVideo();
    //.catch(err => console.warn("Autoplay was prevented for new video:", err));
  }

  activeVideoId = newVideoId;
  console.log(`Switched active video to: ${activeVideoId}`);
}

function pickRandomVideo(videoPaths, lastPicked) {
  if (!videoPaths || videoPaths.length === 0) return null;
  if (videoPaths.length === 1) return videoPaths[0];

  let newVideo;
  do {
    newVideo = videoPaths[Math.floor(Math.random() * videoPaths.length)];
  } while (newVideo === lastPicked);
  return newVideo;
}

function playRandomVideoA() {
  if (isEventEnded) return;

  const newVideoId = pickRandomVideo(videoA_paths, lastPickedVideoA_Id);
  if (!newVideoId) {
    console.warn("No new Video A available.");
    return;
  }

  switchVideoVisibility(newVideoId, true); // true = unmute (Video A is background ambience)
  lastPickedVideoA_Id = newVideoId;
  currentVideoA_Id = newVideoId;
  currentVideoB_Id = null; // We are now on a Video A
  stopTapTimeout();
}

function getNewRandomVideoBPath() {
  const newVideoB = pickRandomVideo(videoB_paths, lastPickedVideoB_Id);
  if (newVideoB) {
    lastPickedVideoB_Id = newVideoB;
  }
  return newVideoB;
}

function playVideoB(videoId) {
  if (isEventEnded) return;
  if (!videoId) {
    console.warn("playVideoB called with no video ID.");
    return;
  }

  switchVideoVisibility(videoId, false); // false = unmute (Video B is the main focus)
  currentVideoB_Id = videoId;
  currentVideoA_Id = null; // We are now on a Video B
  startTapTimeout();
}

function startTapTimeout() {
  stopTapTimeout();
  tapTimeout = setTimeout(() => {
    console.log("Tap inactivity detected. Switching to Video A.");
    playRandomVideoA();
  }, TAP_TIMEOUT_DURATION);
}

function stopTapTimeout() {
  if (tapTimeout) {
    clearTimeout(tapTimeout);
    tapTimeout = null;
  }
}

function advanceVideoFrame() {
  if (isEventEnded || isMilestoneDisplaying) return; // Removed isPlayerReady check

  startTapTimeout(); // Reset inactivity timer on every tap

  const activePlayer = players.get(activeVideoId);
  const playerState = activePlayer ? activePlayer.getPlayerState() : -1; // Get state of active player

  let newVideoNeeded = false;

  // Switch to B if A is playing, or if B has ended
  if (currentVideoA_Id || playerState === YT.PlayerState.ENDED) {
    newVideoNeeded = true;
  }

  if (newVideoNeeded) {
    const newVideoB_Id = getNewRandomVideoBPath();
    if (newVideoB_Id) {
      playVideoB(newVideoB_Id);
    } else {
      console.warn("No new Video B available to switch to.");
    }
  } else {
    // If already on a video B that is paused/buffering, just play it
    if (activePlayer && playerState !== YT.PlayerState.PLAYING) {
      activePlayer.playVideo();
    }
  }
}

// --- UI, Socket Handlers, and Other Functions ---

function updateStatus(isConnected) {
  statusDot.className = "status-dot"; // Reset classes
  if (isConnected) {
    statusDot.classList.add("connected");
    statusText.textContent = "Connected";
  } else {
    statusDot.classList.add("disconnected");
    statusText.textContent = "Disconnected";
  }
}

socket.on("connect", () => {
  console.log("Connected to server (Main Display)");
  socket.emit("registerMainDisplay");
  updateStatus(true);
});

socket.on("disconnect", () => {
  console.log("Disconnected from server (Main Display)");
  updateStatus(false);
  resetDisplay();
});

socket.on("forceDisconnect", (message) => {
  alert(`Server message: ${message}\nThis connection will be closed.`);
  socket.disconnect(true);
  resetDisplay();
});

socket.on("eventStatus", (status) => {
  isEventStarted = status.started;
  isEventEnded = status.eventEnded;
  isMilestoneDisplaying = status.milestoneCurrentlyBeingDisplayed;
  clientMilestonesReachedStatus = status.milestonesReachedStatus || [
    false,
    false,
    false,
  ];

  if (isEventEnded) {
    triggerCelebration();
    return;
  }

  if (isEventStarted) {
    if (initialContent.style.display !== "none") {
      initialContent.style.opacity = "0";
      setTimeout(() => {
        initialContent.style.display = "none";
        videoContainer.classList.add("active");
      }, 700);
    }
    resetButtonContainer.classList.add("active");

    if (isMilestoneDisplaying) {
      const activePlayer = players.get(activeVideoId);
      if (activePlayer) activePlayer.pauseVideo();
      stopTapTimeout();
      let highestMilestoneIdx = clientMilestonesReachedStatus.lastIndexOf(true);
      if (highestMilestoneIdx !== -1) {
        lastTriggeredMilestoneIndex = highestMilestoneIdx;
        showCarousel(lastTriggeredMilestoneIndex);
      }
      postMilestoneControls.classList.remove("active");
    } else {
      hideCarousel();
      videoContainer.classList.remove("zoomed-out");
      if (!status.goSent) {
        // If event started but go signal not sent yet, ensure Video A is playing
        playRandomVideoA();
      } else {
        // If go signal is active, ensure a B video is playing
        const activePlayer = players.get(activeVideoId);
        if (
          currentVideoA_Id || // If currently on A, switch to B
          (activePlayer &&
            activePlayer.getPlayerState() === YT.PlayerState.ENDED) // Or if current video ended
        ) {
          const newVideoB_Id = getNewRandomVideoBPath();
          if (newVideoB_Id) playVideoB(newVideoB_Id);
        } else {
          if (activePlayer) activePlayer.playVideo(); // Resume if paused
          startTapTimeout();
        }
      }
      displayPostMilestoneButtons(lastTriggeredMilestoneIndex);
    }
  } else {
    resetDisplay();
  }
});

socket.on("goSignal", (data) => {
  console.log("Go signal received:", data);
  if (!isEventStarted) {
    isEventStarted = true;
    initialContent.style.opacity = "0";
    initialContent.style.pointerEvents = "none";

    setTimeout(() => {
      initialContent.style.display = "none";
      videoContainer.classList.add("active");
      resetButtonContainer.classList.add("active");
      statusText.textContent = "Event Live!";
      statusDot.className = "status-dot connected";
    }, 700); // Keep fade transition duration for initial content hide
  }
  // Advance video frame on subsequent go signals (taps)
  advanceVideoFrame();
});

socket.on("advanceVideoFrame", advanceVideoFrame);

socket.on("milestoneReached", (milestoneIndex) => {
  isMilestoneDisplaying = true;
  lastTriggeredMilestoneIndex = milestoneIndex;
  const activePlayer = players.get(activeVideoId);
  if (activePlayer) activePlayer.pauseVideo();
  stopTapTimeout();
  postMilestoneControls.classList.remove("active");
  videoContainer.classList.add("zoomed-out");
  setTimeout(() => showCarousel(milestoneIndex), 500);
});

socket.on("endCelebration", () => {
  isEventEnded = true;
  triggerCelebration();
});

socket.on("resetEvent", resetDisplay);

startButton.addEventListener("click", () => {
  startButton.disabled = true;
  socket.emit("startEvent");
});

resetButton.addEventListener("click", () => socket.emit("resetEvent"));

function showCarousel(milestoneIndex) {
  const images = milestoneImages[milestoneIndex];
  if (!images || images.length === 0) {
    hideCarousel();
    socket.emit("milestoneDisplayComplete");
    return;
  }
  carouselSlides.innerHTML = "";
  images.forEach((imgPath, idx) => {
    const slideDiv = document.createElement("div");
    slideDiv.className = `carousel-slide ${idx === 0 ? "active" : ""}`;
    slideDiv.innerHTML = `<img src="${imgPath}" alt="Milestone Image ${
      idx + 1
    }">`;
    carouselSlides.appendChild(slideDiv);
  });
  carouselTitle.textContent = milestoneHeadings[milestoneIndex];
  carouselOverlay.classList.add("active");
  closeCarouselButton.style.display = "flex";
  currentCarouselSlideIndex = 0;
  clearInterval(carouselInterval);
  if (images.length > 1) {
    carouselInterval = setInterval(nextSlide, CAROUSEL_SLIDE_DURATION);
  }
}

function nextSlide() {
  const slides = document.querySelectorAll(".carousel-slide");
  if (slides.length < 2) return;
  slides[currentCarouselSlideIndex].classList.remove("active");
  currentCarouselSlideIndex = (currentCarouselSlideIndex + 1) % slides.length;
  slides[currentCarouselSlideIndex].classList.add("active");
}

function hideCarousel() {
  carouselOverlay.classList.remove("active");
  closeCarouselButton.style.display = "none";
  videoContainer.classList.remove("zoomed-out");
  clearInterval(carouselInterval);
}

function displayPostMilestoneButtons(milestoneIdx) {
  if (isEventEnded || isMilestoneDisplaying) {
    postMilestoneControls.classList.remove("active");
    return;
  }
  showMilestoneButton.style.display = milestoneIdx !== -1 ? "block" : "none";
  if (milestoneIdx !== -1) {
    showMilestoneButton.textContent = `Show Milestone ${
      milestoneIdx + 1
    } Again`;
  }
  let nextMilestoneIdx = clientMilestonesReachedStatus.indexOf(false);
  jumpToNextMilestoneButton.style.display =
    nextMilestoneIdx !== -1 ? "block" : "none";
  if (nextMilestoneIdx !== -1) {
    jumpToNextMilestoneButton.textContent = `Jump to Milestone ${
      nextMilestoneIdx + 1
    }`;
  }
  if (
    showMilestoneButton.style.display === "block" ||
    jumpToNextMilestoneButton.style.display === "block"
  ) {
    postMilestoneControls.classList.add("active");
  } else {
    postMilestoneControls.classList.remove("active");
  }
}

closeCarouselButton.addEventListener("click", () => {
  hideCarousel();
  socket.emit("milestoneDisplayComplete");
});

showMilestoneButton.addEventListener("click", () => {
  if (lastTriggeredMilestoneIndex !== -1) {
    showCarousel(lastTriggeredMilestoneIndex);
    postMilestoneControls.classList.remove("active");
  }
});

jumpToNextMilestoneButton.addEventListener("click", () => {
  if (!isMilestoneDisplaying && !isEventEnded) {
    socket.emit("jumpToNextMilestone");
    postMilestoneControls.classList.remove("active");
  }
});

function triggerCelebration() {
  console.log("Triggering final celebration.");
  // Stop all players
  players.forEach((player) => {
    if (player && typeof player.stopVideo === "function") {
      player.stopVideo();
      player.mute();
    }
  });
  // Hide all player containers
  document.querySelectorAll(".player-iframe-wrapper").forEach((div) => {
    div.classList.remove("active");
  });
  activeVideoId = null;

  videoContainer.classList.remove("active", "zoomed-out");
  resetButtonContainer.classList.remove("active");
  postMilestoneControls.classList.remove("active");
  hideCarousel();
  celebrationOverlay.classList.add("active");
  statusText.textContent = "Event Ended!";
  statusDot.className = "status-dot success";
  stopTapTimeout();
}

function resetDisplay() {
  console.log("Resetting display.");
  // Stop and hide all players
  players.forEach((player) => {
    if (player && typeof player.stopVideo === "function") {
      player.stopVideo();
      player.mute();
    }
  });
  // Hide all player containers
  document.querySelectorAll(".player-iframe-wrapper").forEach((div) => {
    div.classList.remove("active");
  });
  activeVideoId = null; // No active video after reset

  isEventStarted = false;
  isEventEnded = false;
  isMilestoneDisplaying = false;
  lastTriggeredMilestoneIndex = -1;
  clientMilestonesReachedStatus.fill(false);
  currentVideoA_Id = null;
  currentVideoB_Id = null;
  lastPickedVideoA_Id = null;
  lastPickedVideoB_Id = null;
  hideCarousel();
  celebrationOverlay.classList.remove("active");
  videoContainer.classList.remove("active", "zoomed-out");
  initialContent.style.display = "flex";
  initialContent.style.opacity = "1";
  startButton.disabled = false;
  resetButtonContainer.classList.remove("active");
  postMilestoneControls.classList.remove("active");
  if (socket.connected) {
    updateStatus(true);
  }
  stopTapTimeout();
}

// Initial Call
updateStatus(socket.connected);
