import { createRollingClock } from "./rolling-clock";
import { InspectionOverlay } from "./inspection-overlay";
import { DocumentDecryption } from "./document-decryption";
import "./document-decryption.css";
import "./decryption.css";
import { escapeHtml } from "./html";
import {
  normalizeQuality,
  qualityPresets,
  type QualityPreset,
  type RenderQuality,
} from "./render-quality";
import { qualityMarkup, syncQualityUI } from "./quality-settings";
import { superPerformanceQuality, wallpaperQuality } from "./wallpaper-quality";
import "@kitlangton/rolling-number/styles.css";
import "./launcher.css";
import "./style.css";
import "./quality-settings.css";
import "./responsive.css";
import { viewportLayout, openingLayout } from "./viewport-layout";
import { assetUrl } from "./asset-url";
import {
  createRollingNumber,
  createRollingText,
} from "@kitlangton/rolling-number";
import { ArchiveScene } from "./scene";
import { ModelViewer } from "./model-viewer";
import { ContentTransition, SurfaceTransition } from "./ui-transitions";
import { BootSequence } from "./boot";
import { loadBootWebfonts, disposeBootLetterings } from "./boot-lettering";
import { wrap, type ArchiveNavigation } from "./archive-loop";
import {
  records,
  categories,
  archiveColumns,
  columnFiles,
  fileLocation, catalogState, setCatalogMode, filterVersions, setVersionCatalog, setVersionLoading, setVersionError, subscribeCatalog, markInstancesReady, setInstanceCatalogError,
} from "./data";
import {tickWindow,type ArchiveRecord} from "./catalog-model";
import {launcherDetailMarkup,instanceOverview,launchActionLabel,type DetailContext,type VersionDraft,type VersionInspection} from "./launcher-detail";
import {getVersions,getVersionDetails,getLoaderVersions,catalogCall,waitInstallTask} from "./catalog-api";
import { installLauncherData } from "./launcher-data";
import {loadLauncher,launchInstance,sessionFor,stopInstance,subscribeStatus,getLauncherSnapshot,launcherAccounts,setSelectedAccount,createInstance,addOfflineAccount,readMods,revealPath} from "./launcher-bridge";
import { TerminalAudio } from "./audio";
import { audioSettingsMarkup } from "./audio-settings";
import {
  createMotionPreferences,
  fullMotion,
  motionEnabled,
  motionPresetFor,
  motionSettingsMarkup,
  motionSummary,
  reducedMotion,
  type MotionKey,
  type MotionPreset,
  type StoredMotion,
} from "./motion-preferences";
import { StartupGate } from "./startup";
import {
  isWallpaper,
  wallpaperHost,
  wallpaperFrame,
  type WallpaperProperties,
} from "./wallpaper";
import "./startup.css";
import "./wallpaper.css";
import { Workbench } from "./workbench";
import { ArchivePlayground } from "./archive-playground";
import { ARRAY_OPENING_END, openingShowsDetail } from "./wallpaper-opening";
import { paintTheme, themeSettingsMarkup } from "./theme-ui";
import { WallpaperEffects } from "./wallpaper-effects";
import { WallpaperBackground } from "./wallpaper-background";
import { enableGamepad, disableGamepad, isGamepadEvent, onInputDevice } from "./gamepad";
import { logo, brandHeading } from "./brand";

import type {FeatureEnvironment} from '@rhine/plugin-api'
import {ownedEffects} from './runtime-effects'
import type {NativePanelHandle} from './native-panels'
import type {ArchiveBackend,ArchiveBackendFactory} from './rendering/backend'
import {rendererPreference,shouldTryNative,nativeQualitySupported,type RendererPreference} from './rendering/policy'

/** Mount the original native terminal once, with all acquired resources owned by its fiber. */
export function mountConsole(env:FeatureEnvironment):void {
 const life=ownedEffects(env)
 const {listen,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout}=life
 const previousApi=(window as any).rhine
 const launchInstance=(id:string)=>env.use<ReturnType<typeof import('./launcher-bridge').launchInstance>>('launcher.launch.start',{id})
 const stopInstance=(sessionId:string)=>env.use<ReturnType<typeof import('./launcher-bridge').stopInstance>>('launcher.session.stop',{sessionId})
 const createInstance=(config:Parameters<typeof import('./launcher-bridge').createInstance>[0])=>env.use<ReturnType<typeof import('./launcher-bridge').createInstance>>('launcher.instance.create',config)
 const addOfflineAccount=(name:string)=>env.use<ReturnType<typeof import('./launcher-bridge').addOfflineAccount>>('launcher.account.offline',{name})
 const readMods=(id:string)=>env.use<ReturnType<typeof import('./launcher-bridge').readMods>>('launcher.mods.list',{id})
 const revealPath=(path:string)=>env.use<ReturnType<typeof import('./launcher-bridge').revealPath>>('launcher.system.reveal',{path})
 const catalogCall=async<T,>(id:string,input:Record<string,unknown>={},signal?:AbortSignal):Promise<T>=>env.use<T|Promise<T>>(id,{...input,signal})
 const getVersions=(signal?:AbortSignal)=>catalogCall<import('./catalog-model').GameVersion[]>('launcher.versions.list',{},signal)
 const getVersionDetails=(id:string,signal?:AbortSignal)=>catalogCall<{id:string;javaVersion?:{majorVersion:number}}>('launcher.version.details',{id},signal)
 const getLoaderVersions=(kind:string,gameVersion:string,signal?:AbortSignal)=>catalogCall<{version:string;stable?:boolean}[]>('launcher.loader.versions',{kind,gameVersion},signal)
 const waitInstallTask=async(id:string,signal?:AbortSignal)=>{const task=await catalogCall<{status:string;error?:string|{message?:string}}>('launcher.task.wait',{id},signal);if(task.status!=='succeeded')throw new Error(typeof task.error==='string'?task.error:task.error?.message??(task.status==='cancelled'?'任务已取消，实例保留以便重试':'安装失败'))}
 const loadLauncher=async()=>{await env.use<Promise<void>>('launcher.bootstrap');if(env.context.features.has('launcher.events.connect'))env.use('launcher.events.connect')}

















// The local launcher does not install the upstream website service worker.





















let workbench: Workbench | undefined;



let playground: ArchivePlayground | undefined;



let wallpaperEffects: WallpaperEffects | undefined;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;


$("#stage").innerHTML = `
  <div id="three-scene" class="three-scene"></div>
  <div class="scene-atmosphere archive-atmosphere"></div>
  <div id="boot-background" class="boot-background"><svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><g fill="none" stroke="#fff" stroke-width="3"><path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113"/><path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130"/><circle cx="1450" cy="648" r="346"/><circle cx="1450" cy="648" r="348"/></g></svg></div>
  <header class="brand">${brandHeading}</header>
  <nav class="system-nav" aria-label="系统导航">
    <button data-action="catalog-instances" data-catalog="instances" class="is-current">我的实例</button>
    <button data-action="browse-versions" data-catalog="versions">安装版本 ↗</button>
    <button data-action="packs-management">导入整合包</button>
    <button data-action="search"><span class="nav-glyph">⌕</span> 检索 <span class="key">/</span></button>
    <button data-action="saved" aria-label="查看收藏档案" title="收藏档案">收藏 <span id="saved-count">00</span></button>
    <button class="settings-button" data-action="settings" aria-label="系统设置" title="系统设置"><span class="settings-glyph" aria-hidden="true">◷</span><span class="settings-label">设置</span></button>
  </nav>
  <button id="skip" class="skip" data-action="skip">ENTER SYSTEM <span>↗</span></button>
  <section id="boot" class="boot" aria-label="系统启动">
    <div class="access-text">ACCESS</div>
    <div class="boot-logo">${logo}</div>
    <div class="auth-status"><span>▪</span> <span id="auth-message"></span><i></i></div>
    <div class="scan"><svg viewBox="0 0 1920 1080" aria-hidden="true"><g fill="none" stroke="#080a08" stroke-width="2" stroke-linecap="round"><path/><path stroke="#fff"/><path/><path/><path/><path/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="scan-core" cx="960" cy="540" r="5" fill="#080a08" stroke="none"/></g></svg><span>PERMISSION AUTHORIZED</span></div>
    <div class="welcome"><div class="welcome-panel"></div><div class="welcome-heading">WELCOME TO</div><div class="welcome-company"><strong>RHINE LAB.LLC.</strong><strong class="welcome-highlight" aria-hidden="true">RHINE LAB.LLC.</strong></div><div class="welcome-database">INTERNAL DATABASE</div><div class="welcome-logo">${logo}</div></div>
  </section>
  <svg id="inspection-marks" viewBox="0 0 1920 1080" aria-hidden="true"><path id="inspection-lines"/><g id="inspection-corners"></g><circle id="inspection-point" r="1.8"/></svg>
  <div id="inspection-text" aria-hidden="true">CONFIDENTIALITY:<strong>GENERAL BUSINESS USE</strong></div>
  <section id="archive-ui" class="archive-ui" aria-label="游戏档案选择">
    <div class="catalog-navigation" id="catalog-navigation"></div>
    <div class="archive-callout"><div class="eyebrow"><span id="archive-category">我的实例</span></div><button class="file-title" data-action="open"> <span id="selected-title">读取目录</span><span class="file-open">↗</span></button><div class="callout-rule"><i></i></div><div class="file-summary"><span id="selected-id">X-<span id="selected-code">001</span></span><span id="selected-clearance">GAME ARCHIVE</span></div><span id="selection-description"></span><button class="read-file" data-action="open">查看实例 <span>→</span></button></div>
    <div id="hover-label" class="hover-label" hidden>X-<span id="hover-code">001</span> / <span id="hover-title"></span></div>
    <div class="archive-counter"><span class="tiny-label">选中</span><div><span id="selected-number">01</span><i>/</i><span class="count-total">00</span></div></div>
    <div class="archive-navigation"><button data-action="prev" aria-label="上一个档案">↑</button><div id="file-ticks" class="file-ticks"></div><button data-action="next" aria-label="下一个档案">↓</button></div>
    <div class="column-navigation"><button data-action="column-prev" aria-label="上一列">←</button><div><span id="column-number">分组 <span id="column-index">03</span> / <span id="column-total">01</span></span><strong id="column-name">我的实例</strong></div><button data-action="column-next" aria-label="下一列">→</button></div>
    <div class="archive-hint"><kbd>←</kbd> <kbd>→</kbd> 分组 <span>·</span> <kbd>↑</kbd> <kbd>↓</kbd> 选择 <span>·</span> <kbd>ENTER</kbd> 打开</div>
  </section>
  <section id="detail-ui" class="detail-ui" aria-label="档案内容" hidden>
    <button class="back-button" data-action="back">← <span>返回</span><small>ESC</small></button>
    <div class="object-caption"><button class="viewer-open" data-action="model-viewer" title="打开 360° 模型查看器">查看模型 <span>↗</span></button></div>
    <article id="detail-content" class="detail-content"></article>
  </section>
  <div class="powered">POWERED BY <b>RHINE LAB</b><i></i></div>
  <footer class="system-footer"><span><i class="status-light"></i> <span id="launcher-connection">连接启动器</span>${isWallpaper ? '<button type="button" class="three-toggle" data-action="toggle-three" aria-pressed="true" title="卸载三维模型，保留 2D 界面">3D 开启</button>' : ""}</span><span><button id="current-account" data-action="account-settings">选择启动账号</button> <i>／</i> <span id="clock">00:00:00</span></span><button data-action="replay" title="重播启动流程">重播 ↻</button></footer>
  <div id="pwa-update-notice" class="pwa-update-notice" role="status" hidden><span>新版本已就绪</span><button data-pwa-action="update">更新并重启 ↻</button></div>
  <div id="modal-root"></div><div id="toast" class="toast" role="status"></div>
  <div id="loading" class="loading"><div class="loading-mark">${logo}</div><span>CONNECTING TO INTERNAL DATABASE</span><i></i></div>
`;

$("#boot-background").insertAdjacentHTML(
  "beforeend",
  '<div class="boot-white"></div>',
);
const bootSequence = new BootSequence($("#stage"));
$("#viewport").insertAdjacentHTML(
  "beforeend",
  '<button class="mobile-entry" data-action="skip">进入档案 <span>→</span></button>',
);

const ownedMobileEntry=$("#viewport").lastElementChild!;
life.add(()=>ownedMobileEntry.remove());
type Mode = "boot" | "archive" | "detail";
let mode: Mode = "boot",
  selected = 0,
  bootStart = 0,
  lastStep = "",
  ready = false;
let activeNativePanel:NativePanelHandle|undefined;
let modal: "search" | "saved" | "settings" | "account" | "mods" | "packs" | null = null,
  searchQuery = "",
  filter = "全部档案";
let activeTab = "overview";
const reviewParams = new URLSearchParams(location.search);
let frozenTime =
  reviewParams.get("freeze") === "1"
    ? Number(reviewParams.get("time") ?? 0)
    : null;
if (reviewParams.get("review") === "1") {
  $("#stage").dataset.review = "true";
  listen(window, "message", (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== window.parent ||
      event.data?.type !== "rhine-review-frame"
    )
      return;
    const t = Number(event.data.time);
    if (!Number.isFinite(t) || t < 0 || t >= 35) return;
    frozenTime = t;
    if (ready && mode !== "boot") setMode("boot");
  });
}
let toastTimer: ReturnType<typeof setTimeout>;
let previousFocus: HTMLElement | null = null;
const detailTransition = new SurfaceTransition(
  $("#detail-ui"),
  undefined,
  180,
  180,
);
const tabTransition = new ContentTransition();
let modalTransition: SurfaceTransition | undefined;
let modalClosing = false;
let modalSiblings: { node: HTMLElement; inert: boolean }[] = [];
let pendingDetailFocus = false;
let bookmarkFeedback: Animation | undefined;
function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const saved = new Set<string>(readLocal<string[]>("rhine-saved", []));
const storedPrefs = readLocal<
  Partial<{
    sound: boolean;
    music: boolean;
    soundVolume: number;
    musicVolume: number;
    reduced: boolean;
    quality: boolean;
    rendering: RenderQuality;
    superPerformance: boolean;
    rendererBackend:RendererPreference;
    colorTheme: "light" | "dark";
    motion: StoredMotion;
    motionPreset: MotionPreset;
  }>
>("rhine-settings", {});
const initialMotion = createMotionPreferences(
  storedPrefs.motion,
  storedPrefs.reduced ??
    (storedPrefs.motion === undefined
      ? matchMedia("(prefers-reduced-motion: reduce)").matches
      : undefined),
);
const initialMotionPreset = motionPresetFor(initialMotion);
const prefs = {
  rendererBackend:rendererPreference(reviewParams.get("renderer")??storedPrefs.rendererBackend),
  sound: storedPrefs.sound ?? true,
  music: storedPrefs.music ?? storedPrefs.sound ?? true,
  soundVolume: storedPrefs.soundVolume ?? 0.55,
  musicVolume: storedPrefs.musicVolume ?? 0.5,
  motion: initialMotion,
  motionPreset: initialMotionPreset,
  quality: storedPrefs.quality ?? true,
  superPerformance: storedPrefs.superPerformance ?? false,
  rendering: normalizeQuality(
    storedPrefs.rendering,
    storedPrefs.quality !== false,
  ),
  colorTheme: storedPrefs.colorTheme === "dark" ? "dark" : "light",
};
const motionActive = (key: MotionKey) => motionEnabled(prefs.motion, key);
const motionIsReduced = () =>
  Object.values(prefs.motion).every((value) => !value);
paintTheme(prefs.colorTheme === "dark" ? 1 : 0);
const rollingMotion = {
  duration: 460,
  motionBlur: true,
  animated: motionActive("rollingNumbers"),
};
const updateFooterClock = createRollingClock($("#clock"));
const numberOptions = {
  ...rollingMotion,
  locales: "en-US",
  format: { minimumIntegerDigits: 2, useGrouping: false },
};
const fileCounter = createRollingNumber($("#selected-number"), {
  ...numberOptions,
  value: 1,
});
const columnCounter = createRollingNumber($("#column-index"), {
  ...numberOptions,
  value: 3,
});
const codeOptions = {
  ...numberOptions,
  format: { minimumIntegerDigits: 3, useGrouping: false },
  value: 1,
};
const textOptions = {
  ...rollingMotion,
  animated: motionActive("rollingText"),
  transition: "direct" as const,
  stagger: "none" as const,
};
const selectionTitle = createRollingText($("#selected-title"), {
  ...textOptions,
  text: $("#selected-title").textContent ?? "",
});
const columnTitle = createRollingText($("#column-name"), {
  ...textOptions,
  text: $("#column-name").textContent ?? "",
});
const hoverTitle = createRollingText($("#hover-title"), {
  ...textOptions,
  text: "",
});
const categoryTitle = createRollingText($("#archive-category"), {
  ...textOptions,
  text: $("#archive-category").textContent ?? "",
});
const clearanceTitle = createRollingText($("#selected-clearance"), {
  ...textOptions,
  text: $("#selected-clearance").textContent ?? "",
});
const rollingTitles = [
  selectionTitle,
  columnTitle,
  hoverTitle,
  categoryTitle,
  clearanceTitle,
];
const selectedCode = createRollingNumber($("#selected-code"), codeOptions);
const hoverCode = createRollingNumber($("#hover-code"), codeOptions);
const audio = new TerminalAudio();
life.add(()=>audio.dispose());
let musicSuppressed = false;
function configureAudio() {
  audio.configure({ ...prefs, music: prefs.music && !musicSuppressed });
}
configureAudio();
const reviewEntry =
  reviewParams.has("scene") ||
  reviewParams.has("time") ||
  reviewParams.get("review") === "1";
let started = false;
const loading = $("#loading");
// The entry screen uses the actual viewport, including portrait phones; the
// reference animation still uses its calibrated 1920 x 1080 stage.
$("#viewport").append(loading);
life.add(()=>loading.remove());
$("#stage").inert = true;
$(".mobile-entry").inert = true;
const entry =
  !isWallpaper && !reviewEntry && (prefs.sound || prefs.music)
    ? new StartupGate({
        root: loading,
        unlock: () => audio.unlock(),
        cancel: () => audio.cancelEntry(),
        start: (silent) => completeStartup(silent),
      })
    : undefined;
if (entry) {
  audio.holdForEntry();
  if (prefs.music)
    void audio.prepareMusic().catch(() => {
      /* Entry offers retry. */
    });
}
let audioPreview = false,
  audioPreviewRequest = 0;
let scene: ArchiveScene | undefined;
let threeState: "on" | "closing" | "off" | "loading" = "on";
let resumeCell: { lane: number; row: number } | undefined;
let resumeSelection = -1;
let viewer: ModelViewer | undefined;
const accessLog: { id: string; time: string }[] = [];
const columnMemory=new Map<string,string>();
let selectedKey=records[0].key;
const catalogMemory=new Map<string,string>();
let pendingCatalogChange:(()=>void)|null=null;
function recordAccess() {
  accessLog.unshift({
    id: records[selected].id,
    time: new Date().toLocaleTimeString("en-GB"),
  });
}
function saveAudioPrefs() {
  try {
    localStorage.setItem("rhine-settings", JSON.stringify(prefs));
  } catch {}
  configureAudio();
}
function superPerformanceEnabled() {
  return isWallpaper
    ? wallpaperHost()?.properties.superperformance?.value === true
    : prefs.superPerformance;
}
function effectiveRenderQuality() {
  return superPerformanceEnabled() ? superPerformanceQuality : prefs.rendering;
}
function savePrefs() {
  saveAudioPrefs();
  if (!motionActive("rollingText"))
    rollingTitles.forEach((title) => title.finish());
  if (!motionActive("rollingNumbers"))
    [fileCounter, columnCounter, selectedCode, hoverCode].forEach((counter) =>
      counter.finish(),
    );
  if (!motionActive("surfaceTransitions")) {
    detailTransition.finish();
    modalTransition?.finish();
    tabTransition.finish();
    bookmarkFeedback?.cancel();
  }
  scene?.setMotion(prefs.motion);
  scene?.setTheme(
    prefs.colorTheme === "dark",
    !motionActive("surfaceTransitions") || !started,
  );
  document
    .querySelectorAll<HTMLElement>("[data-color-theme]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.colorTheme === prefs.colorTheme),
      ),
    );
  if(scene?.backendKind==="webgpu"&&!nativeQualitySupported(effectiveRenderQuality(),superPerformanceEnabled())){
    if(ready)void switchRenderer("webgl2","该透射分辨率使用完整兼容渲染");
    else throw new Error("所选画质需要 WebGL 兼容后端");
  }else{scene?.setSuperPerformance(superPerformanceEnabled());scene?.setQuality(effectiveRenderQuality())}
  viewer?.setSuperPerformance(superPerformanceEnabled());
  viewer?.setQuality(effectiveRenderQuality());
  viewer?.setMotion(prefs.motion);
  syncQualityUI(prefs.rendering);
  updateQualitySummary();
  fileCounter.update({
    animated: motionActive("rollingNumbers") && mode === "archive",
  });
  rollingTitles.forEach((title) =>
    title.update({
      animated: motionActive("rollingText") && mode === "archive",
    }),
  );
  columnCounter.update({
    animated: motionActive("rollingNumbers") && mode === "archive",
  });
  selectedCode.update({
    animated: motionActive("rollingNumbers") && mode === "archive",
  });
  hoverCode.update({
    animated: motionActive("rollingNumbers") && mode === "archive",
  });
  $("#stage").classList.toggle("reduce-motion", motionIsReduced());
  $("#stage").classList.toggle(
    "reduce-surfaces",
    !motionActive("surfaceTransitions"),
  );
  workbench?.setMotion(prefs.motion);
  updateFooterClock(new Date(), motionActive("rollingNumbers"));
  syncWallpaperBackground();
}
let previousLayout = "";
function fit() {
  const stage = $("#stage");
  const viewport = $("#viewport");
  const coarse = matchMedia("(pointer: coarse)").matches;
  const reference =
    reviewParams.has("time") || reviewParams.get("review") === "1";
  const { width, height, scale, kind } =
    mode === "boot" && !reference
      ? openingLayout(viewport.clientWidth, viewport.clientHeight)
      : viewportLayout(
          viewport.clientWidth,
          viewport.clientHeight,
          coarse,
          mode === "boot",
        );
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  stage.dataset.layout = kind;
  stage.dataset.touch = String(coarse);
  viewport.dataset.mobileBoot = String(
    mode === "boot" && (coarse || viewport.clientWidth < 1100),
  );
  stage.style.setProperty("--stage-scale", String(scale));
  stage.style.setProperty("--opening-width", `${width}px`);
  stage.style.setProperty("--opening-height", `${height}px`);
  stage.style.setProperty(
    "--opening-scan-scale",
    String(Math.min(1, width / 1920)),
  );
  stage.dataset.openingPortrait = String(width < height);
  // The software keyboard resizes dialogs without recomposing the 3D scene.
  const visible = window.visualViewport;
  const stageTop = (viewport.clientHeight - height * scale) / 2;
  stage.style.setProperty(
    "--modal-top",
    `${Math.max(0, (visible?.offsetTop ?? 0) - stageTop) / scale}px`,
  );
  stage.style.setProperty(
    "--modal-height",
    `${Math.min(height, (visible?.height ?? viewport.clientHeight) / scale)}px`,
  );
  $("#viewport").style.setProperty("--scale", String(scale));
  const marks = document.querySelector("#inspection-marks");
  marks?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const layoutKey = JSON.stringify([
    width,
    height,
    scale,
    kind,
    devicePixelRatio,
  ]);
  if (layoutKey !== previousLayout) {
    previousLayout = layoutKey;
    scene?.resize();
    viewer?.resize();
  }
  updateQualitySummary();
  // Re-measure line covers and tab underline after wrapping changes.
  requestAnimationFrame(() => {
    documentDecryption.refresh();
    const tab = document.querySelector<HTMLElement>(
      ".detail-tabs button.active",
    );
    const indicator = document.querySelector<HTMLElement>(".tab-indicator");
    if (tab && indicator)
      indicator.style.transform = `translateX(${tab.offsetLeft}px) scaleX(${tab.offsetWidth})`;
  });
}
listen(window, "resize", fit);
listen(window.visualViewport, "resize", fit);
listen(window.visualViewport, "scroll", fit);
listen(matchMedia("(pointer: coarse)"),"change",fit);
fit();
let fileTicks:HTMLButtonElement[]=[];

function setMode(next: Mode) {
  if (workbench?.enabled && next === "detail") next = "archive";
  const previousMode = mode;
  rollingTitles.forEach((title) =>
    title.update({
      animated: motionActive("rollingText") && next === "archive",
    }),
  );
  if (next !== "archive") {
    rollingTitles.forEach((title) => title.finish());
    hoverCode.finish();
    $("#hover-label").hidden = true;
  }
  if (next === "detail" && mode !== "detail") recordAccess();
  mode = next;
  syncWallpaperBackground();
  audio.setScene(next);
  if (next !== "boot" && audioPreview) {
    audioPreview = false;
    audioPreviewRequest++;
    configureAudio();
  }
  $("#stage").dataset.mode = next;
  workbench?.syncVisibility();
  if (previousMode !== next) fit();
  $("#boot").inert = next !== "boot";
  $("#boot").setAttribute("aria-hidden", String(next !== "boot"));
  $("#archive-ui").inert =
    next !== "archive" || Boolean(modal) || Boolean(workbench?.enabled);
  $("#archive-ui").setAttribute(
    "aria-hidden",
    String(next !== "archive" || Boolean(workbench?.enabled)),
  );
  $(".system-nav").inert = next === "boot" || Boolean(modal);
  $(".system-footer").inert = next === "boot" || Boolean(modal);
  if (next === "detail") {
    if (previousMode !== "detail")
      detailTransition.show(!motionActive("surfaceTransitions"));
  } else if (
    previousMode === "detail" ||
    (next === "boot" && !$("#detail-ui").hidden)
  ) {
    pendingDetailFocus = false;
    tabTransition.cancel();
    detailTransition.hide(
      !motionActive("surfaceTransitions") || next === "boot",
    );
    if (!modal && next === "archive")
      $(".read-file").focus({ preventScroll: true });
  }
  $("#detail-ui").inert = next !== "detail" || Boolean(modal);
  scene?.setMode(next === "boot" ? "hidden" : next);
  if (next !== "boot") {
    bootSequence.reset();
    $(".file-title").firstChild!.textContent=" ";
    $("#stage").dataset.boot = "done";
  }
  if (next === "detail" && previousMode !== "detail") {
    renderDetail();
    pendingDetailFocus = true;
    if (!scene) {
      $("#detail-content").style.opacity = "1";
      $("#detail-content").style.translate = "0 0";
      $("#detail-content").inert = false;
    }
  }
}
let selectionUiDirty=false;let selectionUiNavigation:ArchiveNavigation|undefined;
function select(index:number,navigation?:ArchiveNavigation,deferUi=false) {
  if(!Number.isInteger(index)||!records[index])return;
  selected=index;selectedKey=records[selected].key;
  columnMemory.set(catalogState().mode+"|"+records[selected].category,selectedKey);
  catalogMemory.set(catalogState().mode,selectedKey);
  if (mode === "detail") setMode("archive");
  activeTab = "overview";
  scene?.select(selected,navigation);
  if(deferUi){selectionUiDirty=true;selectionUiNavigation=navigation}else{selectionUiDirty=false;updateSelection(navigation)}
  const columnMove =
    navigation && "axis" in navigation && navigation.axis === "lane";
  audio.play(
    columnMove ? "column" : "tick",
    columnMove ? navigation.direction * 0.45 : 0,
  );
}
function stepFile(direction: number) {
  const files = columnFiles(fileLocation(selected).lane);
  if (files.length < 2) return;
  select(
    files[(files.indexOf(selected) + direction + files.length) % files.length],
    { axis: "row", direction },
  );
}
function stepColumn(direction: number) {
  const lane = fileLocation(selected).lane;
  const next = wrap(lane + direction, archiveColumns.length);
  const key=columnMemory.get(catalogState().mode+"|"+archiveColumns[next]);
  const candidate=records.findIndex(record=>record.key===key);
  const target=candidate>=0?candidate:columnFiles(next)[0];
  if(target!==undefined)select(target,{axis:"lane",direction});
}
function updateSelection(navigation?: ArchiveNavigation) {
  const r = records[selected];
  const { lane } = fileLocation(selected);
  const files=columnFiles(lane);
  $("#column-total").textContent=String(archiveColumns.length).padStart(2,"0");
  renderCatalogControls();
  $("#selection-description").textContent=r.kind==="instance"?r.en+" · "+r.loaderLabel:r.kind==="version"?"发布于 "+r.date+(r.lead!=="尚未创建实例"?" · "+r.lead:""):r.abstract;
  $(".read-file").innerHTML=(r.kind==="instance"?"打开实例":r.kind==="version"?"配置并安装":catalogState().mode==="instances"?"选择版本":"重试")+" <span>→</span>";
  selectionTitle.update({
    text: r.title,
    animated: motionActive("rollingText") && mode === "archive",
  });
  clearanceTitle.update({
    text:r.kind==="instance"?(sessionFor(r.instanceId!)?"运行中":"本地实例"):r.clearance,
    animated: motionActive("rollingText") && mode === "archive",
  });
  categoryTitle.update({
    text: r.category,
    animated: motionActive("rollingText") && mode === "archive",
  });
  const direction =
    navigation && "axis" in navigation
      ? navigation.direction > 0
        ? "up"
        : "down"
      : "auto";
  selectedCode.update({
    value: Number(r.id.slice(2)),
    animated: motionActive("rollingNumbers") && mode === "archive",
    direction,
  });
  fileCounter.update({
    value:r.kind==="empty"?0:files.indexOf(selected)+1,
    animated: motionActive("rollingNumbers") && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "row"
        ? direction
        : "auto",
  });
  $(".count-total").textContent=String(r.kind==="empty"?0:files.length).padStart(2,"0");
  columnCounter.update({
    value: lane + 1,
    animated: motionActive("rollingNumbers") && mode === "archive",
    direction:
      navigation && "axis" in navigation && navigation.axis === "lane"
        ? direction
        : "auto",
  });
  columnTitle.update({
    text: archiveColumns[lane],
    animated: motionActive("rollingText") && mode === "archive",
  });
  $<HTMLButtonElement>('[data-action="column-prev"]').disabled = false;
  $<HTMLButtonElement>('[data-action="column-next"]').disabled = false;
  const visible=r.kind==='empty'?[]:tickWindow(files,selected);
  while(fileTicks.length<visible.length){const button=document.createElement('button');$('#file-ticks').append(button);fileTicks.push(button)}
  fileTicks.forEach((button,slot)=>{const index=visible[slot],record=records[index];button.hidden=!record;if(!record)return;button.dataset.select=String(index);button.setAttribute('aria-label','选择 '+record.title+' · '+record.department);button.title=record.title+' · '+record.department+' · '+record.date;button.classList.toggle('selected',index===selected);button.setAttribute('aria-pressed',String(index===selected))});
  $<HTMLButtonElement>('[data-action="column-prev"]').disabled=archiveColumns.length<2;
  $<HTMLButtonElement>('[data-action="column-next"]').disabled=archiveColumns.length<2;
  $<HTMLButtonElement>('[data-action="prev"]').disabled=r.kind==='empty'||files.length<2;
  $<HTMLButtonElement>('[data-action="next"]').disabled=r.kind==='empty'||files.length<2;
  $("#saved-count").textContent = String(saved.size).padStart(2, "0");
}
function replayBoot(forcePreview = false) {
  if (!ready) return;
  closeModal(() => replayBootAfterModal(forcePreview));
}
function replayBootAfterModal(forcePreview: boolean) {
  bootStart = performance.now() / 1000 - 1.76;
  frozenTime = null;
  lastStep = "";
  setMode(!motionActive("boot") && !forcePreview ? "archive" : "boot");
  audio.restartBoot();
  scene?.select(0);
  selected = 0;
  updateSelection();
  if (!forcePreview) audio.play("ui-tick");
}
/** Native launcher control layer. The upstream scene and camera remain the interaction driver. */
const drafts=new Map<string,VersionDraft>();
const inspections=new Map<string,VersionInspection>();
const modCounts=new Map<string,{count?:number;error?:string}>();
const lookupControllers=new Map<string,AbortController>();
const installations=new Map<string,{running:boolean;taskId?:string;message:string;error?:string}>();
let versionsRequest:Promise<void>|undefined;
let launcherError='';
let lastCatalogMarkup='';
function currentRecord(){return records[selected]??records[0]}
function getDraft(record:ArchiveRecord):VersionDraft{
 if(!drafts.has(record.key))drafts.set(record.key,{name:'Minecraft '+record.gameVersion,loader:'vanilla',loaderVersion:'',memoryMb:4096});return drafts.get(record.key)!
}
function detailContext(record:ArchiveRecord):DetailContext{
 const snapshot=getLauncherSnapshot(),id=record.instanceId??'',session=id?sessionFor(id):undefined,job=installations.get(id);
 const pending=Boolean(job?.running||snapshot.pending[id]?.some(action=>action==='launch'||action==='stop'||action==='update'));
 const count=modCounts.get(id),status=job?.running?'安装中':session?.status==='starting'?'启动中':session?.status==='running'?'运行中':pending?'准备中':'';
 return {accounts:launcherAccounts(),selectedAccountId:snapshot.selectedAccountId,pending,running:Boolean(session),status:record.kind==='version'?record.clearance:status,error:(job?.error??snapshot.errors[id]?.message??launcherError)||undefined,
  mods:count?.count,modsError:count?.error,draft:record.kind==='version'?getDraft(record):undefined,inspection:record.kind==='version'?(inspections.get(record.key)??{loading:true}):undefined}
}
function renderCatalogControls(){
 const state=catalogState(),node=$('#catalog-navigation');if(!node)return;
 const reload='<button class="inline-button" data-action="'+(state.mode==='instances'?'reload-launcher':'refresh-versions')+'" title="刷新目录" aria-label="刷新目录">↻</button>';
 const html=state.mode==='instances'
  ? '<div class="catalog-tools"><button data-action="browse-versions">＋ 新建实例</button>'+reload+'</div>'
  : '<div class="catalog-channels">'+[['release','稳定版'],['snapshot','快照 / 测试'],['history','历史版']].map(([key,title])=>'<button data-channel="'+key+'" aria-pressed="'+(state.channel===key)+'">'+title+'</button>').join('')+'</div><label>版本系列<select id="version-family" aria-label="按版本系列筛选"><option value="">全部系列</option>'+state.families.map(family=>'<option value="'+escapeHtml(family)+'"'+(state.family===family?' selected':'')+'>'+escapeHtml(family)+'</option>').join('')+'</select></label>'+(state.versionStatus==='loading'?'<p role="status">读取中…</p>':state.versionStatus==='error'?'<p role="alert">'+escapeHtml(state.versionError)+'</p>':'')+'<div class="catalog-tools"><span>'+ (state.versionStatus==='ready'?(state.filtered===state.total?state.total:state.filtered+' / '+state.total)+' 个版本':'')+'</span>'+reload+'</div>';
 if(lastCatalogMarkup!==html||!node.firstChild){node.innerHTML=html;lastCatalogMarkup=html}
 document.querySelectorAll<HTMLElement>('[data-catalog]').forEach(button=>button.classList.toggle('is-current',button.dataset.catalog===state.mode));
}
async function loadVersionCatalog(force=false){
 if(versionsRequest)return versionsRequest;
 if(!force&&catalogState().versionStatus==='ready')return;
 setVersionLoading();
 versionsRequest=(async()=>{try{setVersionCatalog(await getVersions())}catch(error){setVersionError(error instanceof Error?error.message:String(error))}finally{versionsRequest=undefined}})();
 return versionsRequest;
}
function changeCatalog(apply:()=>void){
 if(modal){closeModal(()=>changeCatalog(apply));return}
 if(mode==='detail'&&scene&&motionActive('surfaceTransitions')){
  pendingCatalogChange=apply;setMode('archive');return;
 }
 if(mode==='detail')setMode('archive');apply();
}
function browseVersions(){changeCatalog(()=>{setCatalogMode('versions');void loadVersionCatalog()})}
function inspectVersion(record:ArchiveRecord,force=false){
 if(record.kind!=='version'||!record.gameVersion)return;
 if(inspections.has(record.key)&&!force)return;
 lookupControllers.get(record.key)?.abort();const controller=new AbortController();lookupControllers.set(record.key,controller);
 const info:VersionInspection={loading:true,builds:[]};inspections.set(record.key,info);
 if(ready&&mode==='detail'&&currentRecord().key===record.key)renderDetail();
 void getVersionDetails(record.gameVersion,controller.signal).then(json=>{if(json.id!==record.gameVersion)throw new Error('返回的版本元数据与选择不符');info.java=json.javaVersion?.majorVersion}).catch(error=>{if(!controller.signal.aborted)info.error=error instanceof Error?error.message:String(error)}).finally(()=>{
  if(controller.signal.aborted)return;info.loading=false;
  if(ready&&mode==='detail'&&currentRecord().key===record.key)renderDetail();
  if(getDraft(record).loader!=='vanilla')void loadCompatibleBuilds(record);
 });
}
async function loadCompatibleBuilds(record:ArchiveRecord){
 if(record.kind!=='version'||!record.gameVersion)return;
 const draft=getDraft(record),info=inspections.get(record.key);if(!info)return;
 const key='loader:'+record.key;lookupControllers.get(key)?.abort();
 if(draft.loader==='vanilla'){info.loaderLoading=false;info.loaderError=undefined;info.builds=[];draft.loaderVersion='';if(mode==='detail')renderDetail();return}
 const controller=new AbortController();lookupControllers.set(key,controller);
 const requested=draft.loader;info.loaderLoading=true;info.loaderError=undefined;info.builds=[];draft.loaderVersion='';renderDetail();
 try{const builds=await getLoaderVersions(requested,record.gameVersion,controller.signal);if(controller.signal.aborted||requested!==draft.loader)return;info.builds=builds;draft.loaderVersion=builds[0]?.version??'';if(!builds.length)info.loaderError=requested+' 没有支持 '+record.gameVersion+' 的构建，请改选原版或其他版本'}
 catch(error){if(!controller.signal.aborted)info.loaderError=error instanceof Error?error.message:String(error)}
 finally{if(!controller.signal.aborted){info.loaderLoading=false;if(mode==='detail'&&currentRecord().key===record.key)renderDetail()}}
}
async function readCurrentMods(record:ArchiveRecord){
 if(!record.instanceId)return;const id=record.instanceId;
 try{const mods=await readMods(id);modCounts.set(id,{count:mods.length})}catch(error){modCounts.set(id,{error:error instanceof Error?error.message:String(error)})}
 if(ready&&mode==='detail'&&currentRecord().key===record.key&&activeTab==='overview')setTab('overview',false);
}
async function handleLaunch(){
 const record=currentRecord();if(!record.instanceId)return;
 if(!getLauncherSnapshot().selectedAccountId){openModal('account');return}
 launcherError='';audio.play('confirm');
 try{await launchInstance(record.instanceId)}catch(error){launcherError=error instanceof Error?error.message:String(error)}finally{refreshLauncherPanel()}
}
async function handleStop(){const record=currentRecord(),session=record.instanceId?sessionFor(record.instanceId):undefined;if(!session)return;try{await stopInstance(session.id)}catch(error){launcherError=error instanceof Error?error.message:String(error)}finally{refreshLauncherPanel()}}
async function createAndInstall(){
 const record=currentRecord();if(record.kind!=='version'||!record.gameVersion)return;
 const draft={...getDraft(record)},info=inspections.get(record.key);if(!draft.name.trim()||!Number.isInteger(draft.memoryMb)||draft.memoryMb<512){launcherError='请输入实例名称和有效的最大内存（至少 512 MB）';renderDetail();return}
 if(!info||info.loading||info.error||draft.loader!=='vanilla'&&(!draft.loaderVersion||info.loaderLoading||info.loaderError))return;
 if(getLauncherSnapshot().actionPending.create)return;
 try{
  const instance=await createInstance({name:draft.name.trim(),gameVersion:record.gameVersion,loaders:draft.loader==='vanilla'?[]:[{kind:draft.loader as 'fabric'|'quilt'|'forge'|'neoforge'|'optifine',version:draft.loaderVersion}],memory:{minMb:Math.min(1024,draft.memoryMb),maxMb:draft.memoryMb},jvmArgs:[],gameArgs:[],window:{width:1280,height:720,fullscreen:false}});
  const job={running:true,message:'正在提交原版安装',taskId:undefined as string|undefined,error:undefined as string|undefined};installations.set(instance.id,job);
  changeCatalog(()=>{setCatalogMode('instances');const index=records.findIndex(item=>item.instanceId===instance.id);if(index>=0){select(index);openFile()}});
  try{
   const installed=await catalogCall<{taskId:string}>('launcher.version.install',{gameVersion:record.gameVersion});job.taskId=installed.taskId;job.message='安装原版与运行库';refreshLauncherPanel();await waitInstallTask(installed.taskId);
   if(draft.loader!=='vanilla'){job.message='安装 '+draft.loader;const loader=await catalogCall<{taskId:string}>('launcher.loader.install',{kind:draft.loader,gameVersion:record.gameVersion,loaderVersion:draft.loaderVersion});job.taskId=loader.taskId;refreshLauncherPanel();await waitInstallTask(loader.taskId)}
   job.message='安装完成，可启动';notify('已安装实例：'+instance.name)
  }catch(error){job.error=error instanceof Error?error.message:String(error);job.message='安装未完成，实例已保留，可修复后重试'}
  finally{job.running=false;refreshLauncherPanel()}
 }catch(error){launcherError=error instanceof Error?error.message:String(error);if(mode==='detail')renderDetail()}
}
function setVisibleText(node:Element|null,value:string){if(node&&node.textContent!==value)node.textContent=value}
function refreshLauncherPanel(){
 if(!ready||life.closed)return;
 const snapshot=getLauncherSnapshot(),account=launcherAccounts().find(item=>item.id===snapshot.selectedAccountId);
 setVisibleText($('#current-account'),account?account.name+' · '+(account.kind==='offline'?'离线':account.kind==='microsoft'?'Microsoft':'外置'):'选择启动账号');
 setVisibleText($('#launcher-connection'),snapshot.status==='error'?'数据连接异常':snapshot.connection==='connected'?'已连接':snapshot.connection==='reconnecting'?'重新连接中…':snapshot.connection==='disabled'?'实时更新已停用':'已读取');
 if(mode!=='detail')return;
 const record=currentRecord();if(record.kind!=='instance')return;
 const context=detailContext(record),job=installations.get(record.instanceId!),task=job?.taskId?snapshot.tasks.find(task=>task.id===job.taskId):undefined;
 if(job?.running&&task?.progress?.message)job.message=task.progress.message;
 setVisibleText(document.querySelector('[data-live-state]'),context.status);
 const button=document.querySelector<HTMLButtonElement>('[data-main-action]');
 if(button){
  if(button.disabled!==context.pending)button.disabled=context.pending;
  const busy=String(context.pending),action=context.running?'stop':'launch';
  if(button.getAttribute('aria-busy')!==busy)button.setAttribute('aria-busy',busy);
  if(button.dataset.action!==action)button.dataset.action=action;
  setVisibleText(button.querySelector('[data-action-label]'),launchActionLabel(context));
 }
 const feedback=document.querySelector<HTMLElement>('[data-launch-feedback]');
 if(feedback){
  let text=feedback.firstChild;if(!text||text.nodeType!==Node.TEXT_NODE){text=document.createTextNode('');feedback.prepend(text)}
  const message=context.error??(job?.running?job.message:context.pending?'正在检查启动环境…':'');if(text.textContent!==message)text.textContent=message;
  feedback.classList.toggle('is-error',Boolean(context.error));
  let cancel=feedback.querySelector<HTMLButtonElement>('[data-action="cancel-install"]');
  if(job?.running&&job.taskId&&!cancel){cancel=document.createElement('button');cancel.type='button';cancel.className='inline-button';cancel.dataset.action='cancel-install';cancel.textContent=' · 取消安装';feedback.append(cancel)}
  if(cancel)cancel.hidden=!(job?.running&&job.taskId);
 }
}
function onCatalogChange(){
 if(!ready)return;
 const wanted=catalogMemory.get(catalogState().mode)??selectedKey;
 const index=records.findIndex(record=>record.key===wanted),next=index>=0?index:0;
 const changed=records[next].key!==selectedKey;
 if(changed&&mode==='detail')setMode('archive');
 selected=next;selectedKey=records[next].key;
 updateSelection();if(changed)scene?.select(selected);
 if(mode==='detail')renderDetail();
}
function accountMarkup(){
 const snapshot=getLauncherSnapshot();return '<h2>PLAYER IDENTITY<small>启动账号</small></h2><p class="settings-intro">选择的是这个账号，不会偷偷使用列表中的另一个账号。</p><div class="launcher-account-list">'+launcherAccounts().map(account=>'<button class="launcher-account-choice" data-account="'+escapeHtml(account.id)+'" aria-pressed="'+(snapshot.selectedAccountId===account.id)+'"><span>'+escapeHtml(account.name)+'</span><span>'+escapeHtml(account.kind)+'</span></button>').join('')+'</div><form id="launcher-offline-form"><div class="launcher-fields"><label><span>OFFLINE NAME / 离线玩家名</span><input id="offline-player-name" name="name" pattern="[A-Za-z0-9_]{1,16}" maxlength="16" required placeholder="例如 Steve" /></label></div><button class="solid-button" type="submit">ADD OFFLINE PLAYER<span>添加离线账号 →</span></button><p id="account-action-result" class="launcher-action-feedback" role="status"></p></form><p class="launcher-explanation">离线账号不提供正版联机认证。微软与外置登录使用各自的认证插件，不能用离线身份冒充。</p>';
}
life.add(subscribeStatus(refreshLauncherPanel));
life.add(installLauncherData());life.add(subscribeCatalog(onCatalogChange));
void loadLauncher().then(()=>{markInstancesReady();refreshLauncherPanel()}).catch(error=>{launcherError=error instanceof Error?error.message:String(error);setInstanceCatalogError(launcherError);refreshLauncherPanel()});
function openFile() {
  if (!ready) return;
  closeModal(() => {
    const record=currentRecord();
    if(record.kind==="empty"){if(catalogState().mode==="instances")browseVersions();else void loadVersionCatalog(true);return}
    setMode("detail");
    if(record.kind==="version")inspectVersion(record);else void readCurrentMods(record);
    audio.play("open");
  });
}
function toggleSaved() {
  const id=records[selected].key;
  if (saved.has(id)) saved.delete(id);
  else saved.add(id);
  try {
    localStorage.setItem("rhine-launcher-saved", JSON.stringify([...saved]));
  } catch {}
  $("#saved-count").textContent = String(saved.size).padStart(2, "0");
  const button=document.querySelector<HTMLButtonElement>('[data-action="bookmark"]');
  if(button){button.textContent=saved.has(id)?'已收藏 −':'收藏 ＋';button.setAttribute('aria-pressed',String(saved.has(id)))}
  audio.play("confirm");
  notify(saved.has(id) ? "档案已加入收藏" : "已取消收藏");
}
function renderDetail(){
 if(!ready)return;const record=currentRecord();
 const content=$('#detail-content');if(!content)return;
 const focused=document.activeElement as HTMLInputElement|null,focusId=content.contains(focused)?focused?.id:undefined;
 const caret=focused?.selectionStart;
 tabTransition.cancel();
 content.innerHTML=launcherDetailMarkup(record,detailContext(record));content.setAttribute('tabindex','-1');
 documentDecryption.reset(content,!motionActive('documentReveal')||!scene||scene.decryptionFrame.phase==='clear');
 if(record.kind==='instance')setTab(activeTab,false);
 if(focusId){const next=document.getElementById(focusId) as HTMLInputElement|null;next?.focus({preventScroll:true});if(caret!==null&&caret!==undefined)try{next?.setSelectionRange(caret,caret)}catch{}}
 refreshLauncherPanel();
}
function overview(){return instanceOverview(currentRecord(),detailContext(currentRecord()))}
function setTab(tab:string,sound=true){
 const record=currentRecord();if(record.kind!=='instance')return;
 if(sound&&tab===activeTab)return;activeTab=tab;
 document.querySelectorAll<HTMLElement>('[data-tab]').forEach(button=>{const active=button.dataset.tab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.setAttribute('tabindex',active?'0':'-1')});
 const button=document.querySelector<HTMLElement>('[data-tab="'+tab+'"]'),indicator=document.querySelector<HTMLElement>('.tab-indicator'),panel=$('#tab-panel');if(!button||!indicator||!panel)return;
 indicator.style.transition=sound&&motionActive('surfaceTransitions')?'':'none';indicator.style.transform='translateX('+button.offsetLeft+'px) scaleX('+button.offsetWidth+')';panel.setAttribute('aria-labelledby',button.id);
 if(tab==='overview')panel.innerHTML=overview();
 else if(tab==='notes'){
  const mods=getLauncherSnapshot().mods[record.instanceId!]??[];
  panel.innerHTML='<p>'+escapeHtml(modCounts.get(record.instanceId!)?.error??(mods.length?mods.length+' 个模组':modCounts.has(record.instanceId!)?'尚未安装模组':'读取中…'))+'</p><ol class="research-notes">'+mods.slice(0,60).map(mod=>'<li><span>'+escapeHtml(mod.enabled?'ON':'OFF')+'</span>'+escapeHtml(mod.meta?.name??mod.diskName)+'</li>').join('')+'</ol><button class="inline-button" data-action="mods-management">管理模组 ↗</button> · <button class="inline-button" data-action="reveal-instance">实例目录 ↗</button>';
 }else{
  const sessions=getLauncherSnapshot().sessions.filter(session=>session.instanceId===record.instanceId);
  panel.innerHTML=''+ (sessions.length?sessions.slice(0,8).map(session=>'<div class="log-row"><span>'+escapeHtml(new Date(session.startedAt??0).toLocaleString())+'</span><span>'+escapeHtml(session.accountName??'')+'</span><b>'+escapeHtml(session.status)+'</b></div>').join(''):'<p>暂无启动记录。</p>');
 }
 panel.scrollTop=0;documentDecryption.refresh();if(sound){tabTransition.reveal(panel,!motionActive('surfaceTransitions'));audio.play('ui-tick')}
}
function notify(message: string) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
}

function openModal(kind: NonNullable<typeof modal>) {
  if (!ready) return;
  if (!modal) {
    previousFocus = document.activeElement as HTMLElement;
    modalSiblings = [...$("#stage").children]
      .filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.id !== "modal-root",
      )
      .map((node) => ({ node, inert: node.inert }));
    modalSiblings.forEach(({ node }) => (node.inert = true));
  }
  modalClosing = false;
  modal = kind;
  searchQuery = "";
  filter = "全部档案";
  audio.play("page-open");
  renderModal();
}
function closeModal(afterClose?: () => void) {
  if (!modal) {
    afterClose?.();
    return;
  }
  if (modalClosing) return;
  modalClosing = true;
  activeNativePanel?.dispose();activeNativePanel=undefined;
  audio.play("page-close");
  modalTransition!.hide(!motionActive("surfaceTransitions"), () => {
    modal = null;
    modalClosing = false;
    $("#modal-root").replaceChildren();
    modalTransition = undefined;
    modalSiblings.forEach(({ node, inert }) => (node.inert = inert));
    modalSiblings = [];
    $("#archive-ui").inert = mode !== "archive" || Boolean(workbench?.enabled);
    $("#detail-ui").inert = mode !== "detail";
    previousFocus?.focus({ preventScroll: true });
    afterClose?.();
  });
}
function renderModal() {
  if (!modal) return;
  activeNativePanel?.dispose();activeNativePanel=undefined;
  const nativeKind=modal==="account"?"accounts":modal==="mods"?"mods":modal==="packs"?"packs":undefined;
  modalTransition?.dispose();
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="terminal-modal ${nativeKind?"native-management-modal":modal === "settings" ? "settings-modal" : ""}" role="dialog" aria-modal="true" aria-label="${nativeKind?{accounts:"启动账号与认证",mods:"模组与内容市场",packs:"整合包导入"}[nativeKind]:modal === "settings" ? "系统设置" : modal === "saved" ? "收藏档案" : "档案检索"}"><div class="modal-top"><span>RHINE LAB / ${modal==="account"?"PLAYER IDENTITY":modal === "settings" ? "SYSTEM PREFERENCES" : "ARCHIVE DIRECTORY"}</span><button data-action="close-modal" aria-label="关闭窗口">关闭 <span>×</span></button></div>${nativeKind?'<div id="native-management-content"></div>':modal === "settings" ? settingsMarkup()+advancedManagementMarkup() : `<h2>${modal === "saved" ? "收藏" : "搜索"}</h2><div class="search-field"><span>⌕</span><input id="archive-search" type="search" autocomplete="off" placeholder="实例名、版本或加载器" aria-label="检索档案"/><span class="key">ESC</span></div><div class="category-filters">${categories.map((c, i) => `<button data-filter="${escapeHtml(c)}" class="${i === 0 ? "active" : ""}">${c === "全部档案" ? "全部" : escapeHtml(c)}</button>`).join("")}</div><div class="result-header"><span>名称</span><span>类型</span><span>操作</span></div><div id="search-results" class="search-results"></div><div class="modal-bottom"><span id="result-count"></span></div>`}</section></div>`;
  const backdrop = $(".modal-backdrop");
  backdrop.hidden = true;
  modalTransition = new SurfaceTransition(backdrop, $(".terminal-modal"));
  modalTransition.show(!motionActive("surfaceTransitions"));
  if (modal === "settings") updateQualitySummary();
  if(nativeKind){try{activeNativePanel=env.use<NativePanelHandle>("panel."+nativeKind,{root:$("#native-management-content"),instanceId:currentRecord().instanceId,notify})}catch(error){$("#native-management-content").textContent=error instanceof Error?error.message:String(error)}}
  if (modal !== "settings" && !nativeKind) {
    renderResults();
    requestAnimationFrame(() => {
      if (backdrop.isConnected && !modalClosing) $("#archive-search").focus();
    });
  } else
    requestAnimationFrame(() => {
      if (backdrop.isConnected && !modalClosing)
        $('[data-action="close-modal"]').focus();
    });
  $("#modal-root")
    .querySelector(".modal-backdrop")
    ?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
}
function renderResults() {
  const results=records
    .map((r,i)=>({r,i}))
    .filter(({r})=>r.kind!=="empty")
    .filter(
      ({ r }) =>
        (modal !== "saved" || saved.has(r.key)) &&
        (filter === "全部档案" || r.category === filter) &&
        `${r.id} ${r.title} ${r.en} ${r.department} ${r.lead}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
    );
  $("#search-results").innerHTML = results.length
    ? results
        .map(
          ({ r, i }) =>
            `<button class="result-row" data-result="${i}"><span class="result-name"><span>${escapeHtml(r.title)}${r.kind === "instance" ? `<small>${escapeHtml(r.en)}</small>` : ""}</span>${saved.has(r.key) ? "<i>＋</i>" : ""}</span><span>${escapeHtml(r.department)}</span><span>${r.kind==="version"?"配置":"打开"} <i>↗</i></span></button>`,
        )
        .join("")
    : `<div class="empty-results"><span>∅</span><strong>${modal === "saved" && !searchQuery ? "尚无收藏档案" : "没有匹配的档案"}</strong><p>${modal === "saved" && !searchQuery ? "在实例详情中点击「收藏」。" : "换个关键词或分组试试。"}</p><button data-action="reset-search">${modal === "saved" ? "显示全部 →" : "清除筛选 →"}</button></div>`;
  $("#result-count").textContent =
    `${results.length} 项结果`;
}
function updateQualitySummary() {
  const rendererStatus=document.querySelector<HTMLElement>("#renderer-status");if(rendererStatus){rendererStatus.textContent=rendererSwitching?"切换中…":(scene?.backendKind==="webgpu"?"WebGPU":"WebGL 2")+(rendererFallbackReason?" · 兼容回退":"");rendererStatus.title=rendererFallbackReason}
  const summary = document.querySelector("#quality-summary");
  if (!summary) return;
  if (!scene) {
    summary.textContent = "3D 已关闭 · 三维模型与渲染资源已释放";
    return;
  }
  const canvas = scene.canvas;
  const metrics = JSON.parse(
    canvas.parentElement?.dataset.renderQuality ?? "{}",
  );
  summary.textContent = `${superPerformanceEnabled() ? "超级性能模式已启用 · 画质设置暂被覆盖，关闭后恢复 · " : ""}实际渲染 ${canvas.width} × ${canvas.height} · ${effectiveRenderQuality().antialias === "smaa" ? "SMAA" : "原始抗锯齿"} · 纹理 ${metrics.anisotropy ?? 1}×${metrics.limited ? " · 已达到缓冲上限" : ""}`;
}
function motionPreferenceNoteMarkup() {
  const preset = prefs.motionPreset;
  const allEnabled = Object.values(prefs.motion).every(Boolean);
  return `<div id="motion-preference-note" class="motion-preference-note"><p>${motionSummary(prefs.motion)}</p><span>预设：${preset === "full" ? "完整动画" : preset === "reduced" ? "减少动画" : "自定义"} · 选择会保存在本站</span>${allEnabled ? "" : '<button data-action="enable-motion">启用完整动画并重播 ↻</button>'}</div>`;
}
function advancedManagementMarkup(){return '<div class="native-tabs"><button data-action="account-settings">账号认证 ↗</button><button data-action="mods-management">模组与内容市场 ↗</button><button data-action="packs-management">整合包导入 ↗</button></div>'}
function renderingBackendMarkup(){return '<div class="launcher-fields"><label>渲染器<select id="renderer-backend">'+[["auto","自动"],["webgpu","WebGPU"],["webgl2","WebGL 兼容"]].map(([value,label])=>'<option value="'+value+'"'+(prefs.rendererBackend===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label><span id="renderer-status" role="status">'+escapeHtml(rendererSwitching?"切换中…":(scene?.backendKind==="webgpu"?"WebGPU":"WebGL 2")+(rendererFallbackReason?" · 兼容回退":""))+'</span></div>'}
function settingsMarkup() {
  return `<h2>设置</h2>${isWallpaper ? '<p class="wallpaper-settings-note">每次启动都会读取 Wallpaper Engine 中的设置。在此修改仅对当前运行生效，无法持久保存；如需保留，请在 Wallpaper Engine 的壁纸属性中调整。</p>' : ""}<div class="settings-list">${themeSettingsMarkup(prefs.colorTheme === "dark")}${!isWallpaper ? `<label><div><strong>高性能模式</strong><span>降低画质与分辨率，保留动画；关闭后恢复</span></div><input type="checkbox" data-pref="superPerformance" ${prefs.superPerformance ? "checked" : ""}/><i class="toggle"></i></label>` : ""}${workbench?.settingsMarkup() ?? ""}${audioSettingsMarkup(prefs)}</div>${motionPreferenceNoteMarkup()}${motionSettingsMarkup(prefs.motion, prefs.motionPreset)}${renderingBackendMarkup()}${qualityMarkup(prefs.rendering)}<div class="settings-shortcuts">${isWallpaper ? "<span>桌面操作</span><p>拖动阵列或点击界面按钮浏览档案。桌面模式下，方向键与滚轮可能无法传入壁纸。</p>" : "<span>快捷键</span><p><kbd>←</kbd><kbd>→</kbd> 切列 <kbd>↑</kbd><kbd>↓</kbd> 选档 <kbd>ENTER</kbd> 读取 <kbd>/</kbd> 检索 <kbd>ESC</kbd> 返回</p>"}</div><div class="settings-bottom">${!isWallpaper && document.fullscreenEnabled ? '<button data-action="fullscreen">全屏 <span>↗</span></button>' : ""}<button data-action="restart">重播入场 <span>↻</span></button></div><div class="modal-bottom"><span>MiSans（小米） <a href="${assetUrl("fonts/MiSans-license.pdf")}" target="_blank" rel="noopener">字体许可</a></span><span>POWERED BY RHINE LAB</span></div>`;
}

listen(document, "input", (e) => {
  const slider = e.target as HTMLInputElement;
  if (slider.dataset.quality) {
    const output = document.querySelector<HTMLOutputElement>(
      `[data-quality-output="${slider.dataset.quality}"]`,
    );
    if (output) output.value = `${slider.value}%`;
  }
  const volume = e.target as HTMLInputElement;
  if (
    volume.dataset.volume === "musicVolume" ||
    volume.dataset.volume === "soundVolume"
  ) {
    prefs[volume.dataset.volume] = Number(volume.value) / 100;
    volume
      .closest("label")
      ?.querySelector("output")
      ?.replaceChildren(`${volume.value}%`);
    saveAudioPrefs();
  }
  if ((e.target as HTMLElement).id === "archive-search") {
    searchQuery = (e.target as HTMLInputElement).value;
    renderResults();
  }
});
listen(document, "change", (e) => {
  const el = e.target as HTMLInputElement;
  if(el.id==="renderer-backend"){prefs.rendererBackend=rendererPreference(el.value);saveAudioPrefs();void switchRenderer(prefs.rendererBackend);return}
  if (el.id === "quality-preset" && Object.hasOwn(qualityPresets, el.value)) {
    prefs.rendering = { ...qualityPresets[el.value as QualityPreset] };
    savePrefs();
  } else if (el.dataset.quality) {
    const key = el.dataset.quality as keyof RenderQuality;
    prefs.rendering = normalizeQuality({
      ...prefs.rendering,
      [key]: key === "antialias" ? el.value : Number(el.value),
    });
    savePrefs();
  }
  if (el.dataset.pref) {
    const key = el.dataset.pref;
    if (
      key === "sound" ||
      key === "music" ||
      key === "quality" ||
      key === "superPerformance"
    )
      prefs[key] = el.checked;
    if (key === "sound" || key === "music") saveAudioPrefs();
    else savePrefs();
    audio.play("confirm");
  }
  if (el.dataset.motion) {
    const key = el.dataset.motion as MotionKey;
    prefs.motion[key] = el.checked;
    prefs.motionPreset = motionPresetFor(prefs.motion);
    savePrefs();
    const motionRoot = $("#motion-settings");
    const advancedOpen =
      motionRoot.querySelector<HTMLDetailsElement>(".motion-advanced")?.open ??
      false;
    const settingsPanel = motionRoot.closest<HTMLElement>(".settings-modal");
    const scrollTop = settingsPanel?.scrollTop ?? 0;
    motionRoot.outerHTML = motionSettingsMarkup(
      prefs.motion,
      prefs.motionPreset,
    );
    $("#motion-preference-note").outerHTML = motionPreferenceNoteMarkup();
    $("#motion-settings").querySelector<HTMLDetailsElement>(
      ".motion-advanced",
    )!.open = advancedOpen;
    requestAnimationFrame(() => {
      if (settingsPanel) settingsPanel.scrollTop = scrollTop;
      document
        .querySelector<HTMLInputElement>(`[data-motion="${key}"]`)
        ?.focus({ preventScroll: true });
    });
    notify(
      key === "boot"
        ? "开场设置将在下次重播时生效"
        : el.checked
          ? "已启用此动画"
          : "已关闭此动画",
    );
    audio.play("confirm");
  }
});
listen(document, 'input',event=>{
 const input=event.target as HTMLInputElement,record=currentRecord();if(record.kind!=='version')return;
 const draft=getDraft(record);
 if(input.id==='instance-name')draft.name=input.value;
 if(input.id==='instance-memory')draft.memoryMb=Number(input.value);
});
listen(document, 'change',event=>{
 const input=event.target as HTMLSelectElement;
 if(input.id==='version-family'){changeCatalog(()=>filterVersions(catalogState().channel,input.value));return}
 if(input.id==='launcher-account-select'){try{setSelectedAccount(input.value)}catch(error){notify(String(error))}return}
 const record=currentRecord();if(record.kind!=='version')return;
 if(input.id==='instance-loader'){getDraft(record).loader=input.value;void loadCompatibleBuilds(record)}
 if(input.id==='instance-loader-version')getDraft(record).loaderVersion=input.value;
});
listen(document, 'submit',event=>{
 const form=event.target as HTMLFormElement;if(form.id!=='launcher-offline-form')return;event.preventDefault();
 const name=(form.querySelector('#offline-player-name') as HTMLInputElement)?.value??'';
 const button=form.querySelector('button')!;button.disabled=true;
 void addOfflineAccount(name).then(()=>{if(modal==='account')renderModal();if(mode==='detail')renderDetail();refreshLauncherPanel()}).catch(error=>{const status=form.querySelector('#account-action-result');if(status)status.textContent=error instanceof Error?error.message:String(error)}).finally(()=>{if(button.isConnected)button.disabled=false});
});

listen(document, "click", (e) => {
  const themeButton = (e.target as Element).closest<HTMLElement>(
    "[data-color-theme]",
  );
  if (themeButton) {
    prefs.colorTheme =
      themeButton.dataset.colorTheme === "dark" ? "dark" : "light";
    savePrefs();
    return;
  }
  if (!started) return;
  if (modalClosing) return;
  const el = (e.target as Element).closest<HTMLElement>("button");
  if (!el) return;
  if (el.dataset.action === "motion-preset") {
    const preset = el.dataset.preset;
    if (preset !== "full" && preset !== "reduced") return;
    prefs.motionPreset = preset;
    prefs.motion = preset === "full" ? fullMotion() : reducedMotion();
    savePrefs();
    renderModal();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `[data-action="motion-preset"][data-preset="${prefs.motionPreset}"]`,
        )
        ?.focus({ preventScroll: true }),
    );
    audio.play("confirm");
    return;
  }
  if (el.dataset.select) {
    select(Number(el.dataset.select));
    return;
  }
  if (el.dataset.result) {
    const index = Number(el.dataset.result);
    closeModal(() => {
      select(index);
      openFile();
    });
    return;
  }
  if (el.dataset.filter) {
    filter = el.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) =>
        b.classList.toggle(
          "active",
          (b as HTMLElement).dataset.filter === filter,
        ),
      );
    renderResults();
    return;
  }
  if (el.dataset.tab) {
    setTab(el.dataset.tab);
    return;
  }
  if(el.dataset.account){try{setSelectedAccount(el.dataset.account);renderModal();refreshLauncherPanel()}catch(error){notify(error instanceof Error?error.message:String(error))}return}
  if(el.dataset.channel){const channel=el.dataset.channel as "release"|"snapshot"|"history";changeCatalog(()=>filterVersions(channel));return}
  const action=el.dataset.action;
  if(action==="catalog-instances"){changeCatalog(()=>setCatalogMode("instances"));return}
  if(action==="browse-versions"){browseVersions();return}
  if(action==="refresh-versions"){void loadVersionCatalog(true);return}
  if(action==="reload-launcher"){void loadLauncher().then(markInstancesReady).catch(error=>notify(String(error)));return}
  if(action==="account-settings"){openModal("account");return}
  if(action==="mods-management"){openModal("mods");return}
  if(action==="packs-management"){openModal("packs");return}
  if(action==="create-install"){void createAndInstall();return}
  if(action==="cancel-install"){const job=installations.get(currentRecord().instanceId??"");if(job?.running&&job.taskId)void catalogCall("launcher.task.cancel",{id:job.taskId}).catch(error=>notify(String(error)));return}
  if(action==="inspect-retry"){inspectVersion(currentRecord(),true);return}
  if(action==="reveal-instance"){const path=currentRecord().instance?.path;if(path)void revealPath(path).catch(error=>notify(String(error)));return}
  if (action === "toggle-three") {
    void toggleThree();
    return;
  }
  if (action === "sound-preview") audio.play("confirm");
  if (action === "skip") {
    setMode("archive");
    audio.play("confirm");
  }
  if (action === "prev") stepFile(-1);
  if (action === "next") stepFile(1);
  if (action === "column-prev") stepColumn(-1);
  if (action === "column-next") stepColumn(1);
  if (action === "open") openFile();
  if (action === "model-viewer" && mode === "detail" && scene) {
    const activeScene = scene;
    // Safari does not always focus a button when it is tapped. Capture the
    // actual opener so closing the modal reliably restores the right control.
    el.focus({ preventScroll: true });
    viewer ??= new ModelViewer(
      $("#stage"),
      () => {
        audio.setScene(mode);
        audio.play("page-close");
      },
      (sound) => audio.play(sound === "tick" ? "ui-tick" : sound),
    );
    audio.setScene("viewer");
    viewer.setSuperPerformance(superPerformanceEnabled());
    viewer.setQuality(effectiveRenderQuality());
    viewer.setMotion(prefs.motion);
    scene.finishDecryption();
    viewer.open(
      records[selected].id,
      records[selected].title,
      () => activeScene.createAssemblyModel(),
      !motionActive("viewerNavigation"),
    );
    audio.play("page-open");
  }
  if (action === "launch") { void handleLaunch(); return; }
  if (action === "stop") { void handleStop(); return; }
  if (action === "back") {
    setMode("archive");
    audio.play("back");
  }
  if (action === "search" || action === "saved" || action === "settings") {
    el.focus({ preventScroll: true });
    openModal(action);
  }
  if (action === "close-modal") closeModal();
  if (action === "bookmark") toggleSaved();
  if (action === "reset-search") {
    modal = "search";
    searchQuery = "";
    filter = "全部档案";
    renderModal();
  }
  if (action === "replay" || action === "restart") {
    replayBoot();
  }
  if (action === "enable-motion") {
    prefs.motion = fullMotion();
    prefs.motionPreset = "full";
    savePrefs();
    replayBoot();
  }
  if (action === "fullscreen" && document.fullscreenEnabled) {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => notify("请使用浏览器的全屏快捷键 F11"));
  }
});
listen(document, "keydown", (e) => {
  if (!started) return;
  if (viewer?.isOpen) return;
  if (playground?.active && !modal) {
    if (e.key === "Escape") {
      e.preventDefault();
      playground.stop();
    } else if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Enter",
        "/",
      ].includes(e.key) &&
      !(e.target instanceof HTMLButtonElement)
    )
      e.preventDefault();
    return;
  }
  if (modalClosing) {
    e.preventDefault();
    return;
  }
  const typing=e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement||(e.target instanceof HTMLElement&&e.target.isContentEditable);
  if (e.key === "Escape") {
    if (modal) closeModal();
    else if (mode === "detail" || (mode === "boot" && ready)) {
      const sound = mode === "detail" ? "back" : "ui-tick";
      setMode("archive");
      audio.play(sound);
    }
    return;
  }
  if (modal && e.key === "Tab") {
    const focusables = [
      ...$("#modal-root").querySelectorAll<HTMLElement>(
        'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
      ),
    ];
    const visible = focusables.filter(
      (el) =>
        el.tabIndex >= 0 &&
        !el.matches(":disabled") &&
        el.getClientRects().length > 0,
    );
    const first = visible[0],
      last = visible.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
    return;
  }
  if (typing || modal || !ready) return;
  if (
    (e.target as HTMLElement).dataset.tab &&
    ["ArrowLeft", "ArrowRight"].includes(e.key)
  ) {
    e.preventDefault();
    const tabs = ["overview", "notes", "history"];
    setTab(
      tabs[(tabs.indexOf(activeTab) + (e.key === "ArrowRight" ? 1 : 2)) % 3],
    );
    $<HTMLButtonElement>(`[data-tab="${activeTab}"]`).focus();
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    if (mode === "boot") setMode("archive");
    openModal("search");
  }
  if (e.key === "Home" && isGamepadEvent(e) && mode === "archive" && !modal) {
    e.preventDefault();
    openModal("saved");
  }
  if (e.key === "ArrowLeft" && mode !== "boot") {
    e.preventDefault();
    stepColumn(-1);
  }
  if (e.key === "ArrowRight" && mode !== "boot") {
    e.preventDefault();
    stepColumn(1);
  }
  if (["ArrowUp", "ArrowDown"].includes(e.key) && mode !== "boot") {
    e.preventDefault();
    stepFile(e.key === "ArrowUp" ? -1 : 1);
  }
  if (
    e.key === "Enter" &&
    (document.activeElement === document.body ||
      document.activeElement?.id === "detail-content" ||
      ["prev", "next", "column-prev", "column-next"].includes(
        (document.activeElement as HTMLElement)?.dataset.action ?? "",
      ) ||
      (document.activeElement as HTMLElement)?.dataset.select)
  ) {
    e.preventDefault();
    if (mode === "boot") setMode("archive");
    else if (mode === "archive") openFile();
  }
});

const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
function bootFrame(t: number) {
  if (isWallpaper && !scene && frozenTime === null && t >= 21.9) {
    setMode("archive");
    return undefined;
  }
  if (
    isWallpaper &&
    frozenTime === null &&
    t >= ARRAY_OPENING_END &&
    !openingShowsDetail(
      wallpaperHost()?.properties.openingdetail?.value,
      !!workbench?.enabled,
    )
  ) {
    setMode("archive");
    return undefined;
  }
  audio.updateBoot(t, frozenTime !== null);
  const motion = bootSequence.update(t);
  if (workbench?.enabled && frozenTime === null) {
    const end = openingShowsDetail(
      wallpaperHost()?.properties.openingdetail?.value,
      true,
    )
      ? 35
      : ARRAY_OPENING_END;
    if (t > end - 0.35)
      $(".powered").style.opacity = String(1 - ease((t - end + 0.35) / 0.35));
  }
  let step: string = motion.step;
  if (t >= 22) {
    step = "array";
  }
  if (t >= 25.68) {
    step = "select";
  }
  if (t >= 28.3) {
    step = "inspect";
  }
  if (step !== lastStep) {
    $("#stage").dataset.boot = step;
    lastStep = step;
  }
  $(".file-title").firstChild!.textContent =
    step === "array"
      ? "SELECTING FILES...".slice(0, Math.max(0, Math.floor((t - 21.94) * 18)))
      : " ";
  $("#stage").style.setProperty(
    "--entry-opacity",
    String(ease((t - 21.9) / 0.13)),
  );
  $(".callout-rule").style.transform = `scaleX(${ease((t - 22.08) / 0.9)})`;
  const reveal = ease((t - 22) / 0.4),
    lift = ease((t - 26) / 1.8),
    zoom = 0.55 * ease((t - 27.3) / 1.65) + 0.45 * ease((t - 29.0) / 5.0);
  if (t >= 35) {
    setMode("detail");
    return undefined;
  }
  return { reveal, lift, zoom, time: t };
}

const inspectionOverlay = new InspectionOverlay();
life.add(()=>inspectionOverlay.dispose());
const projectInspection=(x:number,y:number)=>scene!.projectCard(x,y);
const stageNode=$("#stage"),detailNode=$("#detail-content");
const documentDecryption = new DocumentDecryption();
// A newly opened archive can introduce another font shard. Re-measure its
// redaction lines after font swap while retaining the current reveal progress.
listen(document.fonts, "loadingdone", () =>
  documentDecryption.refresh(),
);

let lastTime = 0,
  frameCount = 0,
  frameStart = performance.now(),
  fps = 0;
let renderedFps=0,lastRenderedFrames=0;
function frame(ms: number) {
  if (!wallpaperFrame(ms)) {
    requestAnimationFrame(frame);
    return;
  }
  if (document.hidden) {
    requestAnimationFrame(frame);
    return;
  }
  workbench?.tick();
  const time = ms / 1000;
  const theme = scene?.themeAmount ?? (prefs.colorTheme === "dark" ? 1 : 0);
  paintTheme(theme);
  viewer?.setTheme(theme);
  playground?.tick(time);
  const cinema =
    mode === "boot" && ready
      ? bootFrame(frozenTime ?? time - bootStart)
      : undefined;
  wallpaperEffects?.update(
    time,
    motionIsReduced(),
    motionActive("pointerParallax"),
  );
  // The calibrated 2D opening fully covers the scene until array entry.
  if (!viewer?.isOpen && (!cinema || cinema.time >= 21.9))
    scene?.update(time, cinema);
  viewer?.update(time);
  // Drag traversal may cross many real cells within one frame; only its final text is paintable.
  if(selectionUiDirty){selectionUiDirty=false;updateSelection(selectionUiNavigation);selectionUiNavigation=undefined}
  if(pendingCatalogChange&&mode==="archive"&&(!scene||scene.readyForCatalogChange)){const apply=pendingCatalogChange;pendingCatalogChange=null;apply()}
  if (threeState === "closing" && scene?.presentationHidden) releaseThree();
  playground?.position();
  if (scene && mode === "detail") {
    documentDecryption.update(
      time,
      scene.decryptionFrame,
      !motionActive("documentReveal"),
    );
    const opacity=String(scene.detailVisibility),translate=`0 ${(1-scene.detailVisibility)*18}px`,inert=scene.detailVisibility<0.1;
    if(detailNode.style.opacity!==opacity)detailNode.style.opacity=opacity;
    if(detailNode.style.translate!==translate)detailNode.style.translate=translate;
    if(detailNode.inert!==inert)detailNode.inert=inert;
    if (
      pendingDetailFocus &&
      scene.detailVisibility >= 0.1 &&
      !modal &&
      !viewer?.isOpen
    ) {
      $("#detail-content").focus({ preventScroll: true });
      pendingDetailFocus = false;
    }
  }
  const shade=String(mode==="boot"?0:(scene?.detailVisibility??0));
  if(stageNode.style.getPropertyValue("--detail-shade")!==shade)stageNode.style.setProperty("--detail-shade",shade);
  const currentScene = scene;
  if (currentScene)
    inspectionOverlay.render(
      currentScene.decryptionFrame,
      projectInspection,
      Boolean(cinema),
      motionActive("modelDecryption"),
    );
  if (Math.floor(time) !== lastTime) {
    lastTime = Math.floor(time);
    updateFooterClock(new Date(), motionActive("rollingNumbers"));
  }
  frameCount++;
  if (ms - frameStart > 1000) {
    fps = (frameCount * 1000) / (ms - frameStart);
    const drawn=scene?.renderedFrameCount??0;renderedFps=Math.max(0,drawn-lastRenderedFrames)*1000/(ms-frameStart);lastRenderedFrames=drawn;
    frameStart = ms;
    frameCount = 0;
    $("#three-scene").dataset.fps=String(Math.round(renderedFps));
    $("#three-scene").dataset.uiFps=String(Math.round(fps));
    // Full diagnostics traverse the model; keep them explicit rather than a periodic interaction hitch.
    if(reviewParams.has("stats"))$("#three-scene").dataset.renderStats=JSON.stringify(scene?.getStats()??{loaded:false,drawCalls:0,triangles:0});
  }
  requestAnimationFrame(frame);
}
function bindScene(scene: ArchiveScene, cell?: { lane: number; row: number }) {
  scene.onActivate=(index,cell)=>{if(mode!=="archive"||modal||viewer?.isOpen)return;select(index,cell?{cell}:undefined);openFile()};
  scene.select(selected, cell ? { cell } : undefined);
  scene.onSelect = (i, cell) => {
    if (mode !== "archive" || modal || viewer?.isOpen) return;
    select(i,cell?{cell}:undefined,true);
  };
  scene.onNavigate = (axis, direction) => {
    if (mode !== "archive" || modal || viewer?.isOpen) return;
    if (axis === "lane") stepColumn(direction);
    else stepFile(direction);
  };
  scene.onHover = (i) => {
    const label = $("#hover-label");
    if (i === null) {
      label.hidden = true;
      hoverCode.finish();
      hoverTitle.finish();
      return;
    }
    const animated = motionActive("rollingText") && mode === "archive";
    const numbersAnimated =
      motionActive("rollingNumbers") && mode === "archive";
    hoverCode.update({
      value: Number(records[i].id.slice(2)),
      animated: !label.hidden && numbersAnimated,
    });
    hoverTitle.update({
      text: records[i].title,
      animated: !label.hidden && animated,
    });
    label.hidden = false;
    // Prepare the first visible value so the next hover can animate immediately.
    hoverCode.update({ animated: numbersAnimated });
    hoverTitle.update({ animated });
  };
}
function syncThreeButton() {
  $("#stage").dataset.threeState = threeState;
  syncWallpaperBackground();
  const button = document.querySelector<HTMLButtonElement>(
    '[data-action="toggle-three"]',
  );
  if (!button) return;
  button.textContent =
    threeState === "loading"
      ? "3D 载入中…"
      : threeState === "closing"
        ? "3D 关闭中…"
        : threeState === "off"
          ? "3D 关闭"
          : "3D 开启";
  button.disabled = threeState === "loading";
  button.setAttribute("aria-pressed", String(threeState === "on"));
  button.title =
    threeState === "off"
      ? "重新载入三维模型"
      : threeState === "closing"
        ? "取消关闭，恢复三维画面"
        : "卸载三维模型，保留 2D 界面";
}
function releaseThree() {
  if (!scene) return;
  resumeCell = { ...scene.getStats().selectedCell };
  resumeSelection = selected;
  viewer?.dispose();
  viewer = undefined;
  scene.dispose();
  scene = undefined;
  if (mode === "detail") {
    $("#detail-content").style.opacity = "1";
    $("#detail-content").style.translate = "0 0";
    $("#detail-content").inert = false;
    documentDecryption.reset($("#detail-content"), true);
  }
  threeState = "off";
  syncThreeButton();
  $("#hover-label").hidden = true;
  delete $("#three-scene").dataset.renderQuality;
  updateQualitySummary();
}
let rendererSwitching=false,rendererFallbackReason='',rendererChange:AbortController|undefined;
function configureCandidate(candidate:ArchiveScene){candidate.setMotion(prefs.motion);candidate.setTheme(prefs.colorTheme==='dark',true);candidate.setArchiveCoverage(wallpaperHost()?.properties.archivecoverage?.value==='extra');candidate.setSuperPerformance(superPerformanceEnabled());candidate.setQuality(effectiveRenderQuality());candidate.resize()}
async function createPreferredScene(preference:RendererPreference,signal:AbortSignal):Promise<ArchiveScene>{
 const native=shouldTryNative(preference,Boolean(navigator.gpu),effectiveRenderQuality(),superPerformanceEnabled());let factory:ArchiveBackendFactory;
 if(native){try{factory=await env.use<Promise<ArchiveBackendFactory>>('renderer.webgpu.create',{signal});rendererFallbackReason=''}catch(error){signal.throwIfAborted();rendererFallbackReason=error instanceof Error?error.message:String(error);factory=env.use<ArchiveBackendFactory>('renderer.webgl.create')}}
 else{if(preference==='webgpu')rendererFallbackReason=nativeQualitySupported(effectiveRenderQuality(),superPerformanceEnabled())?'当前浏览器无可用 WebGPU':'该透射分辨率使用完整兼容渲染';factory=env.use<ArchiveBackendFactory>('renderer.webgl.create')}
 signal.throwIfAborted();let allocated:ArchiveBackend|undefined,candidate:ArchiveScene;
 try{candidate=new ArchiveScene($('#three-scene'),undefined,undefined,undefined,(...args)=>{allocated=factory(...args);return allocated})}catch(error){allocated?.dispose();throw error}
 const dispose=candidate.dispose.bind(candidate),abort=()=>candidate.dispose();candidate.dispose=()=>{signal.removeEventListener('abort',abort);dispose()};signal.addEventListener('abort',abort,{once:true});if(signal.aborted){candidate.dispose();signal.throwIfAborted()}
 candidate.setBackendLossHandler(reason=>{if(!life.closed&&!env.signal.aborted&&ready&&scene===candidate&&!rendererSwitching)void switchRenderer('webgl2',reason)});return candidate
}
async function prepareStartupScene(){if(!scene)return;try{savePrefs();await scene.prepareFirstFrame()}catch(error){if(life.closed||env.signal.aborted)throw error;if(scene.backendKind!=='webgpu')throw error;rendererFallbackReason=error instanceof Error?error.message:String(error);scene.dispose();scene=await createPreferredScene('webgl2',env.signal);await scene.load();bindScene(scene);configureCandidate(scene);await scene.prepareFirstFrame();savePrefs()}}
async function switchRenderer(preference:RendererPreference,reason=''){
 if(life.closed||env.signal.aborted)return;rendererChange?.abort();const controller=rendererChange=new AbortController(),signal=AbortSignal.any([env.signal,controller.signal]);rendererSwitching=true;rendererFallbackReason=reason;updateQualitySummary();let candidate:ArchiveScene|undefined;const previous=scene;
 try{candidate=await createPreferredScene(preference,signal);candidate.canvas.style.visibility='hidden';await candidate.load();configureCandidate(candidate);candidate.select(selected);candidate.setMode(mode==='detail'?'detail':mode==='boot'?'hidden':'archive');candidate.revealImmediately();try{await candidate.prepareFirstFrame()}catch(error){signal.throwIfAborted();if(candidate.backendKind!=='webgpu')throw error;rendererFallbackReason=error instanceof Error?error.message:String(error);candidate.dispose();candidate=await createPreferredScene('webgl2',signal);candidate.canvas.style.visibility='hidden';await candidate.load();configureCandidate(candidate);candidate.select(selected);candidate.setMode(mode==='detail'?'detail':mode==='boot'?'hidden':'archive');candidate.revealImmediately();await candidate.prepareFirstFrame()}
 signal.throwIfAborted();viewer?.close();previous?.dispose();scene=candidate;candidate=undefined;bindScene(scene);scene.canvas.style.visibility='';threeState='on';syncThreeButton();updateQualitySummary()
 }catch(error){candidate?.dispose();if(!signal.aborted){rendererFallbackReason=error instanceof Error?error.message:String(error);notify('渲染器切换失败：'+rendererFallbackReason)}}finally{if(rendererChange===controller){rendererSwitching=false;updateQualitySummary()}}
}
life.add(()=>rendererChange?.abort());

async function toggleThree() {
  if (!isWallpaper || !ready || threeState === "loading") return;
  if (threeState === "closing") {
    scene?.setPresentationVisible(true, !motionActive("surfaceTransitions"));
    threeState = "on";
    syncThreeButton();
    return;
  }
  if (scene) {
    playground?.stop();
    threeState = "closing";
    syncThreeButton();
    scene.setPresentationVisible(false, !motionActive("surfaceTransitions"));
    if (!motionActive("surfaceTransitions")) releaseThree();
    return;
  }
  threeState = "loading";
  syncThreeButton();
  let next: ArchiveScene | undefined;
  try {
    next = await createPreferredScene(prefs.rendererBackend,env.signal);
    next.canvas.style.opacity = "0";
    next.setPresentationVisible(false, true);
    await next.load();
    next.setMode(mode === "detail" ? "detail" : "archive");
    bindScene(next, resumeSelection === selected ? resumeCell : undefined);
    next.revealImmediately();
    scene = next;
    scene.setTheme(prefs.colorTheme === "dark", true);
    scene.setArchiveCoverage(
      wallpaperHost()?.properties.archivecoverage?.value === "extra",
    );
    await prepareStartupScene();
    scene!.setPresentationVisible(true, !motionActive("surfaceTransitions"));
    threeState = "on";
    syncThreeButton();
  } catch (error) {
    next?.dispose();
    scene = undefined;
    threeState = "off";
    syncThreeButton();
    notify("三维模型载入失败，请点击 3D 关闭重试。");
    console.error(error);
  }
}

async function start() {
  try {
    if (isWallpaper) await window.rhineWallpaperPropertiesReady;
    if (
      !isWallpaper ||
      wallpaperHost()?.properties.load3donstartup?.value !== false
    ) {
      scene = await createPreferredScene(prefs.rendererBackend,env.signal);
      scene.setTheme(prefs.colorTheme === "dark", true);
      scene.setArchiveCoverage(
        wallpaperHost()?.properties.archivecoverage?.value === "extra",
      );
    } else {
      threeState = "off";
      syncThreeButton();
    }
    // The webfont is an enhancement: a missing MiSans shard (or a browser that
    // rejects a font request) must never block the launcher from starting.
    await Promise.all([
      scene?.load(),
      loadBootWebfonts().catch(() => false),
      ...["300", "400", "600", "700"].map((weight) =>
        document.fonts
          .load(weight + " 20px MiSans", "ACCESS 0123456789")
          .catch(() => []),
      ),
    ]);
    if(life.closed){scene?.dispose();return}
    if (scene) bindScene(scene);
    await prepareStartupScene();
    if(life.closed){scene?.dispose();return}
    ready=true;
    if(getLauncherSnapshot().status==="ready")markInstancesReady();select(Math.max(0,records.findIndex(record=>record.key===selectedKey)));
    refreshLauncherPanel();
    if (entry) entry.ready();
    else {
      if (isWallpaper) {
        // CEF allows automatic audio; never block the visual on audio policy or decoding.
        await Promise.race([
          audio.unlock(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
      completeStartup(false);
    }
  } catch (error) {
    if(life.closed){scene?.dispose();return}
    console.error(error);
    $("#loading").innerHTML =
      '<div class="error-state"><strong>CONNECTION INTERRUPTED</strong><p>三维档案资源未能载入。请确认浏览器已启用硬件加速，然后重新连接。</p><button onclick="location.reload()">RECONNECT →</button></div>';
  }
}
function completeStartup(silent: boolean) {
  if(life.closed)return;
  if (started || !ready) return;
  started = true;
  if (silent) {
    prefs.sound = false;
    prefs.music = false;
    saveAudioPrefs();
  }
  audio.releaseEntry();
  audio.restartBoot();
  const fade = motionActive("boot") ? 600 : 0;
  bootStart =
    performance.now() / 1000 -
    (reviewParams.has("time") ? Number(reviewParams.get("time")) : 1.76);
  if (!reviewParams.has("time")) bootStart += fade / 1000;
  setMode("boot");
  if (
    reviewParams.get("scene") === "archive" ||
    (!motionActive("boot") && !reviewParams.has("time"))
  )
    setMode("archive");
  if (reviewParams.get("scene") === "detail") setMode("detail");
  if (isWallpaper && wallpaperHost()?.properties.boot?.value === false)
    setMode("archive");
  $("#stage").inert = false;
  $(".mobile-entry").inert = false;
  loading.classList.add("loaded");
  loading.inert = true;
  setTimeout(() => {
    const restoreFocus =
      loading.contains(document.activeElement) ||
      document.activeElement === document.body;
    loading.remove();
    if (entry && restoreFocus) {
      const skip = $("#skip");
      const target =
        mode === "boot"
          ? skip.getClientRects().length
            ? skip
            : $(".mobile-entry")
          : $(".read-file");
      target.focus({ preventScroll: true });
    }
  }, fade);
  requestAnimationFrame(frame);
  // Do not compete with entry audio/font downloads. Full offline installation
  // begins after startup is complete and remains atomic.
  // No upstream website service worker is installed on the local launcher origin.
}
updateSelection();
const customBackground = isWallpaper
  ? new WallpaperBackground($("#stage"), notify)
  : undefined;
function syncWallpaperBackground(retry = false) {
  customBackground?.update(
    wallpaperHost()?.properties ?? {},
    mode !== "boot" && (threeState === "off" || threeState === "loading"),
    !motionActive("surfaceTransitions"),
    retry,
  );
}
if (isWallpaper) {
  const apply = (properties: WallpaperProperties) => {
    const theme = properties.colortheme?.value;
    if (theme === "light" || theme === "dark") prefs.colorTheme = theme;
    scene?.setArchiveCoverage(
      properties.archivecoverage?.value === "extra" ||
        wallpaperHost()?.properties.archivecoverage?.value === "extra",
    );
    for (const key of ["sound", "music"] as const)
      if (typeof properties[key]?.value === "boolean")
        prefs[key] = properties[key].value as boolean;
    if (typeof properties.reduced?.value === "boolean") {
      prefs.motion = properties.reduced.value ? reducedMotion() : fullMotion();
      prefs.motionPreset = motionPresetFor(prefs.motion);
    }
    for (const key of ["soundVolume", "musicVolume"] as const) {
      const value = properties[key.toLowerCase()]?.value;
      if (typeof value === "number" && Number.isFinite(value))
        prefs[key] = Math.max(0, Math.min(1, value / 100));
    }
    const qualityProperties = { ...wallpaperHost()?.properties, ...properties };
    if (
      Object.keys(properties).some(
        (key) => key === "renderquality" || key.startsWith("quality"),
      )
    )
      prefs.rendering = wallpaperQuality(qualityProperties, prefs.rendering);
    savePrefs();
    if (
      properties.customwallpaperfile ||
      properties.customwallpaper?.value === true
    )
      syncWallpaperBackground(true);
    if (properties.boot?.value === false && started && mode === "boot")
      setMode("archive");
    // Keep an already-open settings surface in sync without replacing focused controls.
    document
      .querySelectorAll<HTMLInputElement>("[data-pref]")
      .forEach((input) => {
        const key = input.dataset.pref as
          "sound" | "music" | "quality" | "superPerformance";
        if (key in prefs) input.checked = prefs[key];
      });
    document
      .querySelectorAll<HTMLInputElement>("[data-motion]")
      .forEach((input) => {
        input.checked = prefs.motion[input.dataset.motion as MotionKey];
      });
    document
      .querySelectorAll<HTMLElement>('[data-action="motion-preset"]')
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.preset === prefs.motionPreset),
        );
      });
    const note = document.querySelector("#motion-preference-note");
    if (note) note.outerHTML = motionPreferenceNoteMarkup();
    for (const key of ["soundVolume", "musicVolume"] as const) {
      const input = document.querySelector<HTMLInputElement>(
        `[data-volume="${key}"]`,
      );
      if (input) {
        input.value = String(Math.round(prefs[key] * 100));
        input
          .closest("label")
          ?.querySelector("output")
          ?.replaceChildren(`${input.value}%`);
      }
    }
  };
  listen(window, "rhine-wallpaper-properties", (event) =>
    apply((event as CustomEvent<WallpaperProperties>).detail),
  );
  let pausedAt: number | undefined;
  const pause = () => {
    const paused = wallpaperHost()?.paused ?? false;
    if (paused && pausedAt === undefined) pausedAt = performance.now();
    if (!paused && pausedAt !== undefined) {
      if (started && mode === "boot")
        bootStart += (performance.now() - pausedAt) / 1000;
      pausedAt = undefined;
    }
    audio.setHostPaused(paused);
  };
  listen(window, "rhine-wallpaper-pause", pause);
  apply(wallpaperHost()?.properties ?? {});
  pause();
}
if (isWallpaper) {
  workbench = new Workbench(
    $("#stage"),
    () => {
      if (ready && mode !== "boot") setMode("archive");
    },
    (lane) => {
      if(ready&&!modal){const key=columnMemory.get(catalogState().mode+"|"+archiveColumns[lane]);const index=records.findIndex(record=>record.key===key);select(index>=0?index:columnFiles(lane)[0]??selected);}
    },
  );
  workbench.setMotion(prefs.motion);
  playground = new ArchivePlayground(
    $("#stage"),
    () => scene,
    () => ({
      enabled: !!workbench?.enabled && mode === "archive" && ready,
      paused:
        Boolean(modal) ||
        modalClosing ||
        Boolean(wallpaperHost()?.paused) ||
        document.hidden,
      reduced: motionIsReduced(),
    }),
    (value) => {
      musicSuppressed = value;
      configureAudio();
    },
    () => audio.play("tick"),
  );
  wallpaperEffects = new WallpaperEffects($("#stage"), () => scene);
  listen(document, "click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>(
      "[data-workbench-mode]",
    );
    if (button)
      closeModal(() => {
        workbench!.setEnabled(button.dataset.workbenchMode === "workbench");
      });
  });
}
void start();
enableGamepad();
const ARCHIVE_HINT: Record<"keyboard" | "gamepad", string> = {
  keyboard: `<kbd>←</kbd> <kbd>→</kbd> 分组 <span>·</span> <kbd>↑</kbd> <kbd>↓</kbd> 选择 <span>·</span> <kbd>ENTER</kbd> 打开`,
  gamepad: `<kbd>LS</kbd> <kbd>DP</kbd> 分组 / 选择 <span>·</span> <kbd>A</kbd> 打开`,
};
life.add(onInputDevice((device) => {
  const hint = document.querySelector(".archive-hint");
  if (hint) hint.innerHTML = ARCHIVE_HINT[device];
}));
// Deterministic review controls: the running application, never a video surrogate.
Object.assign(window, {
  rhine: {
    // The review button supplies a real user activation. Preferences stay local to this preview.
    playBootPreview: async (music = false) => {
      if (!ready || !navigator.userActivation.isActive) return false;
      const request = ++audioPreviewRequest;
      audioPreview = true;
      audio.configure({ ...prefs, sound: true, music });
      const unlocked = await audio.unlock();
      if (request !== audioPreviewRequest) return false;
      if (!unlocked) {
        audioPreview = false;
        configureAudio();
        return false;
      }
      replayBoot(true);
      return true;
    },
    seek: (t: number) => {
      setMode("boot");
      bootStart = performance.now() / 1000 - t;
      lastStep = "";
    },
    archive: () => setMode("archive"),
    detail: () => openFile(),
    select: (i: number) => select(i),
    stats: () => ({
      ...scene?.getStats(),
      threeState,
      rendererPreference:prefs.rendererBackend,
      rendererFallbackReason,
      fps: Math.round(fps),
      uiFps: Math.round(fps),
      renderedFps: Math.round(renderedFps),
      mode,
      ready,
      startup: started ? "started" : (entry?.phase ?? "loading"),
      motion: { reduced: motionIsReduced(), preset: prefs.motionPreset },
      bootTime:
        mode === "boot"
          ? started
            ? (frozenTime ?? performance.now() / 1000 - bootStart) + 5
            : 6.76
          : null,
      selected: records[selected].id,
      saved: [...saved],
      audio: audio.stats(),
      wallpaper: isWallpaper ? wallpaperHost() : null,
    }),
  },
});


 const ownedApi=(window as any).rhine
 life.add(()=>{
  ready=false;started=false;pendingCatalogChange=null
  activeNativePanel?.dispose();activeNativePanel=undefined;
  lookupControllers.forEach(controller=>controller.abort());lookupControllers.clear()
  disableGamepad();viewer?.dispose();scene?.dispose();scene=undefined
  modalTransition?.dispose();detailTransition.dispose();tabTransition.cancel();bookmarkFeedback?.cancel()
  rollingTitles.forEach(controller=>controller.destroy())
  for(const controller of [fileCounter,columnCounter,selectedCode,hoverCode])controller.destroy()
  updateFooterClock.dispose()
  if((window as any).rhine===ownedApi)(window as any).rhine=previousApi
  const root=document.getElementById('stage');if(root){disposeBootLetterings(root);root.replaceChildren()}
 })
}
