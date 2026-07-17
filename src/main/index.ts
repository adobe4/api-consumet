import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseInstructions,
  buildTimeline,
  render,
  probeDuration,
  detectKind,
  TRANSITIONS,
} from '../engine/index';
import type { RenderHandle } from '../engine/index';
import type {
  RenderRequest,
  TimelinePreviewItem,
  UIVisual,
} from '../shared/ipc';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let mainWindow: BrowserWindow | null = null;
let activeRender: RenderHandle | null = null;

const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'];
const VISUAL_EXTS = [
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tiff', 'heic', 'avif',
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v',
];

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0d0f14',
    title: 'AutoReel',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** Build a Timeline from a render request (shared by preview + render). */
function timelineFromRequest(req: RenderRequest) {
  const instructions = parseInstructions(req.instructionsText || '');
  return buildTimeline({
    visuals: req.visuals,
    instructions,
    audioDuration: req.audioDuration,
    fps: req.fps,
    width: req.width,
    height: req.height,
    animation: req.animation,
    seed: req.seed,
  });
}

function registerIpc(): void {
  ipcMain.handle('pick-audio', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose voiceover audio',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTS }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const path = res.filePaths[0];
    const duration = await probeDuration(path);
    return { path, duration };
  });

  ipcMain.handle('pick-visuals', async (): Promise<UIVisual[]> => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Add visuals (images or clips)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: VISUAL_EXTS }],
    });
    if (res.canceled) return [];
    return res.filePaths.map((path, i) => ({
      id: `${Date.now()}-${i}`,
      path,
      kind: detectKind(path),
      name: basename(path),
    }));
  });

  ipcMain.handle('pick-output', async (_e, defaultName: string) => {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export video',
      defaultPath: defaultName,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'QuickTime (ProRes)', extensions: ['mov'] },
      ],
    });
    return res.canceled ? null : res.filePath ?? null;
  });

  ipcMain.handle('preview-timeline', async (_e, req: RenderRequest): Promise<TimelinePreviewItem[]> => {
    const tl = timelineFromRequest(req);
    return tl.segments.map((s) => ({
      index: s.index,
      name: s.visual.name ?? s.visual.path,
      start: s.start,
      end: s.end,
      duration: s.duration,
      animation: s.animation,
    }));
  });

  ipcMain.handle('start-render', async (_e, req: RenderRequest) => {
    try {
      const timeline = timelineFromRequest(req);
      activeRender = render(
        {
          audioPath: req.audioPath,
          timeline,
          outPath: req.outPath,
          transition: req.transition,
          transitionDuration: req.transitionDuration,
          quality: req.quality,
          seed: req.seed,
        },
        (p) => mainWindow?.webContents.send('render-progress', p),
      );
      const outPath = await activeRender.done;
      activeRender = null;
      return { ok: true as const, outPath };
    } catch (err) {
      activeRender = null;
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('cancel-render', async () => {
    activeRender?.cancel();
    activeRender = null;
  });

  ipcMain.handle('show-in-folder', async (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle('list-transitions', async () =>
    TRANSITIONS.map((t) => ({ name: t.name, label: t.label, group: t.group })),
  );
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
