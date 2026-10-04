// 360° spins: taking small pictures from the live camera, and a "player"
// that flips through them as a finger drags sideways, so the model seems
// to turn. (This is a flip-book of photos, not a 3D model.)

const SPIN_LONG_EDGE = 720; // pixels on the longest side of each picture
const SPIN_QUALITY = 0.75; // JPEG quality, 0 to 1
const SPIN_MIN_FRAMES = 3;
const SPIN_PLAY_MS = 90; // time per picture when the spin plays by itself

// ---------- Taking pictures ----------
// One canvas is reused for every picture, because iPhones limit the total
// memory all canvases may use.

const frameCanvas = document.createElement('canvas');

// Copy what the camera shows right now into a small JPEG.
// Gives null if the camera has no picture yet.
function grabFrame(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    return Promise.resolve(null);
  }
  const scale = Math.min(1, SPIN_LONG_EDGE / Math.max(w, h));
  frameCanvas.width = Math.round(w * scale);
  frameCanvas.height = Math.round(h * scale);
  frameCanvas.getContext('2d').drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
  return new Promise((resolve, reject) => {
    frameCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('The picture could not be saved.'));
      }
    }, 'image/jpeg', SPIN_QUALITY);
  });
}

// Free the canvas memory when no more pictures are being taken.
function freeFrameCanvas() {
  frameCanvas.width = 0;
  frameCanvas.height = 0;
}

// ---------- The player ----------
// All pictures are unpacked ("decoded") into memory first, so dragging is
// smooth. That is why spin pictures are kept smaller than progress photos.

function decodeFrame(blob) {
  if (window.createImageBitmap) {
    return createImageBitmap(blob);
  }
  return loadImage(blob);
}

function freeFrame(frame) {
  if (frame.close) {
    frame.close();
  }
}

// area: the part of the screen that reacts to dragging.
// canvas: where the current picture is drawn.
// playButton (optional): starts and stops the spin playing by itself.
function createSpinPlayer(area, canvas, playButton) {
  const context = canvas.getContext('2d');
  const player = {
    frames: [],
    length: 0, // pictures in use (fewer than frames when the end is trimmed)
    index: 0,
    reverse: false,
  };
  let loadNumber = 0;
  let playTimer = null;
  let drag = null;

  player.show = (index) => {
    if (!player.length) {
      return;
    }
    player.index = ((index % player.length) + player.length) % player.length;
    context.drawImage(player.frames[player.index], 0, 0, canvas.width, canvas.height);
  };

  // Unpack the pictures, reporting progress. Gives false if the player was
  // cleared or given other pictures before it finished.
  player.load = async (blobs, onProgress) => {
    player.clear();
    const myLoad = loadNumber;
    const frames = [];
    try {
      for (const [i, blob] of blobs.entries()) {
        const frame = await decodeFrame(blob);
        if (myLoad !== loadNumber) {
          freeFrame(frame);
          frames.forEach(freeFrame);
          return false;
        }
        frames.push(frame);
        if (onProgress) {
          onProgress(i + 1, blobs.length);
        }
      }
    } catch (err) {
      frames.forEach(freeFrame);
      throw err;
    }
    player.frames = frames;
    player.length = frames.length;
    canvas.width = frames[0].width;
    canvas.height = frames[0].height;
    player.show(0);
    drawPlayButton();
    return true;
  };

  // Use only the first `length` pictures (to trim extra ones at the end).
  player.setLength = (length) => {
    player.length = Math.max(1, Math.min(length, player.frames.length));
    player.show(player.index);
  };

  player.play = () => {
    if (playTimer || player.length < 2) {
      return;
    }
    playTimer = setInterval(() => player.show(player.index + (player.reverse ? -1 : 1)), SPIN_PLAY_MS);
    drawPlayButton();
  };

  player.stop = () => {
    clearInterval(playTimer);
    playTimer = null;
    drawPlayButton();
  };

  // Stop and free the memory the pictures use.
  player.clear = () => {
    loadNumber++;
    player.stop();
    player.frames.forEach(freeFrame);
    player.frames = [];
    player.length = 0;
    player.index = 0;
    canvas.width = 0;
    canvas.height = 0;
  };

  function drawPlayButton() {
    if (playButton) {
      playButton.textContent = playTimer ? '❚❚ Pause' : '▶ Spin';
      setInactive(playButton, player.length < 2);
    }
  }

  if (playButton) {
    playButton.addEventListener('click', () => {
      if (playTimer) {
        player.stop();
      } else {
        player.play();
      }
    });
  }

  // Dragging across the whole width turns the model once around.
  area.addEventListener('pointerdown', (event) => {
    if (!player.length) {
      return;
    }
    player.stop();
    drag = { x: event.clientX, index: player.index };
    try {
      area.setPointerCapture(event.pointerId); // keep following the finger outside the picture
    } catch (err) {
      // Dragging still works inside the picture.
    }
  });

  area.addEventListener('pointermove', (event) => {
    if (!drag) {
      return;
    }
    const step = area.clientWidth / player.length;
    const moved = Math.round((event.clientX - drag.x) / step);
    player.show(drag.index + (player.reverse ? -moved : moved));
  });

  const endDrag = () => {
    drag = null;
  };
  area.addEventListener('pointerup', endDrag);
  area.addEventListener('pointercancel', endDrag);

  drawPlayButton();
  return player;
}
