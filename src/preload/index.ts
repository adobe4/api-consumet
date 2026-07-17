import { contextBridge, ipcRenderer } from 'electron';
import type {
  AutoReelApi,
  RenderProgressMsg,
  RenderRequest,
} from '../shared/ipc';

const api: AutoReelApi = {
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  pickVisuals: () => ipcRenderer.invoke('pick-visuals'),
  pickOutput: (defaultName: string) => ipcRenderer.invoke('pick-output', defaultName),
  previewTimeline: (req: RenderRequest) => ipcRenderer.invoke('preview-timeline', req),
  startRender: (req: RenderRequest) => ipcRenderer.invoke('start-render', req),
  cancelRender: () => ipcRenderer.invoke('cancel-render'),
  showInFolder: (path: string) => ipcRenderer.invoke('show-in-folder', path),
  transitions: () => ipcRenderer.invoke('list-transitions'),
  onProgress: (cb: (p: RenderProgressMsg) => void) => {
    const listener = (_e: unknown, p: RenderProgressMsg) => cb(p);
    ipcRenderer.on('render-progress', listener);
    return () => ipcRenderer.removeListener('render-progress', listener);
  },
};

contextBridge.exposeInMainWorld('autoreel', api);
