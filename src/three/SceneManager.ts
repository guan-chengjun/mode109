import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SCENE } from '../config/constants';

/**
 * 场景与渲染管理
 * 封装 WebGLRenderer、透视相机、OrbitControls（左键旋转/滚轮缩放/右键平移）、
 * 日光方向光阴影、环境光、半球光、雾效与渐变天空背景，以及窗口自适应。
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  sun!: THREE.DirectionalLight;

  private container: HTMLElement;
  private onResize = () => this.handleResize();

  constructor(container: HTMLElement) {
    this.container = container;

    // 渲染器：抗锯齿 + 软阴影，色调映射让 PBR 材质更通透
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SCENE.FOG_COLOR, SCENE.FOG_NEAR, SCENE.FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.5,
      1200,
    );
    // 斜俯视角，可通览全城
    this.camera.position.set(150, 130, 170);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.48; // 禁止翻到地面以下
    this.controls.minDistance = 25;
    this.controls.maxDistance = 520;
    this.controls.target.set(0, 0, 0);
    // 鼠标按键映射：左键旋转、滚轮缩放、右键平移
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.setupLights();
    this.setupSky();

    window.addEventListener('resize', this.onResize);
  }

  /** 环境光 + 半球光补暗部，方向光模拟太阳并投射阴影 */
  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xdcecff, 0x9aa68f, 0.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(-140, 190, 90);
    sun.castShadow = true;
    // 阴影覆盖整个城区（4×4 路口约 270 跨度，留余量）
    const shadowSpan = 200;
    sun.shadow.camera.left = -shadowSpan;
    sun.shadow.camera.right = shadowSpan;
    sun.shadow.camera.top = shadowSpan;
    sun.shadow.camera.bottom = -shadowSpan;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 520;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  /** 大球体背面渐变贴图模拟天空，配合雾效营造清爽日间氛围 */
  private setupSky(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${new THREE.Color(SCENE.SKY_TOP).getHexString()}`);
    grad.addColorStop(1, `#${new THREE.Color(SCENE.SKY_BOTTOM).getHexString()}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.scene.add(sky);
  }

  /** 帧渲染（控制器阻尼需每帧 update） */
  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
