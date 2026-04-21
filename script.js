import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- 初始化场景、相机、渲染器 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071a3b);
scene.fog = new THREE.FogExp2(0x071a3b, 0.008);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 8, 20);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- 控制器 ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = false;
controls.enableZoom = true;
controls.zoomSpeed = 1.2;
controls.target.set(0, 1, 0);

// --- 灯光 ---
const ambientLight = new THREE.AmbientLight(0x404060);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 10, 7);
dirLight.castShadow = true;
scene.add(dirLight);
const backLight = new THREE.PointLight(0x4466cc, 0.5);
backLight.position.set(-3, 2, -5);
scene.add(backLight);
const gridHelper = new THREE.GridHelper(40, 20, 0x88aaff, 0x335588);
gridHelper.position.y = -2.5;
gridHelper.material.transparent = true;
gridHelper.material.opacity = 0.25;
scene.add(gridHelper);

// --- 全局变量 ---
let birdMesh = null;              // 原始鸟模型
let skyModelGroup = null;        // 目标模型组
let instancedBird = null;        // 实例化鸟群
let birdPositions = [];
let targetPositions = [];
let flockCenterPositions = [];
let birdVelocities = [];
let birdScales = [];
let birdPhases = [];

let currentState = 'fly';        // 'fly' 或 'morph'
let morphProgress = 0;
let morphSpeed = 0.008;
let flyDuration = 0;
let flyTargetDuration = 800;      // 大约13秒 (60fps)

let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let repulsionStrength = 0;
let repulsionPos = new THREE.Vector3();

const BIRD_COUNT = 800;
const FLY_RADIUS = 12;
const REPULSION_DECAY = 0.95;

// 加载状态标志
let birdLoaded = false;
let skyLoaded = false;
let initDone = false;

// --- 辅助函数 ---
function randomRange(min, max) {
    return min + Math.random() * (max - min);
}

// --- 加载模型 ---
const loader = new GLTFLoader();
let loadingDiv = document.getElementById('loading');
if (!loadingDiv) {
    loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading';
    loadingDiv.innerText = '加载模型中，请稍候...';
    loadingDiv.style.position = 'absolute';
    loadingDiv.style.top = '50%';
    loadingDiv.style.left = '50%';
    loadingDiv.style.transform = 'translate(-50%, -50%)';
    loadingDiv.style.color = 'white';
    loadingDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
    loadingDiv.style.padding = '12px 24px';
    loadingDiv.style.borderRadius = '8px';
    loadingDiv.style.zIndex = '100';
    loadingDiv.style.fontFamily = 'sans-serif';
    document.body.appendChild(loadingDiv);
}

function tryInit() {
    if (initDone) return;
    // 两个模型都必须加载成功才能初始化鸟群
    if (birdLoaded && skyLoaded && birdMesh && skyModelGroup) {
        console.log('两个模型加载完成，开始初始化鸟群');
        initBirdInstances();
        computeTargetPositionsFromModel();
        initFlockCentersAndVelocities();
        initDone = true;
        if (loadingDiv) loadingDiv.remove();
        animate();
    } else if (!birdLoaded && !skyLoaded) {
        // 如果长时间未加载，显示警告（可选）
        console.warn('等待模型加载...');
    }
}

// 加载 bird2.glb
loader.load('/public/bird2.glb', (gltf) => {
    birdMesh = gltf.scene;
    // 确保模型接收阴影
    birdMesh.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = false;
        }
    });
    birdLoaded = true;
    console.log('bird2.glb 加载完成');
    tryInit();
}, undefined, (error) => {
    console.error('bird2.glb 加载失败，使用备用几何体（立方体）', error);
    // 创建备用模型：一个简单的立方体，保证程序继续运行
    const geometry = new THREE.BoxGeometry(0.4, 0.2, 0.6);
    const material = new THREE.MeshStandardMaterial({ color: 0xddaa66 });
    birdMesh = new THREE.Mesh(geometry, material);
    birdMesh.castShadow = true;
    birdLoaded = true;
    tryInit();
});

// 加载 sky.glb
loader.load('/public/sky.glb', (gltf) => {
    skyModelGroup = gltf.scene;
    skyModelGroup.position.set(0, 0, 0);
    skyModelGroup.rotation.y = 0;
    skyModelGroup.visible = false; // 只作为位置参考，不显示
    scene.add(skyModelGroup);
    skyLoaded = true;
    console.log('sky.glb 加载完成');
    tryInit();
}, undefined, (error) => {
    console.error('sky.glb 加载失败，将使用球形分布作为汇聚目标', error);
    // 备用：创建一个空组，后续会用球形点填充
    skyModelGroup = new THREE.Group();
    scene.add(skyModelGroup);
    skyLoaded = true;
    tryInit();
});

// --- 初始化 InstancedMesh ---
function initBirdInstances() {
    if (!birdMesh) return;
    let birdGeometry = null;
    // 尝试从 GLTF 中提取第一个网格的几何体
    birdMesh.traverse((child) => {
        if (child.isMesh && !birdGeometry) {
            birdGeometry = child.geometry.clone();
        }
    });
    // 如果没有找到网格（例如备用立方体本身就是Mesh），则直接使用
    if (!birdGeometry && birdMesh.isMesh) {
        birdGeometry = birdMesh.geometry.clone();
    }
    if (!birdGeometry) {
        console.error('无法提取几何体，使用 BoxGeometry 作为备用');
        birdGeometry = new THREE.BoxGeometry(0.4, 0.2, 0.6);
    }
    
    const material = new THREE.MeshStandardMaterial({
        color: 0xddaa66,
        emissive: 0x442200,
        roughness: 0.4,
        metalness: 0.7
    });
    
    instancedBird = new THREE.InstancedMesh(birdGeometry, material, BIRD_COUNT);
    instancedBird.castShadow = true;
    instancedBird.receiveShadow = false;
    scene.add(instancedBird);
    
    const dummyMatrix = new THREE.Matrix4();
    const dummyPosition = new THREE.Vector3();
    const dummyScale = new THREE.Vector3();
    const dummyQuaternion = new THREE.Quaternion();
    
    for (let i = 0; i < BIRD_COUNT; i++) {
        // 随机初始位置
        const angle1 = Math.random() * Math.PI * 2;
        const angle2 = Math.random() * Math.PI * 2;
        const r = Math.cbrt(Math.random()) * FLY_RADIUS;
        const x = Math.sin(angle1) * r;
        const z = Math.cos(angle1) * r;
        const y = Math.sin(angle2) * r * 0.8 + 1;
        dummyPosition.set(x, y, z);
        
        const scaleVal = randomRange(0.6, 1.4);
        dummyScale.set(scaleVal, scaleVal, scaleVal);
        
        dummyQuaternion.setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI));
        dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
        instancedBird.setMatrixAt(i, dummyMatrix);
        
        birdPositions.push(dummyPosition.clone());
        birdScales.push(scaleVal);
        birdPhases.push(Math.random() * Math.PI * 2);
        birdVelocities.push(new THREE.Vector3(
            randomRange(-0.08, 0.08),
            randomRange(-0.05, 0.05),
            randomRange(-0.08, 0.08)
        ));
    }
    instancedBird.instanceMatrix.needsUpdate = true;
}

// --- 从 sky.glb 计算汇聚目标点 ---
function computeTargetPositionsFromModel() {
    const vertices = [];
    if (skyModelGroup && skyModelGroup.children.length > 0) {
        skyModelGroup.traverse((child) => {
            if (child.isMesh) {
                const geometry = child.geometry;
                if (geometry.attributes.position) {
                    const posAttr = geometry.attributes.position.array;
                    for (let i = 0; i < posAttr.length; i += 3) {
                        const localVec = new THREE.Vector3(posAttr[i], posAttr[i+1], posAttr[i+2]);
                        const worldVec = child.localToWorld(localVec);
                        vertices.push(worldVec.clone());
                    }
                }
            }
        });
    }
    
    if (vertices.length === 0) {
        console.warn('sky.glb 无有效顶点或未加载，使用球形分布作为汇聚目标');
        for (let i = 0; i < BIRD_COUNT; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 3.5;
            const x = Math.sin(phi) * Math.cos(theta) * r;
            const y = Math.sin(phi) * Math.sin(theta) * r + 1.5;
            const z = Math.cos(phi) * r;
            targetPositions.push(new THREE.Vector3(x, y, z));
        }
        return;
    }
    
    for (let i = 0; i < BIRD_COUNT; i++) {
        const randomVertex = vertices[Math.floor(Math.random() * vertices.length)];
        const offset = new THREE.Vector3(
            randomRange(-0.25, 0.25),
            randomRange(-0.25, 0.25),
            randomRange(-0.25, 0.25)
        );
        targetPositions.push(randomVertex.clone().add(offset));
    }
    console.log(`已生成 ${targetPositions.length} 个汇聚目标点`);
}

// --- 初始化飞翔中心与速度 ---
function initFlockCentersAndVelocities() {
    for (let i = 0; i < BIRD_COUNT; i++) {
        const center = new THREE.Vector3(
            randomRange(-FLY_RADIUS * 0.7, FLY_RADIUS * 0.7),
            randomRange(-1, 4),
            randomRange(-FLY_RADIUS * 0.7, FLY_RADIUS * 0.7)
        );
        flockCenterPositions.push(center);
        // 速度已经在 initBirdInstances 中赋值，这里可以微调
        birdVelocities[i].set(
            randomRange(-0.12, 0.12),
            randomRange(-0.08, 0.08),
            randomRange(-0.12, 0.12)
        );
    }
}

// --- 飞翔状态更新（群聚 + 鼠标驱散）---
function updateFlocking(deltaTime) {
    const speedFactor = deltaTime * 30;
    for (let i = 0; i < BIRD_COUNT; i++) {
        let pos = birdPositions[i];
        let vel = birdVelocities[i];
        
        const center = flockCenterPositions[i];
        const toCenter = new THREE.Vector3().subVectors(center, pos);
        vel.x += toCenter.x * 0.008 * speedFactor;
        vel.y += toCenter.y * 0.006 * speedFactor;
        vel.z += toCenter.z * 0.008 * speedFactor;
        
        vel.x += (Math.random() - 0.5) * 0.03 * speedFactor;
        vel.y += (Math.random() - 0.5) * 0.02 * speedFactor;
        vel.z += (Math.random() - 0.5) * 0.03 * speedFactor;
        
        if (repulsionStrength > 0.01) {
            const dx = pos.x - repulsionPos.x;
            const dy = pos.y - repulsionPos.y;
            const dz = pos.z - repulsionPos.z;
            const distSq = dx*dx + dy*dy + dz*dz;
            const radius = 3.5;
            if (distSq < radius * radius) {
                const dist = Math.sqrt(distSq);
                const force = (1 - dist / radius) * repulsionStrength * 0.5;
                const normX = dx / (dist + 0.001);
                const normY = dy / (dist + 0.001);
                const normZ = dz / (dist + 0.001);
                vel.x += normX * force * speedFactor;
                vel.y += normY * force * speedFactor;
                vel.z += normZ * force * speedFactor;
            }
        }
        
        const maxSpeed = 0.45;
        if (vel.length() > maxSpeed) vel.multiplyScalar(maxSpeed / vel.length());
        
        pos.x += vel.x * speedFactor;
        pos.y += vel.y * speedFactor;
        pos.z += vel.z * speedFactor;
        
        const bound = FLY_RADIUS + 1.5;
        if (Math.abs(pos.x) > bound) vel.x *= -0.5;
        if (Math.abs(pos.z) > bound) vel.z *= -0.5;
        if (pos.y > 5.5) vel.y = -Math.abs(vel.y);
        if (pos.y < -2) vel.y = Math.abs(vel.y);
        
        birdPositions[i] = pos;
        birdVelocities[i] = vel;
    }
    repulsionStrength *= REPULSION_DECAY;
}

// --- 更新所有实例的矩阵（位置、旋转、缩放）---
function updateInstanceMatrices() {
    if (!instancedBird) return;
    const dummyMatrix = new THREE.Matrix4();
    const dummyPos = new THREE.Vector3();
    const dummyScale = new THREE.Vector3();
    const dummyQuat = new THREE.Quaternion();
    
    for (let i = 0; i < BIRD_COUNT; i++) {
        let currentPos;
        if (currentState === 'fly') {
            currentPos = birdPositions[i];
        } else {
            const flyPos = birdPositions[i];
            const targetPos = targetPositions[i];
            currentPos = new THREE.Vector3().lerpVectors(flyPos, targetPos, morphProgress);
        }
        
        const scaleVal = birdScales[i];
        dummyScale.set(scaleVal, scaleVal, scaleVal);
        
        // 计算方向（飞翔时用速度方向，汇聚时用指向目标的方向）
        let direction;
        if (currentState === 'fly') {
            direction = birdVelocities[i].clone().normalize();
            if (direction.length() < 0.01) direction.set(0, 0, 1);
        } else {
            const toTarget = new THREE.Vector3().subVectors(targetPositions[i], birdPositions[i]);
            direction = toTarget.clone().normalize();
            if (direction.length() < 0.01) direction.set(0, 0, 1);
        }
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            direction
        );
        
        dummyMatrix.compose(currentPos, quaternion, dummyScale);
        instancedBird.setMatrixAt(i, dummyMatrix);
    }
    instancedBird.instanceMatrix.needsUpdate = true;
}

// --- 鼠标交互：射线检测并触发驱散 ---
function onMouseMove(event) {
    if (!instancedBird) return;
    mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    let closestDist = Infinity;
    let closestPos = null;
    
    for (let i = 0; i < BIRD_COUNT; i++) {
        const pos = (currentState === 'fly') ? birdPositions[i] : 
                    (morphProgress < 0.99 ? birdPositions[i] : targetPositions[i]);
        const toBird = new THREE.Vector3().subVectors(pos, camera.position).normalize();
        if (cameraDirection.dot(toBird) < 0.3) continue;
        const screenPos = pos.clone().project(camera);
        if (screenPos.x < -0.2 || screenPos.x > 1.2 || screenPos.y < -0.2 || screenPos.y > 1.2) continue;
        const distToRay = raycaster.ray.distanceToPoint(pos);
        if (distToRay < 1.2 && distToRay < closestDist) {
            closestDist = distToRay;
            closestPos = pos.clone();
        }
    }
    if (closestPos) {
        repulsionStrength = 0.85;
        repulsionPos.copy(closestPos);
    }
}

// --- 状态控制（飞翔计时 -> 汇聚）---
function updateState() {
    const statusDiv = document.getElementById('status');
    if (currentState === 'fly') {
        flyDuration++;
        if (statusDiv && flyDuration % 60 === 0) {
            const remain = Math.max(0, Math.ceil((flyTargetDuration - flyDuration) / 60));
            statusDiv.innerHTML = `状态: 自由飞翔中... (${remain}s 后汇聚)`;
        }
        if (flyDuration >= flyTargetDuration) {
            currentState = 'morph';
            morphProgress = 0;
            if (statusDiv) statusDiv.innerHTML = `状态: 汇聚成目标模型...`;
            console.log('开始汇聚');
        }
    } else if (currentState === 'morph') {
        if (morphProgress < 1) {
            morphProgress += morphSpeed;
            if (morphProgress >= 1) {
                morphProgress = 1;
                if (statusDiv) statusDiv.innerHTML = `状态: 汇聚完成 | 鼠标仍可交互驱散`;
            }
        }
    }
}

// --- 动画循环 ---
let lastTime = performance.now();
let time = 0;

function animate() {
    if (!initDone) return; // 未初始化完成，不执行动画
    
    const now = performance.now();
    let delta = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    
    updateState();
    
    if (currentState === 'fly') {
        updateFlocking(delta);
    } else if (currentState === 'morph' && morphProgress < 1) {
        // 汇聚过程中让速度逐渐衰减
        for (let i = 0; i < BIRD_COUNT; i++) {
            birdVelocities[i].multiplyScalar(0.98);
        }
    }
    
    updateInstanceMatrices();
    
    // 动态环境光效
    time += 0.008;
    const lightIntensity = 0.6 + Math.sin(time) * 0.2;
    dirLight.intensity = lightIntensity;
    
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

// --- 事件监听 ---
window.addEventListener('mousemove', onMouseMove, false);
window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}