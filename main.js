const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('canvas');
const canvasCtx = canvasElement.getContext('2d');

let scene, camera, renderer, cube, cornerMarkers = [], draggingCornerIndex = -1, isPinching = false;
let previousLeftFistX = null;
let previousLeftFistY = null;
let isLeftFist = false;
let activeColor = '#ff00ff';
let pinchThreshold = 0.045;

let ambientLight, directionalLight, pointLight, gridFloor;
let hoveredMarkerIndex = -1;
let previousPinchScaleY = null;
let wasRightPalmOpen = false;
let colorPresetIndex = 0;
const colorPresets = ['#ff00ff', '#52e0e8', '#ffea00', '#3dff9a', '#ff5252', '#b56cff'];

let frameCount = 0;
let lastFpsTime = performance.now();
let firstResultReceived = false;

// Standard MediaPipe hand landmark connections (skeleton)
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 4;

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('three-canvas').appendChild(renderer.domElement);

  // Lighting rig so the shape actually shades and glows instead of flat color
  ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);

  directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
  directionalLight.position.set(3, 5, 5);
  scene.add(directionalLight);

  pointLight = new THREE.PointLight(new THREE.Color(activeColor), 1.6, 12);
  pointLight.position.set(0, 0, 3);
  scene.add(pointLight);

  // Faint grid floor for depth, purely decorative
  gridFloor = new THREE.GridHelper(24, 48, 0x52e0e8, 0x1c2c3a);
  gridFloor.position.y = -3;
  gridFloor.material.transparent = true;
  gridFloor.material.opacity = 0.3;
  scene.add(gridFloor);

  createCube();
  animate();
}

function createCube() {
  if (cube) scene.remove(cube);
  scene.children = scene.children.filter(child => child.name !== 'filledCube');

  const color = new THREE.Color(activeColor);
  if (pointLight) pointLight.color.set(color);
  updateColorReadout();

  if (cornerMarkers.length > 0) {
    const vertices = new Float32Array(cornerMarkers.map(m => m.position).flatMap(v => [v.x, v.y, v.z]));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex([
      0, 1, 3, 0, 3, 2,
      1, 5, 7, 1, 7, 3,
      5, 4, 6, 5, 6, 7,
      4, 0, 2, 4, 2, 6,
      2, 3, 7, 2, 7, 6,
      4, 5, 1, 4, 1, 0
    ]);
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      color: color,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      metalness: 0.2,
      roughness: 0.2,
      emissive: color,
      emissiveIntensity: 0.35,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25
    });

    const filledCube = new THREE.Mesh(geometry, material);
    filledCube.name = 'filledCube';
    scene.add(filledCube);

    const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 });
    cube = new THREE.Mesh(geometry, wireMaterial);
    scene.add(cube);
  } else {
    const cubeSize = 2;
    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

    const material = new THREE.MeshPhysicalMaterial({
      color: color,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      metalness: 0.2,
      roughness: 0.2,
      emissive: color,
      emissiveIntensity: 0.35,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25
    });

    const filledCube = new THREE.Mesh(geometry, material);
    filledCube.name = 'filledCube';
    scene.add(filledCube);

    const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 });
    cube = new THREE.Mesh(geometry, wireMaterial);
    scene.add(cube);

    const half = cubeSize / 2;
    const corners = [
      [-half, -half, -half], [ half, -half, -half],
      [-half,  half, -half], [ half,  half, -half],
      [-half, -half,  half], [ half, -half,  half],
      [-half,  half,  half], [ half,  half,  half],
    ];

    // Clear old markers if any leftover
    cornerMarkers.forEach(m => scene.remove(m));
    cornerMarkers = [];

    const markerGeo = new THREE.SphereGeometry(0.12, 16, 16);
    corners.forEach(([x, y, z]) => {
      const markerMat = new THREE.MeshStandardMaterial({
        color: 0xfffed6,
        emissive: 0xfffed6,
        emissiveIntensity: 0.5
      });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(x, y, z);
      marker.userData.originalColor = 0xfffed6;
      scene.add(marker);
      cornerMarkers.push(marker);
    });
  }
}

function drawColorPickerWheel() {
    const canvas = document.getElementById('color-picker-canvas');
    const ctx = canvas.getContext('2d');
    const radius = canvas.width / 2;
    const toRad = Math.PI / 180;

    for (let angle = 0; angle < 360; angle++) {
        ctx.beginPath();
        ctx.moveTo(radius, radius);
        ctx.arc(radius, radius, radius, angle * toRad, (angle + 1) * toRad);
        ctx.closePath();
        ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
        ctx.fill();
    }
}

function updateColorReadout() {
  const swatch = document.getElementById('color-swatch');
  const hexLabel = document.getElementById('color-hex');
  if (swatch) {
    swatch.style.background = activeColor;
    swatch.style.color = activeColor;
  }
  if (hexLabel) hexLabel.textContent = activeColor.toUpperCase();
}

function updateHud({ leftDetected, rightDetected }) {
  const leftEl = document.getElementById('hud-left');
  const rightEl = document.getElementById('hud-right');
  if (leftEl) {
    leftEl.textContent = leftDetected ? (isLeftFist ? 'fist' : 'open') : 'none';
    leftEl.classList.toggle('active', !!leftDetected);
  }
  if (rightEl) {
    rightEl.textContent = rightDetected ? (isPinching ? 'pinch' : 'open') : 'none';
    rightEl.classList.toggle('active', !!rightDetected);
  }
}

function updateFps() {
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
    const fpsEl = document.getElementById('hud-fps');
    if (fpsEl) fpsEl.textContent = fps;
    frameCount = 0;
    lastFpsTime = now;
  }
}

function animate() {
  requestAnimationFrame(animate);

  // Gentle ambient life in the floor grid and light, independent of hands
  const t = performance.now() * 0.0004;
  if (gridFloor) gridFloor.rotation.y = t * 0.15;
  if (pointLight) pointLight.intensity = 1.4 + Math.sin(t * 3) * 0.2;

  // Pulse whichever corner marker is currently hovered/dragged
  cornerMarkers.forEach((marker, i) => {
    if (i === hoveredMarkerIndex) {
      const scale = 1 + 0.18 * Math.sin(performance.now() * 0.012);
      marker.scale.setScalar(scale);
    } else {
      marker.scale.setScalar(1);
    }
  });

  updateFps();
  renderer.render(scene, camera);
}

function updateCanvasSize() {
  canvasElement.width = window.innerWidth;
  canvasElement.height = window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function isHoveringColorControl(x, y) {
  const rect = document.getElementById('color-control').getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function detectDrag(handLandmarks) {
  const indexTip = handLandmarks[8];
  const thumbTip = handLandmarks[4];

  const screenX = (1 - indexTip.x) * window.innerWidth;
  const screenY = indexTip.y * window.innerHeight;

  const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
  const isCurrentlyPinching = pinchDist < pinchThreshold;

  const colorCanvas = document.getElementById('color-picker-canvas');
  const colorRect = colorCanvas.getBoundingClientRect();
  const inColorPicker = screenX >= colorRect.left && screenX <= colorRect.right &&
                      screenY >= colorRect.top && screenY <= colorRect.bottom;

  if (inColorPicker && isCurrentlyPinching) {
    const localX = screenX - colorRect.left;
    const localY = screenY - colorRect.top;
    const ctx = colorCanvas.getContext('2d');
    const pixel = ctx.getImageData(localX, localY, 1, 1).data;
    const hex = `#${[pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    activeColor = hex;
    createCube();
  }

  let hoveringIndex = -1;
  for (let i = 0; i < cornerMarkers.length; i++) {
    const marker = cornerMarkers[i];
    const projected = marker.position.clone().project(camera);
    const markerX = (projected.x + 1) / 2 * window.innerWidth;
    const markerY = (1 - projected.y) / 2 * window.innerHeight;
    const dist = Math.hypot(screenX - markerX, screenY - markerY);
    if (dist < 40) {
      hoveringIndex = i;
      marker.material.color.set(0xff9700);
      marker.material.emissive.set(0xff9700);
    } else {
      marker.material.color.set(marker.userData.originalColor);
      marker.material.emissive.set(marker.userData.originalColor);
    }
  }
  hoveredMarkerIndex = hoveringIndex;

  if (draggingCornerIndex === -1 && isCurrentlyPinching && hoveringIndex !== -1) {
    draggingCornerIndex = hoveringIndex;
  }

  if (draggingCornerIndex !== -1 && isCurrentlyPinching) {
    const marker = cornerMarkers[draggingCornerIndex];
    const projected = marker.position.clone().project(camera);
    const originalZ = projected.z;

    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;

    const newPosition = new THREE.Vector3(ndcX, ndcY, originalZ).unproject(camera);
    marker.position.copy(newPosition);
    createCube();
  }

  if (!isCurrentlyPinching && isPinching) {
    draggingCornerIndex = -1;
  }

  // Pinch-and-move-vertically anywhere else on the shape = uniform scale
  const scaleModeActive = isCurrentlyPinching && hoveringIndex === -1 &&
    draggingCornerIndex === -1 && !inColorPicker && cornerMarkers.length > 0;

  if (scaleModeActive) {
    if (previousPinchScaleY !== null) {
      const deltaY = previousPinchScaleY - screenY; // moving hand up => positive
      const scaleFactor = 1 + deltaY * 0.002;
      const currentExtent = cornerMarkers[0].position.length();
      const newExtent = currentExtent * scaleFactor;
      if (newExtent > 0.5 && newExtent < 6) {
        cornerMarkers.forEach(m => m.position.multiplyScalar(scaleFactor));
        createCube();
      }
    }
    previousPinchScaleY = screenY;
  } else {
    previousPinchScaleY = null;
  }

  isPinching = isCurrentlyPinching;
}

function isFist(landmarks) {
  const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
  return fingers.every(([tip, pip]) => landmarks[tip].y > landmarks[pip].y);
}

function isOpenPalm(landmarks) {
  const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
  return fingers.every(([tip, pip]) => landmarks[tip].y < landmarks[pip].y - 0.02);
}

function drawLandmarks(hands) {
  hands.forEach(landmarks => {
    // Skeleton connections first, glowing lines underneath the joints
    canvasCtx.save();
    canvasCtx.strokeStyle = 'rgba(82, 224, 232, 0.7)';
    canvasCtx.lineWidth = 2;
    canvasCtx.shadowColor = '#52e0e8';
    canvasCtx.shadowBlur = 6;
    HAND_CONNECTIONS.forEach(([a, b]) => {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
      canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
      canvasCtx.stroke();
    });
    canvasCtx.restore();

    for (const landmark of landmarks) {
      const x = landmark.x * canvasElement.width;
      const y = landmark.y * canvasElement.height;
      const gradient = canvasCtx.createRadialGradient(x, y, 0, x, y, 6);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#52e0e8');
      canvasCtx.beginPath();
      canvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
      canvasCtx.fillStyle = gradient;
      canvasCtx.fill();
    }
  });
}

async function initWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
  videoElement.srcObject = stream;
  return new Promise(resolve => videoElement.onloadedmetadata = () => resolve());
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('hidden');
}

async function main() {
  await initWebcam();
  initThree();
  updateCanvasSize();
  window.addEventListener('resize', updateCanvasSize);
  drawColorPickerWheel();
  updateColorReadout();

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5
  });

  hands.onResults((results) => {
    if (!firstResultReceived) {
      firstResultReceived = true;
      hideLoadingOverlay();
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    const handsLandmarks = results.multiHandLandmarks;
    if (!handsLandmarks || handsLandmarks.length === 0) {
      draggingCornerIndex = -1;
      hoveredMarkerIndex = -1;
      previousLeftFistX = null;
      previousPinchScaleY = null;
      wasRightPalmOpen = false;
      cornerMarkers.forEach(marker => {
        marker.material.color.set(marker.userData.originalColor);
        marker.material.emissive.set(marker.userData.originalColor);
      });
      updateHud({ leftDetected: false, rightDetected: false });
      return;
    }

    drawLandmarks(handsLandmarks);

    let rightHand = null, leftHand = null;
    if (results.multiHandedness.length === 2) {
      results.multiHandedness.forEach((handedness, i) => {
        if (handedness.label === 'Right') leftHand = handsLandmarks[i];
        else rightHand = handsLandmarks[i];
      });
    } else if (results.multiHandedness.length === 1) {
      if (results.multiHandedness[0].label === 'Right') leftHand = handsLandmarks[0];
      else rightHand = handsLandmarks[0];
    }

    if (rightHand) {
      detectDrag(rightHand);

      const rightPalmOpen = isOpenPalm(rightHand);
      if (rightPalmOpen && !wasRightPalmOpen) {
        colorPresetIndex = (colorPresetIndex + 1) % colorPresets.length;
        activeColor = colorPresets[colorPresetIndex];
        createCube();
      }
      wasRightPalmOpen = rightPalmOpen;
    } else {
      draggingCornerIndex = -1;
      hoveredMarkerIndex = -1;
      previousPinchScaleY = null;
      wasRightPalmOpen = false;
      cornerMarkers.forEach(marker => {
        marker.material.color.set(marker.userData.originalColor);
        marker.material.emissive.set(marker.userData.originalColor);
      });
    }

    if (leftHand && isFist(leftHand)) {
      isLeftFist = true;
      const x = (1 - leftHand[9].x) * window.innerWidth;
      const y = leftHand[9].y * window.innerHeight;

      if (previousLeftFistX !== null && previousLeftFistY !== null) {
        const deltaX = x - previousLeftFistX;
        const deltaY = y - previousLeftFistY;

        const radius = camera.position.length();
        const theta = Math.atan2(camera.position.x, camera.position.z) + deltaX * -0.005;
        const phi = Math.atan2(camera.position.y, Math.sqrt(camera.position.x ** 2 + camera.position.z ** 2)) - deltaY * -0.005;
        const clampedPhi = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, phi));

        camera.position.x = radius * Math.sin(theta) * Math.cos(clampedPhi);
        camera.position.z = radius * Math.cos(theta) * Math.cos(clampedPhi);
        camera.position.y = radius * Math.sin(clampedPhi);
        camera.lookAt(0, 0, 0);
      }

      previousLeftFistX = x;
      previousLeftFistY = y;
    } else {
      isLeftFist = false;
      previousLeftFistX = null;
      previousLeftFistY = null;
    }

    updateHud({ leftDetected: !!leftHand, rightDetected: !!rightHand });
  });

  const cam = new Camera(videoElement, {
    onFrame: async () => await hands.send({ image: videoElement }),
    width: 1280,
    height: 960,
  });
  cam.start();
}

main();
