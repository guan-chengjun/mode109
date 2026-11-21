import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { REMOTE_MODELS } from '../config/constants';

export type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * 远程车辆模型管理
 * - 通过 GLTFLoader 异步加载免费可商用的 GLB
 * - 带超时控制；任何失败都返回 null，由调用方自动降级为程序化几何
 * - 加载完成后做朝向修正与尺寸归一化，克隆即可上路
 */
export class ModelManager {
  status: ModelLoadStatus = 'idle';
  /** 归一化后的模板（车头 +Z、车顶 +Y、车底 y=0、长度约 4.4） */
  private template: THREE.Group | null = null;
  /** 归一化后的原始包围尺寸 */
  private size = new THREE.Vector3();

  /**
   * Ferrari GLB（FBX Z-up 烘焙）的基础朝向修正四元数 (0.5,0.5,-0.5,-0.5)
   * 作用是把车顶校正到世界 +Y；车长对齐与车头朝向由 normalize() 基于
   * 实测包围盒和灯节点自适应完成，不依赖单一四元数的理论推导。
   */
  private static readonly FERRARI_FIX_QUAT = new THREE.Quaternion(0.5, 0.5, -0.5, -0.5);
  /** 归一化目标车长（米），与程序化轿车一致 */
  private static readonly TARGET_LENGTH = 4.4;

  /**
   * 创建 GLTF 加载器并挂载 DRACO 解码器
   * Ferrari.glb 使用 DRACO 网格压缩，解码器（wasm/js）从同版本 CDN 加载；
   * 解码器不可用时 load() 会 reject，由 loadCar 的 catch 统一降级。
   */
  private createLoader(): GLTFLoader {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    // 固定 three 版本号，保证解码器与 GLTFLoader 版本匹配；jsDelivr 提供 CORS
    draco.setDecoderPath(
      'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/',
    );
    loader.setDRACOLoader(draco);
    return loader;
  }

  async loadCar(onStatus?: (text: string) => void): Promise<boolean> {
    if (this.status === 'loading' || this.status === 'loaded') return this.status === 'loaded';
    this.status = 'loading';
    onStatus?.('正在加载远程车辆模型 (GLB)…');

    const loader = this.createLoader();
    const fetchWithTimeout = new Promise<THREE.Group>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('GLB 加载超时')),
        REMOTE_MODELS.TIMEOUT_MS,
      );
      loader.load(
        REMOTE_MODELS.CAR,
        (gltf) => {
          clearTimeout(timer);
          resolve(gltf.scene);
        },
        undefined,
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });

    try {
      const raw = await fetchWithTimeout;
      this.template = this.normalize(raw);
      this.status = 'loaded';
      onStatus?.('远程车辆模型加载完成');
      return true;
    } catch (err) {
      // 容错：网络异常、超时、解析失败一律降级，不阻塞场景启动
      console.warn('[ModelManager] 远程 GLB 加载失败，改用程序化车辆：', err);
      this.template = null;
      this.status = 'failed';
      onStatus?.('远程模型加载失败，已切换为程序化车辆');
      return false;
    }
  }

  /**
   * 朝向修正 + 尺寸归一化 + 接地
   * 该 GLB 为 FBX Z-up 烘焙，轴序混乱且无规律可依赖，因此不做理论推导，
   * 完全基于实测几何：
   * 1) 用四个车轮节点（wheel_fl/fr/rl/rr）的世界坐标测量车长方向与车顶方向，
   *    构造旋转把 车头->+Z、车顶->+Y、车右->+X；
   * 2) 找不到轮节点时退化为包围盒 + 固定四元数的启发式修正；
   * 3) 按 Z 向实测长度等比缩放，再平移到车底接地、中心归零。
   */
  private normalize(raw: THREE.Group): THREE.Group {
    const holder = new THREE.Group();
    holder.add(raw);
    holder.updateMatrixWorld(true);

    const measured = this.measureCorrectionByWheels(raw);
    if (measured) {
      // 实测成功：直接替换为完整校正姿态（该四元数已包含原始旋转的逆映射）
      raw.quaternion.copy(measured);
    } else {
      // 启发式兜底：先校正车顶，再把长轴绕 Y 转到 +Z
      raw.quaternion.premultiply(ModelManager.FERRARI_FIX_QUAT);
      raw.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      new THREE.Box3().setFromObject(raw).getSize(s);
      if (s.x > s.z) {
        raw.quaternion.premultiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
        );
      }
    }

    // 阴影开关
    holder.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    // 此时车长必然沿 Z，按 Z 向尺寸等比缩放到目标车长
    raw.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(raw);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = ModelManager.TARGET_LENGTH / size.z;
    raw.scale.multiplyScalar(scale);

    // 重新计算包围盒并平移到：车底 y=0、中心 x/z=0
    raw.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(raw);
    const size2 = new THREE.Vector3();
    box2.getSize(size2);
    this.size.copy(size2);
    const center2 = new THREE.Vector3();
    box2.getCenter(center2);
    raw.position.x -= center2.x;
    raw.position.z -= center2.z;
    raw.position.y -= box2.min.y;

    return holder;
  }

  /**
   * 四轮实测校正：
   * 前轴中点->后轴中点 = 车长方向（车头），车身中心->车轮中心反方向 = 车顶方向，
   * 右手系叉积得到车右方向，组装基矩阵后取逆（把实测世界轴映射回标准本地轴）。
   * 节点缺失或轴系不正交时返回 null，交由启发式兜底。
   */
  private measureCorrectionByWheels(raw: THREE.Group): THREE.Quaternion | null {
    const fl = raw.getObjectByName('wheel_fl');
    const fr = raw.getObjectByName('wheel_fr');
    const rl = raw.getObjectByName('wheel_rl');
    const rr = raw.getObjectByName('wheel_rr');
    if (!fl || !fr || !rl || !rr) return null;

    const worldPos = (o: THREE.Object3D): THREE.Vector3 =>
      o.getWorldPosition(new THREE.Vector3());
    const pfl = worldPos(fl);
    const pfr = worldPos(fr);
    const prl = worldPos(rl);
    const prr = worldPos(rr);

    // 车头：后轴中点指向前轴中点
    const frontMid = pfl.clone().add(pfr).multiplyScalar(0.5);
    const rearMid = prl.clone().add(prr).multiplyScalar(0.5);
    const front = frontMid.sub(rearMid).normalize();

    // 车顶：车身包围盒中心相对四轮中心的方向（车轮在车底）
    const wheelMid = pfl.clone().add(pfr).add(prl).add(prr).multiplyScalar(0.25);
    const bodyCenter = new THREE.Box3().setFromObject(raw).getCenter(new THREE.Vector3());
    const up = bodyCenter.sub(wheelMid);
    if (up.lengthSq() < 1e-6) return null;
    // 与车长方向正交化（防止包围盒中心沿纵向偏移污染车顶方向）
    up.addScaledVector(front, -up.dot(front)).normalize();
    if (up.lengthSq() < 1e-6) return null;

    // 右手系：right = up × front（标准姿态 X×Y=Z，对应 right×up=front）
    const right = new THREE.Vector3().crossVectors(up, front).normalize();
    const orthoCheck = new THREE.Vector3().crossVectors(right, up).dot(front);
    if (orthoCheck < 0.9) return null;

    // makeBasis 给出 标准轴->实测轴 的矩阵，取逆得到 实测轴->标准轴
    const basis = new THREE.Matrix4().makeBasis(right, up, front);
    return new THREE.Quaternion().setFromRotationMatrix(basis).invert();
  }

  /** 克隆一份可上路的模型；未加载成功时返回 null */
  cloneCar(): THREE.Group | null {
    if (!this.template) return null;
    const clone = this.template.clone(true);
    // SkinnedMesh 等骨骼资源共享即可，城市规模下无需深拷贝
    return clone;
  }

  get modelSize(): THREE.Vector3 {
    return this.size;
  }
}
