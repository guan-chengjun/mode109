# 3D 城市交通系统仿真

基于 **Vite + TypeScript + Three.js** 的浏览器端实时 3D 城市交通仿真，纯前端实现，
打开页面即进入可交互场景，无登录、无路由、无后端依赖。

## 快速开始

```bash
npm install
npm run dev      # 本地开发，自动打开 http://localhost:5173
npm run build    # 类型检查 + 生产构建（输出到 dist/）
npm run preview  # 预览生产构建
```

## 功能一览

- **城市场景**：4×4 路口方格路网（十字交叉、车道虚线/实线/停止线、人行道、绿化带），
  沿街高低错落的体块建筑（程序化窗面纹理），路灯、树木、长椅、垃圾桶等街道家具，
  重复物体全部使用 `InstancedMesh` 控制 draw call。
- **车辆仿真**：车辆沿有向车道边 + 路口连接边组成的路网循环行驶，路口按概率
  直行/左转/右转；基于 IDM 智能跟车模型保持车距，配合空间网格前向传感器避免
  穿插碰撞；五种程序化车型（轿车/SUV/微型车/公交/货车）与十种车身配色。
- **信号灯**：每个路口两相位固定配时（绿 14s → 黄 3s → 全红清空 1.5s），
  各路口带确定性相位差；车辆在红灯停车线前等待、黄灯择机停车，3D 灯头实时亮灭。
- **行人与环境**：人行道环形路径上的低多边形行人带步态摆动，路边停车带随机停放车辆。
- **远程模型**：通过 GLTFLoader + DRACOLoader 异步加载免费可商用的
  [Ferrari.glb](https://github.com/mrdoob/three.js/tree/r170/examples/models)（MIT，
  经 jsDelivr CDN 分发），加载失败/超时自动降级为程序化几何，不阻塞场景启动。
- **交互控制**：左键旋转、滚轮缩放、右键平移；侧边面板调节车流速度/时间流速、
  暂停继续、新增/清空车辆，并显示车辆总数、运行状态、FPS、模型状态。
- **渲染表现**：PBR 材质（金属车漆、物理玻璃）、日光方向光实时软阴影、环境/半球补光、
  渐变天空与指数雾，`ACESFilmic` 色调映射。

## 代码结构

```
src/
├── config/constants.ts      # 全部可调参数（路网、动力学、灯周期、模型 URL、配色）
├── core/
│   ├── PathCurve.ts         # 等弧长采样路径：按距离取位置/切向
│   ├── RoadNetwork.ts       # 有向车道边 + 路口连接边的方格路网
│   └── SimulationApp.ts     # 模块总装与 requestAnimationFrame 主循环
├── three/SceneManager.ts    # 渲染器、相机、OrbitControls、光照阴影、天空雾效
├── world/
│   ├── CityBuilder.ts       # 道路/街区/建筑/绿化/街道家具（InstancedMesh）
│   └── facadeTexture.ts     # Canvas 程序化建筑立面纹理
├── vehicles/
│   ├── Vehicle.ts           # 单车运动学：路径跟随、IDM 跟车、信号灯/路口让行
│   ├── TrafficManager.ts    # 车辆生命周期、空间网格障碍探测、路口冲突检测、停车带
│   ├── ModelManager.ts      # GLB 异步加载、DRACO 解码、四轮实测朝向归一化与克隆
│   └── proceduralVehicle.ts # 五种车型的程序化 PBR 几何
├── traffic/
│   ├── SignalSystem.ts      # 固定配时信号灯状态机
│   └── SignalVisuals.ts     # 路口信号灯杆与灯泡可视化
├── pedestrians/PedestrianSystem.ts
├── ui/ControlPanel.ts
└── main.ts
```

## 仿真模型说明

- **跟车（IDM）**：以最小静止间距 + 期望时距计算安全距离，加速度受舒适加/减速约束，
  近距离切入时启用紧急制动减速度。
- **路口防冲突**：车辆接近停车线时检查路口内连接边上的车辆，配合全红清空相位，
  避免对向/横向车流在路口内穿插。
- **朝向归一化**：远程 GLB 为 FBX Z-up 烘焙且轴序特殊，`ModelManager` 不依赖固定
  四元数，而是读取四个车轮节点的实测世界坐标，反解出 车头→+Z、车顶→+Y 的校正姿态，
  再按车长等比缩放并接地。

开发期无头浏览器自检脚本见 [`tools-inspect/README.md`](./tools-inspect/README.md)。
