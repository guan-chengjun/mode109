/**
 * 控制面板
 * 纯 DOM 控件绑定：暂停/继续、新增/清空车辆、车流速度、时间流速，
 * 以及车辆总数、运行状态、帧率、模型状态的实时显示。
 */

export interface PanelState {
  paused: boolean;
  speedScale: number;
  timeScale: number;
}

export interface PanelCallbacks {
  onTogglePause: () => void;
  onAddVehicle: () => void;
  onClearVehicles: () => void;
  onSpeedChange: (v: number) => void;
  onTimeChange: (v: number) => void;
}

export class ControlPanel {
  private el = {
    loading: document.getElementById('loading')!,
    loadingText: document.getElementById('loading-text')!,
    panel: document.getElementById('panel')!,
    btnToggle: document.getElementById('btn-toggle') as HTMLButtonElement,
    btnAdd: document.getElementById('btn-add') as HTMLButtonElement,
    btnClear: document.getElementById('btn-clear') as HTMLButtonElement,
    sliderSpeed: document.getElementById('slider-speed') as HTMLInputElement,
    sliderTime: document.getElementById('slider-time') as HTMLInputElement,
    valSpeed: document.getElementById('val-speed')!,
    valTime: document.getElementById('val-time')!,
    statVehicles: document.getElementById('stat-vehicles')!,
    statState: document.getElementById('stat-state')!,
    statFps: document.getElementById('stat-fps')!,
    statModel: document.getElementById('stat-model')!,
  };

  readonly state: PanelState = {
    paused: false,
    speedScale: 1,
    timeScale: 1,
  };

  constructor(private cb: PanelCallbacks) {
    this.bind();
  }

  private bind(): void {
    this.el.btnToggle.addEventListener('click', () => {
      this.cb.onTogglePause();
    });
    this.el.btnAdd.addEventListener('click', () => {
      this.cb.onAddVehicle();
    });
    this.el.btnClear.addEventListener('click', () => {
      this.cb.onClearVehicles();
    });
    this.el.sliderSpeed.addEventListener('input', () => {
      const v = parseFloat(this.el.sliderSpeed.value);
      this.state.speedScale = v;
      this.el.valSpeed.textContent = `${v.toFixed(1)}×`;
      this.cb.onSpeedChange(v);
    });
    this.el.sliderTime.addEventListener('input', () => {
      const v = parseFloat(this.el.sliderTime.value);
      this.state.timeScale = v;
      this.el.valTime.textContent = `${v.toFixed(1)}×`;
      this.cb.onTimeChange(v);
    });
  }

  /** 模型加载阶段的提示文案 */
  setLoadingText(text: string): void {
    this.el.loadingText.textContent = text;
  }

  /** 场景就绪后隐藏加载层、显示面板 */
  reveal(): void {
    this.el.loading.style.opacity = '0';
    this.el.loading.style.transition = 'opacity .4s';
    setTimeout(() => (this.el.loading.hidden = true), 420);
    this.el.panel.hidden = false;
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused;
    this.el.btnToggle.textContent = paused ? '继续' : '暂停';
    this.el.btnToggle.classList.toggle('btn-primary', !paused);
    this.el.statState.textContent = paused ? '已暂停' : '运行中';
  }

  setVehicleCount(n: number): void {
    this.el.statVehicles.textContent = String(n);
  }

  setModelStatus(text: string): void {
    this.el.statModel.textContent = text;
  }

  /** FPS：主循环每帧调用，内部做 0.5s 滑动统计 */
  private fpsFrames = 0;
  private fpsTimer = 0;
  updateFps(deltaSeconds: number): void {
    this.fpsFrames++;
    this.fpsTimer += deltaSeconds;
    if (this.fpsTimer >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.el.statFps.textContent = String(fps);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
  }
}
