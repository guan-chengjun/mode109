# tools-inspect — 开发期自检脚本

本目录不参与生产构建，仅用于本地验证模型与仿真行为，均为无第三方依赖的 Node 脚本
（WebGL/CDP 使用 Node 22 自带 WebSocket，GLB 解析使用 Node 内置模块）。

## 模型分析

| 脚本 | 用途 |
| --- | --- |
| `parse-glb.mjs <file.glb>` | 解析 GLB 二进制结构，打印节点层级、车轮与灯节点的局部坐标 |
| `quat-test.mjs` | 四元数旋转变换的纯数学验证 |
| `fix-quat.mjs` | 验证 GLB 朝向修正四元数（最终方案以 `ModelManager.measureCorrectionByWheels` 四轮实测为准） |

## 浏览器运行时自检（需先 `npm run dev`）

无头 Chrome 需开启远程调试端口，并且通过 `/json/new?<url>` 直接创建目标
（对已存在目标执行 `Page.navigate` 会重建 target 导致 WebSocket 失效）：

```powershell
# 1. 启动带调试端口的无头 Chrome
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList `
  "--headless=new","--disable-gpu","--enable-unsafe-swiftshader","--no-sandbox",
  "--remote-debugging-port=9227","--user-data-dir=$env:TEMP\chrome-sim","about:blank"

# 2. 创建应用目标并运行检查（端口按实际调整）
$t = (Invoke-RestMethod "http://127.0.0.1:9227/json/new?http://localhost:5174/" -Method PUT).webSocketDebuggerUrl
node tools-inspect/check-runtime.mjs "$t"
```

| 脚本 | 用途 |
| --- | --- |
| `check-runtime.mjs` | 采集控制台/运行时异常、车辆数、模型加载状态、Canvas 与面板可见性 |
| `gltf-debug.mjs` | 页面内直接调用 GLTFLoader，捕获 DRACO 等加载错误 |
| `orient-debug.mjs` | 测量归一化后模型包围盒、四元数与车辆世界姿态 |
| `closeup-glb.mjs` | 锁定一台 GLB 车辆做机位特写，验证车头朝向与接地 |
| `diagnose.mjs` | 采样车辆位移/速度分布、信号灯状态变化、路口转向边使用情况 |
| `panel-test.mjs` | 暂停/继续、新增/清空车辆、滑杆等面板交互回归 |
| `final-regression.mjs` | 清空后重生成（验证共享几何未误释放）、时间流速与全景截图 |
