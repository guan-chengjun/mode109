import { TRAFFIC } from '../config/constants';
import { RoadNetwork } from '../core/RoadNetwork';
import { PedestrianSystem } from '../pedestrians/PedestrianSystem';
import { SceneManager } from '../three/SceneManager';
import { SignalSystem } from '../traffic/SignalSystem';
import { SignalVisuals } from '../traffic/SignalVisuals';
import { ControlPanel } from '../ui/ControlPanel';
import { ModelManager } from '../vehicles/ModelManager';
import { buildProceduralVehicle } from '../vehicles/proceduralVehicle';
import { TrafficManager } from '../vehicles/TrafficManager';
import { CityBuilder } from '../world/CityBuilder';

/**
 * 仿真应用总装
 * 组合路网、信号灯、城市、车流、行人与 UI，
 * 统一在 requestAnimationFrame 中推进逻辑并渲染。
 */
export class SimulationApp {
  private sceneManager!: SceneManager;
  private panel!: ControlPanel;
  private network!: RoadNetwork;
  private signals!: SignalSystem;
  private signalVisuals!: SignalVisuals;
  private traffic!: TrafficManager;
  private pedestrians!: PedestrianSystem;
  private models = new ModelManager();

  private rafId = 0;
  private lastTime = 0;
  private walkClock = { t: 0 };
  private disposed = false;

  async start(container: HTMLElement): Promise<void> {
    this.panel = new ControlPanel({
      onTogglePause: () => this.panel.setPaused(!this.panel.state.paused),
      onAddVehicle: () => {
        // 达到容量或暂无空位时静默忽略，车辆数不变即反馈
        this.traffic.addVehicle();
        this.panel.setVehicleCount(this.traffic.vehicles.length);
      },
      onClearVehicles: () => {
        this.traffic.clearVehicles();
        this.panel.setVehicleCount(0);
      },
      onSpeedChange: () => undefined,
      onTimeChange: () => undefined,
    });

    // 1. 渲染层与静态城市
    this.sceneManager = new SceneManager(container);
    this.network = new RoadNetwork();
    this.signals = new SignalSystem();

    const city = new CityBuilder(this.network);
    city.build();
    this.sceneManager.scene.add(city.group);

    // 2. 信号灯可视化
    this.signalVisuals = new SignalVisuals(this.network, this.signals);
    this.sceneManager.scene.add(this.signalVisuals.object3d);

    // 3. 行人
    this.pedestrians = new PedestrianSystem();
    this.pedestrians.init();
    this.sceneManager.scene.add(this.pedestrians.group);

    // 4. 先加载远程 GLB（失败自动降级），再生成车辆，保证初始车流也能使用远程模型
    this.panel.setLoadingText('正在加载远程车辆模型，失败将自动使用程序化车辆…');
    const glbOk = await this.models.loadCar((text) => this.panel.setLoadingText(text));
    this.panel.setModelStatus(glbOk ? 'GLB + 程序化混合' : '程序化模型（GLB 加载失败）');

    this.traffic = new TrafficManager(this.sceneManager.scene, this.network, this.signals, this.models);
    this.traffic.populateInitial(TRAFFIC.INITIAL_COUNT);
    this.traffic.populateParked((visual) => buildProceduralVehicle(visual));
    this.panel.setVehicleCount(this.traffic.vehicles.length);

    // 6. 就绪：隐藏加载层并启动主循环
    this.panel.reveal();
    this.lastTime = performance.now();
    this.loop();
  }

  /** 主循环：真实帧间隔 -> 乘时间流速 -> 固定上限裁剪，防止标签页切回时大步长穿模 */
  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const realDt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.panel.updateFps(realDt);

    const paused = this.panel.state.paused;
    if (!paused) {
      const simDt = realDt * this.panel.state.timeScale;
      this.walkClock.t += simDt;

      // 信号灯配时 -> 灯态可视化 -> 车辆运动学 -> 行人
      this.signals.update(simDt);
      this.signalVisuals.update();
      this.traffic.update(simDt, this.panel.state.speedScale);
      this.pedestrians.update(simDt, this.walkClock);

      this.panel.setVehicleCount(this.traffic.vehicles.length);
    }

    this.sceneManager.render();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.sceneManager?.dispose();
  }

  /** 调试/自检接口：返回当前车辆数与模型加载状态 */
  getDebugInfo(): { vehicles: number; modelStatus: string; paused: boolean } {
    return {
      vehicles: this.traffic?.vehicles.length ?? 0,
      modelStatus: this.models.status,
      paused: this.panel?.state.paused ?? false,
    };
  }
}
